# CR-0040 - Design-system defect sweep: inert tabs, orphaned errors, a duplicate env key, and the token layer nobody used

Date: 2026-10-09
Scope: `src/app`, `src/components/ui`, `src/lib/auth`, `.env.example`, `docs/DISCREPANCIES.md`

## Why this is one change record

Four unrelated-looking defects, found by auditing the paid-perks prerequisites. They
share a single property: **each one was invisible to every gate in the repository.**
Typecheck, lint, `check:migrations`, `check:data-api`, `check:grants` and the full
547-test suite passed before and after. None of them is a crash.

That is the pattern worth recording, not the individual fixes.

## What was broken

### 1. `PillTabs` was completely inert

It rendered `<button role="tab">` with no `onClick`, no `href` and no form, while
`earn/page.tsx` derived the active tab from `searchParams.tab`. The server decided
which tab was active and the client had no mechanism to change the URL the server
reads. **Clicking "Surveys" did nothing at all**, with no error and with the
appearance of a working tab that simply had no data.

It also had no roving tabIndex, no Arrow/Home/End handling, and `min-h-10` - 40px,
under the 44px tap rule the design system states for every interactive element.

### 2. `TextInput` orphaned its own error

`aria-describedby={hint && !error ? `${id}-hint` : undefined}` resolves the whole
attribute to `undefined` precisely when an error is showing. The error paragraph was
on screen with `role="alert"` and an id, and nothing referenced it.

`role="alert"` fires on **insertion**. A field that is already invalid when it gains
focus - a re-render, validation on blur, a password manager redisplaying the form -
announces nothing. `aria-describedby` is the only durable path to the message.

### 3. `.env.example` declared `NEXT_PUBLIC_SITE_URL` twice, and the empty copy won

```diff
 NEXT_PUBLIC_SITE_URL=https://your-domain.example
-NEXT_PUBLIC_SITE_URL=
```

dotenv resolves a duplicate key to the **last** occurrence. Every operator who copied
the template got an empty site URL - which is exactly the dead referral link Q-62 had
just fixed, reintroduced by the file meant to prevent it. It is the one variable in the
template whose comment explains that it must not be empty, and it was the only one
shipped empty. The defect was in the template, which nothing in the repository reads.

### 4. `safeNext` permitted an open redirect

The callback inlined `next.startsWith('/') && !next.startsWith('//')`. That rejects
`https://evil.com` and `//evil.com` and passes a review reading for "does it allow //".

It **accepts `/\evil.com`**. Browsers normalise a backslash to a forward slash in the
authority position, so that string is protocol-relative and leaves the origin. The
victim arrives on the real domain, completes a real sign-in, and is forwarded to a
look-alike - the standard phishing primitive.

Compounding it, `sign-in/page.tsx` never read `?error=`, so the callback's
`/sign-in?error=auth_callback_failed` produced an ordinary sign-in form with no
explanation. An expired magic link - the most common failure, and the one that looks
most like our fault - looked like we had simply ignored the user.

### 5. The design system was not being used by the design system

`warning` and `gamify` in `PILL_TONE` were the same colour - `bg-gamify-400` at `/30`
and `/25`. A five-point alpha difference is not a distinction.

`STYLE` in `MoneyState.tsx` mapped **both `eligible` and `reserved`** to `warning`. So
"verified and owed to you" and "already claimed by a withdrawal you started" rendered
as one badge. That is doc 09 TRANSPARENCY failing inside the component written to
implement it, and it is the direction doc 47 forbids - a financial state sharing a
colour family with a virtual one.

And the file asserting "no hardcoded hex values in components" was enforced by a gate
that passed: **20 vendor-palette utilities across 13 files** (`bg-red-50`,
`text-red-700`, `border-red-200`) in the auth forms, both wallet forms, both support
forms, the review form, the game shell, and three components of the design system.

## Three decisions worth defending

**Tabs carry their own `href` rather than taking an `hrefFor(key)` callback.** The
callback is the obvious API and it would have typechecked perfectly, then thrown at
runtime: props crossing from a Server Component to a Client Component must be
serialisable, and `earn/page.tsx` is a Server Component. This is invisible to every
gate until the page is rendered.

**`PillTabs` is its own file with `'use client'`, not exported from `Button.tsx`.** It
is the only piece of the segmented control needing a handler. Keeping it beside `Button`
would have put `'use client'` on `Button` and `ButtonLink` as well, pushing them into
the client bundle at every call site in the application for one tab group.

