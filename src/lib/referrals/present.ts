import type { MoneyState } from '@/components/ui/MoneyState';

/**
 * Map the DATABASE reward_state to the PRESENTATION money state.
 *
 * These are deliberately different enums and must never be conflated.
 *
 * `app.reward_state` is the reward engine's operational vocabulary and has NINE
 * values, including `AVAILABLE` and `ELIGIBLE` as separate states. The `MoneyState`
 * type is what a PERSON needs to see and has FIVE.
 *
 * The mistake this exists to prevent: rendering a `reward.state === 'SETTLED'`
 * comparison against the database enum. `SETTLED` IS NOT A REWARD STATE. The
 * comparison is always false, so every reward would render in the neutral tone -
 * including one that is genuinely AVAILABLE and withdrawable. That is precisely the
 * "pending amount looks settled" failure MoneyState was written to make
 * impossible, reintroduced through a typo'd enum value.
 *
 * `AVAILABLE` is the only state that maps to `settled`, and `settled` is the only
 * presentation state that earns the brand green.
 */
export function mapRewardState(dbState: string): MoneyState {
  switch (dbState) {
    case 'PENDING':
      return 'pending';
    case 'ELIGIBLE':
      return 'eligible';
    // AVAILABLE is the credited, withdrawable state.
    case 'AVAILABLE':
      return 'settled';
    case 'ON_HOLD':
      return 'reserved';
    case 'REVERSED':
    case 'CHARGEBACK':
    case 'CANCELLED':
    case 'EXPIRED':
      return 'failed';
    // Fail closed. An unrecognised state is shown as not payable rather than
    // guessed at: a green number on an unknown state is the worse error.
    default:
      return 'failed';
  }
}

/**
 * Display an amount as raw minor units plus its unit.
 *
 * This matches the dashboard and wallet: the minor-unit scale is configuration and
 * this project does not rescale speculatively. A referral reward is shown the same
 * way as every other amount, so a user is never shown two different renderings of
 * the same money.
 */
export function formatAmount(minor: number, unit: string): string {
  return `${minor.toLocaleString('en-US')} minor units (${unit})`;
}
