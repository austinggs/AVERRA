import { NextResponse } from 'next/server';
import { z } from 'zod';
import { route } from '@/lib/api/route';
import { RouteError } from '@/lib/api/errors';
import { deriveIdempotencyKey } from '@/lib/api/idempotency';
import { createAdminClient } from '@/lib/supabase/admin';
import { errorFields } from '@/lib/observability/errors';

// POST /api/donations
//
// A donation is recorded and then paid, in ONE call, which is a deliberate difference
// from the perk path and needs the reasoning stated.
//
// Doc 83 says a donation record is ACKNOWLEDGEMENT and posts no ledger entry on its
// own. The money still moves - from User Funding Balance - but only through
// `purchase_with_funding` with purpose DONATION_FROM_FUNDING, which posts the debit
// and writes a `funding_spend_events` row.
//
// So the two-step split exists to mirror the database, not because a donation needs
// more care than a perk. It gets LESS: a perk shows the user a PENDING order and
// waits for a confirmation, because it is a purchase of something. A donation is a
// single act of giving, and asking someone to confirm the same amount twice would be
// friction with no safety benefit - the amount comes from the request either way,
// because a donation has no catalogue to price it from.
//
// Two separate idempotency keys, one per command. Sharing a key across the two would
// make the second call look like a replay of the first and return the record instead
// of paying.

const donationSchema = z.object({
  amountMinor: z.coerce.bigint().positive(),
  unit: z.string().trim().min(2).max(12),
  note: z.string().trim().max(500).optional(),
  idempotencyKey: z.string().trim().min(8).max(120).optional(),
});

export const POST = route(async ({ user, body, correlationId }) => {
  const parsed = donationSchema.safeParse(body);

  if (!parsed.success) {
    throw new RouteError(
      'validation_failed',
      'Enter a donation amount and currency.',
      parsed.error.flatten().fieldErrors,
    );
  }

  const { amountMinor, unit, note, idempotencyKey } = parsed.data;

  const recordKey = deriveIdempotencyKey({
    actorId: user!.id,
    scope: 'donation.record',
    provided: idempotencyKey,
    payload: { amountMinor: amountMinor.toString(), unit },
  });

  const admin = createAdminClient();

  const { data: donation, error: recordError } = await admin.rpc('record_donation', {
    p_user_id: user!.id,
    p_amount_minor: amountMinor.toString(),
    p_unit: unit,
    // ALWAYS USER_FUNDING. A donation may never be funded from earned rewards, which
    // are not user property until they settle, and doc 83 keeps the two apart.
    p_funding_source: 'USER_FUNDING',
    p_idempotency_key: recordKey,
    p_note: note ?? null,
  });

  if (recordError) {
    console.error('[api] record donation failed', errorFields(recordError, { correlationId }));
    throw new RouteError('internal_error', 'Could not record that donation.');
  }

  const donationRow = (Array.isArray(donation) ? donation[0] : donation) as {
    id?: string;
    amount_minor?: number | string;
    unit?: string;
  } | null;

  const donationId = donationRow?.id;

  if (!donationId) {
    throw new RouteError('internal_error', 'Could not record that donation.');
  }

  const payKey = deriveIdempotencyKey({
    actorId: user!.id,
    scope: 'donation.pay',
    provided: idempotencyKey,
    payload: { donationId },
  });

  const { data: spend, error: payError } = await admin.rpc('purchase_with_funding', {
    p_user_id: user!.id,
    p_purpose: 'DONATION_FROM_FUNDING',
    // From the donation row, not from the request, so the two cannot drift.
    p_amount_minor: donationRow!.amount_minor!.toString(),
    p_unit: donationRow!.unit!,
    p_idempotency_key: payKey,
    p_donation_id: donationId,
    p_correlation_id: correlationId,
  });

  if (payError) {
    const message = payError.message;

    if (message.includes('insufficient')) {
      // The donation row now exists with no debit behind it, which is exactly what
      // doc 83 describes: the record is acknowledgement, and only a completed spend
      // means money moved. The user is told this plainly rather than "try again",
      // because retrying WILL fail identically until they deposit.
      throw new RouteError(
        'insufficient_funds',
        'Your User Funding Balance is too low. Your donation was recorded but no money was taken. ' +
          'Earned rewards cannot be donated.',
      );
    }

    console.error('[api] donate payment failed', errorFields(payError, { correlationId }));
    throw new RouteError(
      'internal_error',
      'Your donation was recorded but the payment did not complete. No money was taken.',
    );
  }

  const spendRow = (Array.isArray(spend) ? spend[0] : spend) as { id?: string } | null;

  return NextResponse.json(
    {
      donationId,
      spendId: spendRow?.id,
      amountMinor: donationRow!.amount_minor!.toString(),
      unit: donationRow!.unit!,
      moneySource: 'USER_FUNDING',
      moneyMoved: true,
      idempotencyKey: payKey,
    },
    { status: 201 },
  );
});
