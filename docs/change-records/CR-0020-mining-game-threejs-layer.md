# CR-0020 - Mining Game Three.js rendering layer (docs 17, 31)

Date: 2026-10-03
Status: APPLIED to `src/lib/game/scene.ts`, `src/components/game/GameScene.tsx`,
`src/components/game/GameScenePanel.tsx` and `tests/game/scene.test.ts`. No
migration, no new API, no database change. Browser rendering is NOT visually
verified - see Outstanding.

## What prompted this

The conformance snapshot listed the Mining Game Three.js shell as **ABSENT**,
which was true but understated. `three@0.186.1` was already a dependency in
`package.json` and imported **nowhere** - a 600KB dependency shipping in every
build and rendering nothing. The existing `GameShell.tsx` is a 438-line DOM
client.

Doc 17 is only 36 lines and constrains _behaviour_, not appearance. What it does
settle, and what this change is built around:

> Three.js renders client presentation and interaction; it does not
> authoritatively decide inventory, rewards, progression, or energy.

## The design decision: additive, not a replacement

`GameShell.tsx` is **not modified**. It works, and it is the single place a game
action is issued from. Doc 31 splits client responsibilities (rendering, input,
animation, interpolation, non-authoritative prediction) from the server's
authoritative fields, so both halves can coexist correctly. The 3D layer is a view
over the same authoritative snapshot; there is exactly one action path.

Had this replaced `GameShell`, the risk was a regression across six working
actions (START, STOP, COLLECT, DEPLOY, UPGRADE, CLAIM_MISSION) in exchange for a
rendering change. That is a bad trade on a page with no financial authority to
gain from it.

## What was built

### `src/lib/game/scene.ts` - pure, unit tested

A WebGL canvas cannot be meaningfully unit tested, so every decision with
arithmetic in it was pushed here and pinned in `tests/game/scene.test.ts`
(39 assertions). The renderer consumes these and only draws.

- `machineTransform(slot, total)` - placement from the server-assigned
  `locationSlot`.
- `visualForMachineState(state)` - returns animation INTENT, not colour, so the
  module has no opinion about appearance and its tests stay behavioural.
- `shouldApplySnapshot` / `newestVersion` - the client half of doc 31 CONCURRENCY.
- `interpolatedEnergy` - display-only energy easing.

## Three defects found while building this

**1. `machineTransform` had no notion of how many machines exist.** The first
implementation centred the _maximum_ grid width, so a world holding one machine
placed it at x = -3.2. A lone machine off to one side of an empty viewport reads
as a rendering bug. Caught by a failing test asserting a single machine centres.
Fixed by taking `total` and centring each row on the machines actually in it.

**2. A version test asserted the wrong direction, and was passing for the wrong
reason.** The test read:

```ts
// as STRINGS, '99' > '100'
expect(shouldApplySnapshot('100', '99')).toBe(true);
```

That is backwards. Numerically 99 < 100, so a stale 99 arriving over a current
100 **must be rejected**. The original expectation would have encoded a guard that
accepts stale state at exactly the digit boundary where version strings stop
sorting like numbers. Fixed to `false`, which is what makes it a real lexical-
versus-numeric test.

**3. A test claimed a clock-tampering guarantee it was not actually checking.**
"clock set to year 3000 returns exactly energyMax" passed - but only because the
preview window is capped at five minutes, not because of the clamp it appeared to
be testing. Two independent guards, one test, and the stronger-looking assertion
was the weaker one. Split into two tests that pin the cap and the clamp
separately.

## The two guards, proven to fail

Doc 17 SECURITY: "Never trust hidden client variables ... as financial/game
authority." `interpolatedEnergy` is the only place a client-side clock touches a
number, so it is clamped twice: `ENERGY_PREVIEW_CAP_MS` bounds elapsed time, and
the result is clamped to `energyMax` and floored at the stored value.

Per the rule this repository has been burned by three times, the clamp was
proven to fail before being trusted. Removing the clamp failed exactly two
named assertions:

    npm test -- tests/game
      interpolatedEnergy > clamps to exactly energyMax when regen would overshoot it
      interpolatedEnergy > clamps a stored value that already exceeds the maximum
      Tests  2 failed | 37 passed

Restored, and the note at the clamp records that removing it leaves the year-3000
test **passing** - which is correct rather than a gap, because each guard has its
own test. Collapsing them into one assertion would have hidden that.

## Verification

    typecheck               clean (tsc --noEmit)
    lint                    clean (eslint .)
    test                    239 passed (13 files), was 200 / 12
    build                   Compiled successfully
    check:bundle            OK - 23 client assets, no secrets
    prettier --check        clean

Bundle: three.js is confirmed isolated in a **529 KB lazy chunk**, not in the
initial load, because `GameScenePanel` imports `GameScene` through
`next/dynamic` with `ssr: false`. The DOM shell paints first.

## Invariants held

- **Law 26** - the scene renders no currency, no balance and no withdrawal, and
  imports no `MoneyState`. The panel states the rule on the surface itself.
- **Doc 17 THREE.JS ROLE** - nothing in `GameScene.tsx` writes state. Every action
  still travels through `GameShell`'s existing POSTs to `/api/game`.
- **Doc 31 CONCURRENCY** - a snapshot older than the rendered `stateVersion` is
  discarded rather than drawn.
- **Doc 17 SECURITY** - a tampered clock cannot fill the energy bar.
- **Doc 17 PERFORMANCE** - DPR capped, render loop stops when the canvas leaves
  the viewport or the tab hides, `prefers-reduced-motion` renders one static
  frame, and every geometry, material and the WebGL context itself is disposed
  on unmount.
- **Accessibility** - the canvas carries `role="img"` and a descriptive label,
  because a canvas conveys nothing to assistive technology.

## Outstanding

- **The rendering is NOT visually verified.** There is no `tests/e2e` directory
  and no Playwright browser cache in this environment, so the scene has never
  been drawn. Correctness rests on the pure module being exhaustively tested plus
  a defensive guard that catches WebGL context failure and leaves the page
  working. The pixels need one manual pass on `npm run dev` at `/game`.
- **Machines are cylinders.** Doc 17 calls for GLB/GLTF assets, LOD, instancing
  and texture budgets, and this is deliberately none of those: there is no asset
  pipeline and no asset provenance record in the repository, and inventing meshes
  would assert art direction the spec does not state. Primitive geometry with
  `locationSlot` placement is the honest interim.
- **No texture or audio.** Doc 17 LAYERS lists both.
- **The scene is read-only.** No raycasting or click-to-interact, so all actions
  stay in the DOM shell. That is a deliberate consequence of there being one
  action path.

## Files changed

    src/lib/game/scene.ts                      new
    src/components/game/GameScene.tsx          new
    src/components/game/GameScenePanel.tsx     new
    tests/game/scene.test.ts                   new (39 assertions)
    src/app/(app)/game/page.tsx                2 added lines + import
