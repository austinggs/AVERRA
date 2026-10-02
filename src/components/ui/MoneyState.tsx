import type { ReactNode } from 'react';
import { Card, cx, Pill } from './Card';

// Money state presentation.
//
// Doc 09 TRANSPARENCY: "'Sent', 'detected', and 'verified' are not equivalent
// to 'credited'. Only the confirmed financial state should be presented as
// available User Funding Balance."
//
// WHY THIS IS A COMPONENT AND NOT A CLASS
//
// It is tempting to let a caller write `<span className="text-green-600">` for
// an amount. That is exactly how a pending amount ends up looking settled. So
// the tone is DERIVED from the state, never passed in, and every state carries
// an explicit human label.
//
// Nothing here computes a balance. It reads one and describes it.

/**
 * The financial states a user-facing amount can be in.
 *
 * This is deliberately NOT the database reward_state enum. Those are operational
 * states for the reward engine. These are the states a PERSON needs to see.
 */
export type MoneyState =
  /** Awarded to the user but not yet settled to their balance. */
  | 'pending'
  /** Verified and owed, but not yet released (held for settlement or review). */
  | 'eligible'
  /** Credited and available to withdraw. */
  | 'settled'
  /** Reserved by an in-flight withdrawal, so not spendable. */
  | 'reserved'
  /** Refused, reversed, or otherwise not payable. */
  | 'failed';

interface STATE_STYLE {
  /** Never a brand green. Settled is the only state that earns the brand colour,
   *  so a green number in this system unambiguously means credited money. */
  label: string;
  pill: 'neutral' | 'brand' | 'warning' | 'danger';
  amount: string;
  hint: string;
}

const STYLE: Record<MoneyState, STATE_STYLE> = {
  pending: {
    label: 'Pending',
    pill: 'neutral',
    amount: 'text-ink-500',
    hint: 'Awarded but not yet settled. This is not available to withdraw.',
  },
  eligible: {
    label: 'Eligible',
    pill: 'warning',
    amount: 'text-ink-700',
    hint: 'Verified and owed to you, but not yet released.',
  },
  settled: {
    label: 'Available',
    pill: 'brand',
    amount: 'text-ink-900',
    hint: 'Credited to your balance and available to withdraw.',
  },
  reserved: {
    label: 'Reserved',
    pill: 'warning',
    amount: 'text-ink-700',
    hint: 'Held by an in-flight withdrawal. It will be deducted on settlement.',
  },
  failed: {
    label: 'Not payable',
    pill: 'danger',
    amount: 'text-ink-400 line-through',
    hint: 'This was rejected or reversed. No money was credited.',
  },
};

interface MoneyStateProps {
  state: MoneyState;
  /** Pre-formatted display string. Formatting stays with the caller so the raw
   *  minor-unit value is never silently rescaled by this component. */
  amount: string;
  unit?: string;
  /** Overrides the default label text for the state. */
  label?: string;
  className?: string;
  children?: ReactNode;
}

/**
 * A single amount, with its financial state made unambiguous.
 *
 * The state is never styled by the caller. That is the whole point.
 */
export function MoneyState({ state, amount, unit, label, className, children }: MoneyStateProps) {
  const style = STYLE[state];

  return (
    <div className={className}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className={cx('text-2xl font-semibold tabular-nums tracking-tight', style.amount)}>
          {amount}
        </span>
        {unit ? <span className="text-sm text-ink-500">{unit}</span> : null}
        <Pill tone={style.pill}>{label ?? style.label}</Pill>
      </div>

      <p className="mt-1.5 text-xs leading-relaxed text-ink-500">{style.hint}</p>

      {children}
    </div>
  );
}

interface BalanceCardProps {
  /** e.g. "Earned Reward Balance". These are two different kinds of money and
   *  the title is the clearest signal a user gets. */
  title: string;
  description: string;
  state: MoneyState;
  amount: string;
  unit?: string;
  /** Present only when a balance actually exists. */
  footer?: ReactNode;
  children?: ReactNode;
}

/**
 * One balance, in a card, with its kind named and its state explicit.
 *
 * Doc 09 requires Earned Reward Balance and User Funding Balance to read as
 * separate. Rendering both through this component is what keeps them from
 * drifting into a single merged "total".
 */
export function BalanceCard({
  title,
  description,
  state,
  amount,
  unit,
  footer,
  children,
}: BalanceCardProps) {
  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-ink-900">{title}</h3>
          <p className="mt-1 text-xs leading-relaxed text-ink-500">{description}</p>
        </div>
      </div>

      <div className="mt-4">
        <MoneyState state={state} amount={amount} unit={unit} />
      </div>

      {children}

      {footer ? <div className="mt-4 border-t border-ink-100 pt-4">{footer}</div> : null}
    </Card>
  );
}
