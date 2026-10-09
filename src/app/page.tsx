import Link from 'next/link';
import { getSessionUser } from '@/lib/auth/session';
import { ButtonLink } from '@/components/ui/Button';
import { Pill } from '@/components/ui/Card';
import { AdSlot } from '@/components/ads/AdSlot';
import { placementsForPath } from '@/lib/ads/placements';
import { Reveal, RevealGroup } from '@/components/ui/Reveal';
import { FeeCalculator } from '@/components/marketing/FeeCalculator';
import { HowItWorks } from '@/components/marketing/HowItWorks';
import { TrustStrip } from '@/components/marketing/TrustStrip';
import { GUARANTEES } from '@/components/marketing/guarantees';
import { BrandLockup } from '@/components/brand/BrandLockup';

// The landing page.
//
// WHAT CHANGED AND WHY
//
// The previous version was a heading, a paragraph and four static cards. It was
// not wrong - the copy is the same copy - but it gave a visitor nothing to DO,
// so it read as a brochure. Three changes, in order of value:
//
//   1. The fee calculator. A stated fee is an abstraction; a slider is a check.
//      It is the strongest trust signal this product has, because it lets a
//      sceptical visitor verify our pricing against itself in ten seconds.
//
//   2. The lifecycle stepper. It reframes "slow verification" from an excuse
//      into the mechanism. A reader who understands WHY a claim is not a payment
//      is a reader who will not churn in week three.
//
//   3. Scroll reveals and a wash background. Purely presentational.
//
// WHAT DELIBERATELY DID NOT CHANGE
//
// Every guarantee in the old copy is still here. This is a financial product:
// "rewards are verified", "two balances never merged", "fees disclosed first"
// and "human support only" are not decoration. Shortening them to make room for
// a hero animation would trade the thing that differentiates us for the thing
// every competitor already does.

