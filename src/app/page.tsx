import Link from 'next/link';
import { getSessionUser } from '@/lib/auth/session';
import { Card, Pill } from '@/components/ui/Card';

export default async function HomePage() {
  const user = await getSessionUser();

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-ink-100 bg-surface">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4 md:px-6">
          <span className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="grid size-8 place-items-center rounded-tile bg-brand-500 text-sm font-black text-white"
            >
              A
            </span>
            <span className="text-base font-bold tracking-tight text-ink-900">Averra</span>
          </span>

          {!user ? (
            <Link
              href="/sign-in"
              className="min-h-10 rounded-pill px-3 text-sm font-semibold text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-900"
            >
              Sign in
            </Link>
          ) : null}
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12 md:px-6 md:py-20">
        <Pill tone="brand">Earn with a transparent wallet</Pill>

        <h1 className="mt-5 text-4xl font-bold leading-[1.1] tracking-tight text-ink-900 md:text-5xl">
          Complete tasks.
          <br />
          Get verified rewards.
        </h1>

        <p className="mt-5 max-w-prose text-base leading-relaxed text-ink-500">
          Averra pays you for completing tasks, offers and surveys. Every reward is verified before
          it is credited, every payout is disclosed before you confirm it, and your earned balance
          is always separate from anything you deposited.
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href={user ? '/dashboard' : '/sign-up'}
            className="inline-flex min-h-12 items-center justify-center rounded-pill bg-brand-500 px-6 text-sm font-semibold text-white shadow-tile transition-colors hover:bg-brand-600"
          >
            {user ? 'Go to your dashboard' : 'Create an account'}
          </Link>
          <Link
            href={user ? '/tasks' : '/sign-in'}
            className="inline-flex min-h-12 items-center justify-center rounded-pill border border-ink-200 bg-surface px-6 text-sm font-semibold text-ink-700 transition-colors hover:bg-surface-sunken"
          >
            {user ? 'Browse tasks' : 'Sign in'}
          </Link>
        </div>

        <section className="mt-14 grid gap-3 sm:grid-cols-2">
          <Card>
            <h2 className="text-base font-semibold text-ink-900">Rewards are verified</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-500">
              Submitting a task completion is evidence, not a payment. A reward is credited only
              after the completion has been verified.
            </p>
          </Card>

          <Card>
            <h2 className="text-base font-semibold text-ink-900">Two balances, never merged</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-500">
              Your Earned Reward Balance is what Averra owes you. Your User Funding Balance is what
              you deposited. They are different kinds of money.
            </p>
          </Card>

          <Card>
            <h2 className="text-base font-semibold text-ink-900">Fees disclosed first</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-500">
              The 15% Platform Service and Maintenance Fee is shown as gross, fee and net before you
              confirm a withdrawal. The amount you see is the amount honoured.
            </p>
          </Card>

          <Card>
            <h2 className="text-base font-semibold text-ink-900">Human support only</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-500">
              Every support reply is written by an authorized human agent. No automated system
              writes a reply, and nothing on Telegram can move your money.
            </p>
          </Card>
        </section>
      </main>

      <footer className="border-t border-ink-100 bg-surface">
        <div className="mx-auto max-w-3xl px-4 py-6 text-xs leading-relaxed text-ink-500 md:px-6">
          Averra is an earning and rewards platform. Mining Game resources are virtual and are not
          money. Partner offers and surveys appear only after a provider completes commercial
          approval and compliance review.
        </div>
      </footer>
    </div>
  );
}