**Arrow keys resolve from the focused tab, not from `activeKey`.** `activeKey` is server
state read from the URL, so between a keypress and the navigation it resolves, it is
stale. Resolving from it made a second rapid ArrowRight land on the same tab again and
the key looked unresponsive. The test for this was written before the fix and caught it.

A fourth, found by the test rather than by me: `event.currentTarget` is the element the
listener is **bound to**, not the element the event came from. On a handler attached to
the wrapping tablist it is the div for every keypress, so it can never identify which
tab fired. `event.target` is correct.

## The gates added

| Test                              | Asserts                                      | Population |
| --------------------------------- | -------------------------------------------- | ---------- |
| `tests/ui/pilltabs.test.tsx`      | tabs are links; APG keyboard; 44px           | -          |
| `tests/ui/field.test.tsx`         | error is reachable via `aria-describedby`    | -          |
| `tests/auth/next.test.ts`         | 25 rejected redirect shapes                  | -          |
| `tests/ui/design-tokens.test.tsx` | distinct financial states; no vendor palette | 99 files   |

Each was written **before** the fix and run against the broken code first. `pilltabs`
failed 6 of 12; `field` failed 1 of 7 with the attribute empty; `next` covers a bypass
that passed the old check; `design-tokens` reported `99 scanned, 14 bad` and named every
file.

`design-tokens.test.tsx` has a guard test asserting it scanned more than 50 files,
because a walk that returns nothing makes its assertion pass vacuously - the Q-22
failure mode, where a predicate matching zero rows was reported as a security assurance.

## Tokens added

