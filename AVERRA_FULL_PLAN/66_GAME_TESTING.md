AVERRA — AVERRA — GAME TESTING

Document: 66_GAME_TESTING.md
Version: 1.1
Status: Approved planning baseline
Last reviewed: 2026-10-07

AMENDMENT CR-0035 (2026-10-07)
- 88_ECONOMIC_SIMULATION.md and 89_NUMERIC_AND_MONEY_REPRESENTATION.md are added
  as the authoritative requirement for economic simulation.
- Documents 15-34 (Mining Game) are SUPERSEDED and retained verbatim as history.
  Their testing requirements are retained as history only and are no longer
  current obligations for new work.
- Mining is DORMANT. Mining regression coverage MUST NOT be deleted as part of
  planning work; it is removed only at CR-0045.
- OBLIGATIONS FOR THE FUTURE DOMAIN, recorded here so they are not lost:
  a price MUST be provably identical when computed twice from the same
  (canonical epoch, tick, asset, seed); a monetary value MUST NOT be representable
  as `real`, `double precision` or a JavaScript number; and a pgTAP test MUST
  assert that no virtual amount, provisional estimate or game credit can reach a
  real ledger entry. These are assertions, not lint checks.
- This CR changed documentation only. No code, schema, migration, test,
  configuration, feature flag, UI or API was changed.

PURPOSE
Comprehensive testing requirements for the Three.js Mining Game.

NORMATIVE LANGUAGE
The terms MUST, MUST NOT, REQUIRED, SHALL, SHALL NOT, SHOULD, SHOULD NOT, and MAY are used as engineering requirements.

CLIENT TESTS
Rendering initialization, input, UI state, asset loading, degraded-performance behavior, networking reconciliation, and error handling.

SERVER TESTS
Energy, inventory, machine operations, production, missions, upgrades, achievements, events, leaderboard scoring, and authority boundaries.

MANIPULATION TESTS
Tampered resource quantities, client clocks, replayed actions, altered action ordering, duplicate claims, stale versions, fabricated completion requests.

PERSISTENCE TESTS
Reload/reconnect/device change preserves server state and does not duplicate events.

FINANCIAL BRIDGE
Game events cannot bypass Reward Engine; duplicate and reversed reward cases are tested end-to-end.

IMPLEMENTATION NOTES
This document is a planning/source-of-truth artifact. Concrete library choices, exact endpoint names, provider-specific payload formats, and deployment values may be finalized during implementation only when they preserve the stated invariants and pass the defined verification gates.

RELATED DOCUMENTS
See 71_ARCHITECTURAL_LAWS.md, 82_SOURCE_INDEX.md, and the domain-specific database/API/acceptance documents for cross-system contracts.
