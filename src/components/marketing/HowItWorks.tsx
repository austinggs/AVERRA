'use client';

import { useRef, useState } from 'react';
import { cx } from '@/components/ui/Card';

// The earning lifecycle, as an interactive stepper.
//
// WHY THIS IS A STEPPER AND NOT FOUR STATIC CARDS
//
// The old landing page described the same four guarantees in four static
// blocks, and they read as filler because a reader had no way to tell which
// mattered to them. A sequence does something the static version could not: it
// shows that verification is a STAGE, and that a claim a user submits is
// deliberately not the credit. Someone who reaches step 2 and stops has
// understood the product better than one who skims four paragraphs.
//
// SELECTION IS LOCAL STATE AND NOTHING ELSE.
//
// No query parameter, no cookie, no round trip. It cannot become a tracking
// surface, a shareable link, or anything that touches a balance. Keyboard
// behaviour is a real `tablist`, matching the pill filter pattern in
// `Button.tsx`, so the two do not feel like different products.

interface Step {
  key: string;
  label: string;
  title: string;
  body: string;
}

// A NON-EMPTY TUPLE, not `Step[]`.
//
// `noUncheckedIndexedAccess` is on in this repo, so `STEPS[0]` on a plain array
// is `Step | undefined` and every downstream use of `active` inherits that.
// The fix is to state the fact the code already relies on - this list is never
// empty - rather than to scatter `!` assertions or an `as Step` cast that
// would compile even if someone deleted every entry.
const STEPS: readonly [Step, ...Step[]] = [
  {
    key: 'claim',
    label: 'Claim',
    title: 'You complete the work',
    body: 'A native task, a partner offer, or a survey. Finishing it puts forward a claim — and a claim is only ever evidence that you said you did it.',
  },
  {
    key: 'verify',
    label: 'Verify',
    title: 'We check it ourselves',
    body: 'Server-side checks decide what counts. A self-submitted completion cannot verify itself, and no browser can confirm its own reward. That separation is the whole product.',
  },
  {
    key: 'settle',
    label: 'Settle',
    title: 'The provider pays us',
    body: 'Partner money arrives on the provider’s own schedule, sometimes months later. We release a reward only once a settlement matches our records exactly.',
  },
  {
    key: 'withdraw',
    label: 'Withdraw',
    title: 'You choose, we disclose',
    body: 'Gross, fee and net are all shown before you confirm. Reserved balance is deducted on settlement, and the ledger is never rewritten.',
  },
];