export default async function HomePage() {
  const user = await getSessionUser();

  // Ads on the landing page ONLY, and resolved through the placement policy rather
  // than written out here. `placementsForPath('/')` returns [] on any route that is
  // not an approved public one, so this line cannot be copied into a sessioned page
  // without the policy refusing it.
  const ads = placementsForPath('/');

  return (
    <div className="flex min-h-dvh flex-col">
      {/*
        Sticky, and blurred rather than solid. A solid bar over a scrolling page
        makes the hero feel boxed in; the translucency keeps the ambient wash
        visible behind it, which is what makes the top of the page read as one
        continuous surface instead of a header bolted onto a body.
      */}
      <header className="sticky top-0 z-30 border-b border-ink-100 bg-surface/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3 md:px-6">
          <BrandLockup href="/" />

          {/*
            BOTH actions for an anonymous visitor. The old header showed only
            "Sign in", which made the page read as though an account were
            optional rather than as the one step between a visitor and the
            calculator. Signing up is the primary action on a landing page.
          */}
          <div className="flex items-center gap-1">
            {user ? (
              <Link
                href="/dashboard"
                className="inline-flex min-h-10 items-center rounded-pill bg-brand-500 px-4 text-sm font-semibold text-white transition-colors hover:bg-brand-600"
              >
                Dashboard
              </Link>
            ) : (
              <>
                <Link
                  href="/sign-in"
                  className="inline-flex min-h-10 items-center rounded-pill px-3 text-sm font-semibold text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-900"
                >
                  Sign in
                </Link>
                <Link
                  href="/sign-up"
                  className="inline-flex min-h-10 items-center rounded-pill bg-brand-500 px-4 text-sm font-semibold text-white transition-colors hover:bg-brand-600"
                >
                  Get started
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/*
          HERO

          `relative` is load-bearing rather than decorative. `.wash-brand` is
          absolutely positioned, and without a positioned ancestor it would
          anchor to the document root and wash the entire page green. The bloom
          is `aria-hidden` and `pointer-events-none`, so it cannot be announced
          or clicked, and it is `-z-10` so it never sits above the copy.
        */}
        <section className="relative overflow-hidden">
          <div
            aria-hidden="true"
            className="wash-brand animate-drift pointer-events-none absolute inset-0 -z-10 opacity-70"
          />

          <div className="mx-auto max-w-3xl px-4 pt-14 pb-16 md:px-6 md:pt-20 md:pb-24">
            <Reveal>
              <Pill tone="brand">Earn with a transparent wallet</Pill>
            </Reveal>

            {/*
              Two columns from `md` up. A 46-character headline above a
              40-character paragraph in a 768px column leaves the right half of
              every laptop empty; the calculator is what belongs there.
            */}
            <div className="mt-6 grid items-start gap-10 md:grid-cols-[1.05fr_0.95fr] md:gap-8">
              <div>
                <Reveal delay={0.05}>
                  <h1 className="text-4xl font-bold leading-[1.08] tracking-tight text-ink-900 md:text-5xl">
                    Complete tasks.{' '}
                    <span className="text-gradient-brand">Get verified rewards.</span>
                  </h1>
                </Reveal>

                <Reveal delay={0.1}>
                  <p className="mt-5 max-w-prose text-base leading-relaxed text-ink-500">
                    Averra pays you for completing tasks, offers and surveys. Every reward is
                    verified before it is credited, every payout is disclosed before you confirm it,
                    and your earned balance is always separate from anything you deposited.
                  </p>
                </Reveal>

                <Reveal delay={0.15}>
                  <div className="mt-8 flex flex-wrap gap-3">
                    <ButtonLink href={user ? '/dashboard' : '/sign-up'} size="md">
                      {user ? 'Go to your dashboard' : 'Create an account'}
                    </ButtonLink>
                    <ButtonLink href={user ? '/tasks' : '/sign-in'} variant="secondary" size="md">
                      {user ? 'Browse tasks' : 'Sign in'}
                    </ButtonLink>
                  </div>
                </Reveal>

                <Reveal delay={0.2}>
                  <p className="mt-5 text-xs leading-relaxed text-ink-500">
                    No deposit is required to earn. Deposits buy platform perks and are never
                    withdrawable.
                  </p>
                </Reveal>
              </div>

              <Reveal delay={0.12} direction="left">
                <FeeCalculator />
              </Reveal>
            </div>
          </div>
        </section>

        {/*
          TRUST FIGURES. Product facts, not usage metrics.

          See TrustStrip for why every number here is a static property of how
          the platform works rather than a count read from the database. A
          "users have earned ₦X" counter would be a fabricated figure on a public
          page, and an animated money-shaped number is exactly the silhouette
          that lets a pending amount read as a credited one.
        */}
        <section className="mx-auto max-w-3xl px-4 pb-16 md:px-6">
          <Reveal>
            <TrustStrip />
          </Reveal>
        </section>

        {/*
          THE LIFECYCLE, THEN THE GUARANTEES.

          Order matters here. The stepper answers "how do I actually get paid",
          which is the question an earn-platform visitor arrived with; the
          guarantees answer "why should I trust you", which is the question they
          have AFTER the first one is answered. Putting the guarantees first
          asked for trust before explaining the product, which is why the page
          felt like a brochure.
        */}
        <section className="border-y border-ink-100 bg-surface">
          <div className="mx-auto max-w-3xl px-4 py-14 md:px-6 md:py-20">
            <Reveal>
              <h2 className="text-2xl font-bold tracking-tight text-ink-900 md:text-3xl">
                How earning actually works
              </h2>
              <p className="mt-3 max-w-prose text-sm leading-relaxed text-ink-500">
                Four steps, and the slow ones are in the middle. We would rather show you the
                waiting than let you discover it.
              </p>
            </Reveal>

            <div className="mt-6">
              <HowItWorks />
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-3xl px-4 py-14 md:px-6 md:py-20">
          <Reveal>
            <h2 className="text-2xl font-bold tracking-tight text-ink-900 md:text-3xl">
              What we promise, in writing
            </h2>
          </Reveal>

          {/*
            `group` on the card, the hover fill on the ICON only. The whole card
            lifts and casts a shadow, but only the glyph changes colour - a
            full-card colour change on hover makes a grid of four look like a
            single selected item, which is a state this grid does not have.
          */}
          <RevealGroup className="mt-6 grid gap-3 sm:grid-cols-2" step={0.07}>
            {GUARANTEES.map((item) => (
              <div
                key={item.title}
                className="group rounded-card border border-ink-100 bg-surface p-5 shadow-card transition-all duration-200 ease-[var(--ease-out-expo)] hover:-translate-y-0.5 hover:shadow-lift"
              >
                <span
                  aria-hidden="true"
                  className="grid size-9 place-items-center rounded-tile bg-brand-100 text-brand-700 transition-colors duration-200 group-hover:bg-brand-500 group-hover:text-white"
                >
                  {item.icon}
                </span>

                <h3 className="mt-3.5 text-base font-semibold text-ink-900">{item.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-500">{item.body}</p>
              </div>
            ))}
          </RevealGroup>
        </section>

        <section className="border-t border-ink-100 bg-surface">
          <div className="mx-auto max-w-3xl px-4 py-14 md:px-6 md:py-20">
            <Reveal>
              <div className="rounded-card bg-brand-500 p-6 shadow-card md:p-8">
                <h2 className="text-xl font-bold tracking-tight text-white md:text-2xl">
                  {user ? 'Pick up where you left off' : 'Start earning this week'}
                </h2>
                <p className="mt-2 max-w-prose text-sm leading-relaxed text-white/85">
                  {user
                    ? 'Your balances, your open tasks and your verification status are all on the dashboard.'
                    : 'Create an account, complete a task, and watch a claim move through verification on its way to a real balance.'}
                </p>

                <div className="mt-5 flex flex-wrap gap-3">
                  <ButtonLink
                    href={user ? '/earn' : '/sign-up'}
                    size="md"
                    className="bg-white text-brand-700 shadow-tile hover:bg-white/90"
                  >
                    {user ? 'Browse offers and surveys' : 'Create an account'}
                  </ButtonLink>
                  <ButtonLink
                    href={user ? '/wallet' : '/sign-in'}
                    size="md"
                    variant="secondary"
                    className="border-white/40 bg-transparent text-white hover:bg-white/10"
                  >
                    {user ? 'Open your wallet' : 'Sign in'}
                  </ButtonLink>
                </div>
              </div>
            </Reveal>
          </div>
        </section>

        {/*
          REVENUE, NOT REWARDS.

          Nothing below this comment can affect a balance, a reward or a withdrawal.
          Adsterra pays Averra for impressions; it is not a task provider, is not
          registered in `src/lib/providers/registry.ts`, and has no row in
          `app.providers`. A visitor completing an ad here has NOT earned anything
          and no ledger entry is created anywhere on this path.

          It sits BELOW the closing call to action rather than interrupting the
          page. The previous placement was mid-document, which put a vendor
          impression between a visitor and the explanation of how the product
          pays - the worst possible position for it, and the one most likely to
          cost the conversion the rest of the page earned.
        */}
        {ads.length > 0 ? (
          <section className="mx-auto max-w-3xl px-4 pb-14 md:px-6" aria-label="Sponsors">
            {ads.map((placement) => (
              <AdSlot
                key={placement.id}
                id={placement.id}
                format={placement.format}
                showFrom={placement.showFrom}
              />
            ))}
          </section>
        ) : null}
      </main>

      {/*
        `mt-auto` pushes the footer to the bottom on a short page. Without it the
        footer rides up under the content and the page looks unfinished - which is
        what happened when this was a bare `border-t` bar.
      */}
      <footer className="mt-auto border-t border-ink-100 bg-surface">
        <div className="mx-auto max-w-3xl px-4 py-8 text-xs leading-relaxed text-ink-500 md:px-6">
          <p>
            Averra is an earning and rewards platform. Mining Game resources are virtual and are not
            money. Partner offers and surveys appear only after a provider completes commercial
            approval and compliance review.
          </p>

          <p className="mt-3">
            Support is 100% human-operated.{' '}
            <Link href="/sign-in" className="font-medium text-ink-700 underline">
              Sign in
            </Link>{' '}
            to open a ticket.
          </p>
        </div>
      </footer>
    </div>
  );
}