`danger` (the only red family; `200` and `900` added so the 1:1 shade mapping did not
have to round), `warning` (orange, hue ~55-68, held below gamify's gold at ~80-92), and
`locked` (cool slate, hue ~250) for money that is real, credited and already claimed.

## Explicitly not done here

- **Decorative `THEME` perks.** Remain entitlement-gated and unbuilt. The Light/Dark
  accessibility pair is not that perk, per Q-64's scope boundary.
- **The logo asset itself.** See "Follow-on" below.

## Follow-on, 2026-10-09 - the four open items

All four items this record listed as outstanding were completed, and completing them
surfaced two further defects that are recorded as Q-66 and Q-67.

### The auth regression tests, and what they found

`tests/auth/callback-route.test.ts` asserts the ROUTE's property rather than the
helper's: every redirect it can emit, on every branch, stays on this origin. A unit
suite for `safeNext` cannot see that the route stopped calling it, and cannot reach
the failure branch at all - which is a separate piece of code and where an open
redirect is just as possible. The error redirect is hardcoded and stays that way;
there is a test pinning that `next` is not appended to it.

`tests/auth/sign-in-errors.test.ts` covers the allowlist, and writing it turned up a
crash that had been shipping since the allowlist was first added. `AUTH_ERRORS` is an
object literal, so `AUTH_ERRORS['toString']` is `Object.prototype.toString` - a
**function** - the `??` fallback never fires, and React is handed a function as a
child. `GET /sign-in?error=toString` was a blank page. Fixed with `Object.hasOwn`,
recorded as Q-66, and proven: the `??` form was re-injected and produced 10 named
failures before the file was restored.

### The PillTabs activation policy

The open question was whether `PillTabs` needs an explicit one. It does, because the
code and its comment disagreed. The comment claimed automatic activation; the earn
page's tabs are links, the earn page passes no `onSelect`, and so a link was never
activated by an arrow key - focus moved and nothing happened.

Manual activation is the CORRECT behaviour for a link, and APG is explicit that
automatic activation is wrong when activating a tab costs a page load. So the
component now **derives** the mode from the items and `activation` overrides it. The
test that asserted "automatic" was asserting it against a group that never had that
behaviour, and it passed because the test supplied an `onSelect` the real caller does
not. Also added: `aria-controls` and matching tabpanel ids, wired on the earn page
through shared exported helpers so the two cannot drift.

### The dark theme

The token layer was restructured so a scheme can be switched at runtime:

    :root / [data-theme='dark']   raw VALUES, one per scheme
    @theme inline                 NAMES, mapped to those values

A value written directly in `@theme` is compiled into the utility, so there is one of
it and no seam to switch at. Verified against the BUILT stylesheet rather than the
source, because a source-level check passes either way:

    .bg-surface      ->  background-color: var(--surface)
    .text-ink-900    ->  color: var(--ink-900)

`--elev-*` shadows are the one token that cannot simply invert - at the opacity that
reads correctly on white they are invisible on near-black - so they go deeper and
stronger instead. Both schemes declare `color-scheme`, or a dark page keeps a white
scrollbar.

Three implementation decisions worth keeping:

1. **The bootstrap script is generated from the module's constants**, not written
   twice. It runs in `<head>` before React exists, so the code that decides what a
   visitor sees on arrival is otherwise untestable.
2. **The preference is an external store, read with `useSyncExternalStore`.**
   `localStorage` and `matchMedia` both live outside React. The first version used
   `useState` plus an effect, which produced a cascading render on every mount and a
   worse bug: the `matchMedia` handler set state without re-applying `data-theme`, so
   an OS change at sunset updated the caption under the control and left the page
   light. That was caught by a test written before the fix.
3. **The control uses native radio inputs**, visually hidden but focusable, so arrow
   keys, the single tab stop and the "2 of 3" announcement come from the platform
   rather than from hand-rolled roving-tabindex code.

`tests/ui/theme.test.ts` reads the stylesheet and enforces that every token has BOTH
schemes AND a mapping. A missing mapping compiles to no utility at all: `bg-danger-50`
renders nothing, with no error anywhere in the build. Proven by removing one token's
dark value and its mapping - the gate named `--gamify-600` in both assertions.

### The brand lockup

`BrandLockup` replaces four verbatim copies. The logo is **not** swapped in: see Q-68.
`AVERRA_LOGO.png` is a 1254x1254 presentation mockup - a full lockup on an opaque
near-black square, in blue to purple, with no transparent export and no vector. It
cannot render at 32px, and its gradient contradicts every green token in the system.

Generating a substitute vector was considered and rejected: an invented mark presented
as an asset is indistinguishable from a delivered one at review time, and nobody
downstream could tell which parts of the brand were designed. The refactor makes the
swap a one-file change once a transparent vector arrives.

### A Server Component cannot CALL a value from a `'use client'` module

Fixing the `PillTabs` inertness created a new defect, and it is the only one in this
record that four separate tools accepted.

Making the tabs real links meant each tab needed an `id` and an `aria-controls`
naming its panel. The panel is rendered by the **earn page**, a Server Component, and
the tabs by `PillTabs`, a `'use client'` module. The two ids have to come from the same
helpers, so those helpers were exported from `PillTabs.tsx` and the earn page called
them to build its `aria-labelledby`.

That throws, at render, on every load of `/earn`:

    Attempted to call pillTabPanelId() from the server but pillTabPanelId is on
    the client. It's not possible to invoke a client function from the server.

In the App Router a value exported from a `'use client'` module reaches a Server
Component as a **client reference** - a proxy object, not a function. Rendering one is
legal and is the intended pattern; calling one is not. So the helpers moved to
`src/components/ui/pillTabIds.ts`, which carries no directive, and the earn page
imports them from there.

**Do not "fix" the old import path by re-exporting.** `export { pillTabId } from
'./pillTabIds'` inside the client module re-wraps them as client references and
restores the crash exactly, while looking like the tidier diff.

### `check:server-imports`, and the reason it is scoped to CALLS

The defect passed `tsc`, `eslint`, all 654 vitest tests and `next build`. Every one of
them resolves the module correctly; only the browser executes the call. So the gate
fails on a non-client module that imports a name from a `'use client'` module **and
calls it**.

Two boundaries it deliberately does not cross:

1. **It does not fail on importing.** `<PillTabs />` imported from a client module is
   the correct pattern. A gate that flagged it would be unusable within one commit.
2. **It does not fail on type-only imports.** `import type { X }` erases at compile
   time and crosses the boundary as nothing; every Server Component types its props
   that way.

PascalCase names are skipped - a component is PascalCase by convention, and calling
one as a plain function is a separate, rarer defect. Merging the two rules would make
this one noisier.

It prints its population (`26 client modules, 154 source files, 25
server-to-client imports`) beside the bad count, and refuses to pass on an empty
population, because `0 bad` from a predicate that matched nothing is the failure mode
this repository has now paid for three separate times.

Proven by re-injection, not by a clean run:

| Injected | Result |
| --- | --- |
| earn page importing both helpers from `PillTabs` | exit 1, both call sites named with correct line numbers |
| a `src/` containing no client modules | exit 1, "refusing to pass vacuously" |
| the fix, restored byte-identically | exit 0 |

Worth recording from that exercise: the first draft of the detector reported **0 client
modules** across the whole of `src/`, because it compared against `use client` instead
of `'use client'`. It would have passed on the injected defect too. A gate that has
never been shown to fail proves nothing, and this one would have shipped as a gate that
quietly matched nothing.