export function HowItWorks() {
  const [activeKey, setActiveKey] = useState(STEPS[0].key);

  // Falls back to the first step if `activeKey` ever holds something that is not
  // in the list, so a stale state value renders a panel rather than crashing.
  const active = STEPS.find((step) => step.key === activeKey) ?? STEPS[0];
  const activeIndex = STEPS.indexOf(active);

  // ROVING FOCUS NEEDS A REACHABLE TARGET.
  //
  // The tabs use `tabIndex={selected ? 0 : -1}`, which is the APG tabs pattern -
  // one stop in the tab order, arrow keys to move within. That is only correct if
  // the arrow keys actually work. Without this handler the unselected tabs had
  // `tabIndex = -1` AND no other way to be focused, so a keyboard user could reach
  // step 1 and then be permanently stuck: three of the four lifecycle steps were
  // mouse-only. The roving tabindex made the regression worse, because a plain
  // button with no tabindex would at least have been reachable with Tab.
  //
  // `null` entries are the normal case for a ref that has not mounted yet, so the
  // focus call is guarded rather than asserted.
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  function focusStep(index: number): void {
    const bounded = (index + STEPS.length) % STEPS.length;
    const next = STEPS[bounded];
    if (!next) return;

    setActiveKey(next.key);
    tabRefs.current[bounded]?.focus();
  }

  function onTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>): void {
    // Only the keys the APG tabs pattern defines. Anything else - including
    // PageUp/PageDown, which scroll the page - is left to the browser, because a
    // handler that swallows unlisted keys steals behaviour nobody asked it to.
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault();
        focusStep(activeIndex + 1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault();
        focusStep(activeIndex - 1);
        break;
      case 'Home':
        event.preventDefault();
        focusStep(0);
        break;
      case 'End':
        event.preventDefault();
        focusStep(STEPS.length - 1);
        break;
      default:
        break;
    }
  }

  return (
    <div>
      <div
        role="tablist"
        aria-label="How earning works"
        className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {STEPS.map((step, index) => {
          const selected = step.key === activeKey;

          return (
            <button
              key={step.key}
              type="button"
              role="tab"
              id={`step-tab-${step.key}`}
              aria-selected={selected}
              aria-controls={`step-panel-${step.key}`}
              // The `id` above is what the PANEL points back at via
              // `aria-labelledby`. The attribute does NOT belong on the tab
              // itself: it names what labels the tab, and a tab is not labelled
              // by the panel it reveals.
              //
              // An UNSELECTED tab's `aria-controls` points at a panel that is not
              // mounted. That is correct ARIA for a single-panel tablist rather
              // than a dangling reference - assistive technology ignores an absent
              // id - and `tests/marketing/how-it-works.test.tsx` asserts the pair
              // that must resolve: the SELECTED tab and its panel.
              tabIndex={selected ? 0 : -1}
              ref={(node) => {
                tabRefs.current[index] = node;
              }}
              onClick={() => setActiveKey(step.key)}
              onKeyDown={onTabKeyDown}
              className={cx(
                'inline-flex min-h-11 shrink-0 items-center gap-2 rounded-pill px-4 text-sm font-semibold transition-colors',
                selected
                  ? 'bg-brand-500 text-white shadow-tile'
                  : 'border border-ink-200 bg-surface text-ink-500 hover:bg-surface-sunken hover:text-ink-700',
              )}
            >
              <span
                className={cx(
                  'grid size-5 place-items-center rounded-pill text-[0.6875rem] font-bold tabular-nums',
                  selected ? 'bg-white/25 text-white' : 'bg-ink-100 text-ink-500',
                )}
              >
                {index + 1}
              </span>
              {step.label}
            </button>
          );
        })}
      </div>

      {/*
        Only the selected panel is mounted, and it carries BOTH ids so
        `aria-controls` and `aria-labelledby` agree. `min-h` reserves roughly the
        tallest panel so switching tabs does not jump the content below it.

        `key={active.key}` remounts the panel, which is what re-runs the rise
        animation. Without it the class is already applied and nothing moves.
      */}
      <div
        role="tabpanel"
        id={`step-panel-${active.key}`}
        aria-labelledby={`step-tab-${active.key}`}
        key={active.key}
        className="mt-4 min-h-[11rem] animate-rise rounded-card border border-ink-100 bg-surface p-5 shadow-card md:min-h-[9rem] md:p-6"
      >
        <div className="flex items-start gap-4">
          {/*
            The live progress rail. `aria-hidden` because it restates what the
            numbered tabs and the panel heading already say - a screen reader
            announcing "2 of 4" a third time is noise, not information.
          */}
          <div className="hidden shrink-0 flex-col items-center gap-2 sm:flex" aria-hidden="true">
            {STEPS.map((step, index) => (
              <span
                key={step.key}
                className={cx(
                  'relative grid size-8 place-items-center rounded-pill text-xs font-bold tabular-nums transition-colors',
                  index < activeIndex
                    ? 'bg-brand-100 text-brand-700'
                    : index === activeIndex
                      ? 'bg-brand-500 text-white'
                      : 'bg-ink-100 text-ink-400',
                )}
              >
                {index + 1}
                {index === activeIndex ? (
                  <span className="absolute inset-0 animate-pulse-ring rounded-pill bg-brand-500" />
                ) : null}
              </span>
            ))}
          </div>

          <div className="min-w-0">
            <h3 className="text-lg font-bold tracking-tight text-ink-900">{active.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-ink-500">{active.body}</p>
          </div>
        </div>
      </div>

      <p className="mt-3 text-xs leading-relaxed text-ink-500">
        Step {activeIndex + 1} of {STEPS.length}. Verification and settlement are the slow parts,
        and we do not hide them — a claim is never described to you as a payment.
      </p>
    </div>
  );
}