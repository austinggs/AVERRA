import type { ReactNode } from 'react';

/**
 * The four platform guarantees, as data.
 *
 * HELD AS DATA, NOT INLINED IN THE PAGE.
 *
 * Two reasons, and the second is the real one.
 *
 * 1. Adding a fifth guarantee is a one-line change that cannot disturb the
 *    layout, and the icon set cannot drift out of step with the copy.
 *
 * 2. THE COPY IS LOAD-BEARING AND MUST NOT BE PARAPHRASED. Each entry is a
 *    promise about how money moves. "Rewards are verified", "two balances
 *    never merged", "fees disclosed first" and "human support only" are the
 *    four things that make this product credible, and they were verified
 *    against the spec. A hero animation is not worth editing them for, so they
 *    live in one file that has exactly one purpose: being read.
 *
 * ICONS ARE DECORATIVE AND aria-hidden IN THE CONSUMER.
 *
 * Every icon sits in a span the caller marks `aria-hidden`, because the
 * heading beside it already names the guarantee. A glyph is never the only
 * carrier of a promise - that is the same rule that keeps `MoneyState` from
 * depending on colour alone.
 */

export interface Guarantee {
  icon: ReactNode;
  title: string;
  body: string;
}

const ICON_CLASS = 'size-5';

export const GUARANTEES: Guarantee[] = [
  {
    // A shield with a tick: verification gates a credit.
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={ICON_CLASS}
      >
        <path d="M9 12.5l2.25 2.25L15.5 10.5M12 3l7.5 3.2v5.1c0 4.5-3.1 8.2-7.5 9.7-4.4-1.5-7.5-5.2-7.5-9.7V6.2L12 3Z" />
      </svg>
    ),
    title: 'Rewards are verified',
    body: 'Submitting a task completion is evidence, not a payment. A reward is credited only after the completion has been verified.',
  },
  {
    // Two distinct compartments: never one merged total.
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={ICON_CLASS}
      >
        <path d="M3.5 8.5h17M3.5 8.5V17a1.5 1.5 0 0 0 1.5 1.5h14a1.5 1.5 0 0 0 1.5-1.5V8.5M3.5 8.5 6 4.5h12l2.5 4M9 12.5v2.5M15 12.5v2.5" />
      </svg>
    ),
    title: 'Two balances, never merged',
    body: 'Your Earned Reward Balance is what Averra owes you. Your User Funding Balance is what you deposited. They are different kinds of money.',
  },
  {
    // A breakdown line with a total, and the total struck through by the fee:
    // gross, fee, net.
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={ICON_CLASS}
      >
        <path d="M4 6.5h16M4 12h10M4 17.5h7M17.5 14.5l2 2 3.5-3.5" />
      </svg>
    ),
    title: 'Fees disclosed first',
    body: 'The 15% Platform Service and Maintenance Fee is shown as gross, fee and net before you confirm a withdrawal. The amount you see is the amount honoured.',
  },
  {
    // A person at a desk: a human wrote the reply.
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={ICON_CLASS}
      >
        <path d="M12 20.5c4.7 0 8.5-1.3 8.5-3s-3.8-3-8.5-3-8.5 1.3-8.5 3 3.8 3 8.5 3ZM3.5 17.5v-9M20.5 17.5v-9M3.5 12c0 1.7 3.8 3 8.5 3s8.5-1.3 8.5-3M12 14.5V21" />
      </svg>
    ),
    title: 'Human support only',
    body: 'Every support reply is written by an authorized human agent. No automated system writes a reply, and nothing on Telegram can move your money.',
  },
];