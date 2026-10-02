/**
 * The deposit's recorded milestones, oldest first.
 *
 * This was previously a read of `app.deposit_events`, which could not have
 * worked: the `app` schema is not exposed through the Data API. Deriving the
 * timeline from the timestamps the deposit wrapper already returns is honest
 * about what this actually IS.
 *
 * It is the deposit request's own milestones, NOT the event log. The event log
 * additionally retains who acted and what evidence they supplied, and it is
 * append-only. If a screen ever needs that, it needs a wrapper returning the
 * events. Do not present this list as the audit trail.
 */
export type DepositTimelineFields = {
  requestedAt: string;
  submittedAt?: string | null;
  verifiedAt?: string | null;
  confirmedAt?: string | null;
};

export type TimelineEntry = {
  event: string;
  source: 'USER' | 'CHAIN' | 'ADMIN';
  at: string;
};

export function buildDepositTimeline(
  fields: DepositTimelineFields,
  status: string,
): TimelineEntry[] {
  const entries: TimelineEntry[] = [];

  // Every deposit has a request moment, so this entry is unconditional.
  entries.push({ event: 'REQUESTED', source: 'USER', at: fields.requestedAt });

  if (fields.submittedAt) {
    entries.push({ event: 'SUBMITTED', source: 'USER', at: fields.submittedAt });
  }

  if (fields.verifiedAt) {
    // Attributed to CHAIN, never to the user and never to ADMIN: verification is
    // performed independently against the network, and a timeline implying a
    // person vouched for settlement would misstate the custody chain (law 44).
    entries.push({ event: 'VERIFIED', source: 'CHAIN', at: fields.verifiedAt });
  }

  if (status === 'NEEDS_REVIEW' || status === 'REJECTED') {
    // Escalation and rejection are human decisions. There is no escalated_at
    // column, so the best available moment is the last thing that happened before
    // the decision. Falling back to requestedAt keeps the entry inside the
    // deposit's own lifetime rather than inventing a time.
    const decidedAt =
      fields.confirmedAt ?? fields.verifiedAt ?? fields.submittedAt ?? fields.requestedAt;

    entries.push({
      event: status === 'REJECTED' ? 'REJECTED' : 'NEEDS_REVIEW',
      source: 'ADMIN',
      at: decidedAt,
    });
  }

  if (fields.confirmedAt) {
    entries.push({ event: 'CONFIRMED', source: 'ADMIN', at: fields.confirmedAt });
  }

  // Sorted because the stages come from independent columns, not from an event
  // log's own ordering. Without this, a deposit whose confirmation timestamp
  // precedes its verification timestamp would render out of order.
  return entries.sort((a, b) => a.at.localeCompare(b.at));
}
