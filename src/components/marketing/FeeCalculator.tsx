'use client';

import { useId, useMemo, useState } from 'react';
import { calculateWithdrawalFee, FEE_BASIS_POINTS } from '@/lib/financial/fee';

// Interactive fee disclosure.
//
// WHY THIS IS THE HERO WIDGET
//
// Doc 09 TRANSPARENCY and law 45 both require the gross, the fee and the net to
// be visible BEFORE a user commits. A paragraph saying "15% applies" does not
// convey that; dragging a slider and watching the net change does. It turns an
// abstraction into something a person can check for themselves.
//
// IT USES THE REAL FEE FUNCTION. Not a re-implementation.
//
// `calculateWithdrawalFee` in `src/lib/financial/fee.ts` is the same module the
// withdrawal path uses, so this widget cannot drift from the charge a user
// actually pays - if the basis points change, both change together. A local
// `gross * 0.15` here would be a second, unverifiable copy of the fee, and the
// day someone rounds it differently the landing page becomes a lie about money.
// The rate label is derived from `FEE_BASIS_POINTS` for the same reason: a
// hardcoded "15%" in a marketing component is exactly the duplication that
// makes a published number drift.
//
// INTEGER ARITHMETIC ONLY.
//
// `calculateWithdrawalFee` takes and returns `bigint`, so the slider works in
// whole minor units (kobo) and never touches floating point - matching the rule
// in `fee.ts` that money is never a float here. The decimal string exists only
// at the display edge.
//
// IT CANNOT MOVE ANY MONEY.
//
// No fetch, no server action, no Supabase client, no user identity in scope. It
// computes a disclosure from a constant. That is also why it is safe on a
// PUBLIC route beside an ad slot: it has no path to a balance because it never
// had one.

const MIN_MINOR = 500n;
const MAX_MINOR = 500_000n;
const STEP_MINOR = 500n;

const FEE_RATE_LABEL = `${FEE_BASIS_POINTS / 100}% Platform Service and Maintenance Fee`;

/**
 * naira/kobo, fixed.
 *
 * The minor-unit size is configuration, but a public landing page has to commit
 * to one rendering, and NGN-kobo is the settlement currency. DISPLAY ONLY - the
 * value is never sent anywhere and never leaves this component.
 */
function formatNaira(minor: bigint): string {
  const negative = minor < 0n;
  const absolute = negative ? -minor : minor;

  const naira = absolute / 100n;
  const kobo = absolute % 100n;
  const whole = naira.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  return `${negative ? '-' : ''}₦${whole}.${kobo.toString().padStart(2, '0')}`;
}

export function FeeCalculator() {
  const sliderId = useId();
  const [gross, setGross] = useState(20_000n);

  // One function call, not arithmetic scattered through the JSX.
  const fee = useMemo(() => calculateWithdrawalFee(gross), [gross]);

  // Truncated, and only for a "you keep about N%" sentence. Never used for an
  // amount: the displayed figures above come from `fee` verbatim.
  const keepPercent = gross === 0n ? 0 : Number((fee.netMinor * 100n) / gross);

  return (
    <div className="rounded-card border border-ink-100 bg-surface p-5 shadow-card md:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <label htmlFor={sliderId} className="text-sm font-semibold text-ink-900">
          Try a withdrawal amount
        </label>
        <span className="text-xs text-ink-500">{FEE_RATE_LABEL}</span>
      </div>

      <p className="mt-1 text-xs leading-relaxed text-ink-500">
        Drag to see the gross, the fee, and what actually reaches you. This is the same rate
        applied when you withdraw.
      </p>

      <div className="mt-5">
        {/* The end labels are decorative: the range input already announces its
            value, and a second pair of numbers would be read out twice. */}
        <div className="flex items-baseline justify-between gap-3" aria-hidden="true">
          <span className="text-xs text-ink-400">{formatNaira(MIN_MINOR)}</span>
          <span className="text-xs text-ink-400">{formatNaira(MAX_MINOR)}+</span>
        </div>

        <input
          id={sliderId}
          type="range"
          min={Number(MIN_MINOR)}
          max={Number(MAX_MINOR)}
          step={Number(STEP_MINOR)}
          value={Number(gross)}
          onChange={(event) => setGross(BigInt(event.target.value))}
          /*
            WITHOUT THIS THE SLIDER IS UNUSABLE WITH A SCREEN READER.

            A native range input announces its raw `value`, and this value is in
            MINOR UNITS: dragging to 20,000 reads out "twenty thousand", which
            asserts a withdrawal of N20,000 when the widget is displaying N200.00.
            On the one control whose entire purpose is disclosing money honestly,
            that is the worst possible failure - the accessibility layer
            contradicting the visible figures by two decimal places.

            `aria-valuetext` replaces the number with the same formatted currency
            the reader can SEE, so the spoken and printed values are identical by
            construction rather than by coincidence.
          */
          aria-valuetext={`${formatNaira(gross)} gross, ${formatNaira(fee.netMinor)} after the ${FEE_BASIS_POINTS / 100}% fee`}
          className="mt-2 h-11 w-full cursor-pointer appearance-none rounded-pill bg-ink-100 accent-brand-500"
        />
      </div>

      {/*
        A real `dl` in a live region, so the figures are announced when the value
        settles. `polite`, not `assertive`: dragging is continuous, and an
        assertive region would interrupt on every intermediate value.
      */}
      <dl aria-live="polite" className="mt-5 grid grid-cols-3 gap-2 rounded-tile bg-surface-sunken p-3">
        <div>
          <dt className="text-[0.6875rem] font-medium tracking-wide text-ink-500 uppercase">
            Gross
          </dt>
          <dd className="mt-1 text-lg font-bold tabular-nums tracking-tight text-ink-900">
            {formatNaira(fee.grossMinor)}
          </dd>
        </div>

        <div>
          <dt className="text-[0.6875rem] font-medium tracking-wide text-ink-500 uppercase">
            Fee
          </dt>
          <dd className="mt-1 text-lg font-bold tabular-nums tracking-tight text-ink-700">
            -{formatNaira(fee.feeMinor)}
          </dd>
        </div>

        {/*
          THE ONE PLACE BRAND GREEN APPEARS ABOVE THE FOLD.

          This is the NET - money that reaches a user after the fee is taken - so
          it is genuinely the "credited" case and colouring it is consistent with
          the MoneyState rule that green means real money. It is still not a
          balance: moving a slider credits nothing, which is what the sentence
          beneath it says. That is what makes this an illustration of the rule
          rather than a violation of it.
        */}
        <div>
          <dt className="text-[0.6875rem] font-medium tracking-wide text-ink-500 uppercase">
            You receive
          </dt>
          <dd className="mt-1 text-lg font-bold tabular-nums tracking-tight text-brand-700">
            {formatNaira(fee.netMinor)}
          </dd>
        </div>
      </dl>

      <p className="mt-3 text-xs leading-relaxed text-ink-500">
        You keep about {keepPercent}% of a withdrawal. This illustrates the fee; it is not a balance
        and not a credit. No money moves until a real withdrawal is verified and confirmed.
      </p>
    </div>
  );
}