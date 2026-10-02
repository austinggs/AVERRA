AVERRA — AVERRA — GAME TESTING

Document: 66_GAME_TESTING.md
Version: 1.0
Status: Approved planning baseline
Last reviewed: 2026-09-29

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
