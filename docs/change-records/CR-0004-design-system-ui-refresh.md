# CR-0004: Design system and full UI refresh

Date: 2026-10-01
Status: Implemented
Spec authority: 09_USER_EXPERIENCE.txt, 10_UI_UX_SPECIFICATION.txt,
13_OFFERWALL_SYSTEM.txt, 37_WITHDRAWAL_SYSTEM.txt, 71_ARCHITECTURAL_LAWS.md
law 45 (fee disclosure) and law 60 (notifications are not support)

## The problem

`src/app/globals.css` was a single line: `@import 'tailwindcss';`. There was no
design system at all, and every page used ad-hoc utility classes. The result read
as a scaffold rather than a product. Four navigation and page links were also
dead: `/earn`, `/tasks/[id]`, `/wallet/withdraw` and `/wallet/deposit`.

## Design direction

The `DESIGNS/` reference shots set the register: a vivid green, pill-shaped
controls, generous radii, large numerals, progress rings, and a mobile-first
layout with bottom tab navigation.

The layout, type scale, spacing and component composition are our own. The
references were direction, not targets to reproduce.

## What was built

- Design tokens in `globals.css`: brand, ink, surface and gamification palettes
  as CSS custom properties, generous radii, elevation, light and dark.
- Primitives in `src/components/ui/`: `Card`, `Pill`, `SectionHeading`,
  `EmptyState`, `Button`, `ButtonLink`, `PillTabs`, `ProgressRing`, `StatTile`,
  `Field`, `TextInput`, `PageHeader`, `BottomNav`.
- `MoneyState` and `BalanceCard`, the component that makes doc 09's
  transparency rule structural.
- Mobile-first application shell with bottom tab navigation.
- All nine pages restyled onto the system.
- New pages closing the four dead links: `/earn`, `/tasks/[id]`,
  `/wallet/withdraw`, `/wallet/deposit`.

## The one component that matters

`MoneyState` derives its colour and its label from the financial state. The
caller cannot pass a tone.

That is deliberate. A caller writing `<span className="text-green-600">` for an
amount is exactly how a pending amount ends up looking settled. Here, `settled`
is the only state that earns the brand colour, so a green number in this system
unambiguously means credited money. Every other state carries an explicit human
label, and `failed` is struck through and reads "no money was credited".

The five states are `pending`, `eligible`, `settled`, `reserved` and `failed`.
They are deliberately NOT the database `reward_state` enum: those are
operational states for the reward engine, whereas these are the states a person
needs to see.

## Gamification colour is quarantined

`--color-gamify-*` (a warm amber) is documented as reserved for XP, levels,
streaks and badges. It is never used for a financial amount, so a virtual reward
can never be mistaken for money (doc 47 SEPARATION).

## What was deliberately NOT copied from the references

| Reference shows                            | Why not shipped                                                                   |
| ------------------------------------------ | --------------------------------------------------------------------------------- |
| SOL/token-denominated task rewards         | Rewards are funded units from `reward_sources`. A task cannot name a token price. |
| A `Complete` button that credits instantly | Doc 12: a claim is evidence. Verification happens first.                          |
| VISA entry, PayPal, gift cards             | Not approved rails. Docs 37/84: MiniPay, manual bank, Celo.                       |
| One merged "Total Balance"                 | Doc 09 requires Earned and Funding balances to read as separate.                  |
| A "Cash Out" primary action                | Withdrawals are requests into a manual operator workflow (law 22).                |

## Defects found and fixed while building this

1. **`/earn` queried columns that do not exist.** `surveys` has
   `base_reward_minor`, not `displayed_payout_minor`, and has no
   `tracking_base_url`. The query would have failed at runtime. TypeScript did
   not catch it because the Supabase admin client is loosely typed. The two
   tables are now queried separately and normalised to one display shape.
2. **A UI race in `TaskActions`.** Branching the button on `phase` meant that
   while a claim was in flight, `phase` was `claiming` and the button reverted to
   "Start task" mid-request. Caught by TypeScript narrowing; now keyed on
   `attemptId`.
3. **Dead links**: `/earn`, `/tasks/[id]`, `/wallet/withdraw`,
   `/wallet/deposit`, plus `/support/[id]` and `/support/new` which remain
   unbuilt.

## Gate status

Typecheck, lint, 128 unit tests, production build (29 routes), migration
structure check, format check and bundle secret scan all pass.

## Outstanding

- `/support/[id]` and `/support/new` are still linked but not built. The Support
  Center list and notifications pages link to them.
- No task admin review surface, so a self-attested claim still cannot be decided
  from the UI.
- The dark theme tokens are defined but not yet wired to a theme switch.
