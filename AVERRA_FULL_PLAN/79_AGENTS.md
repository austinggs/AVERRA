AVERRA — AVERRA — AGENT ROLES

Document: 79_AGENTS.md
Version: 1.0
Status: Approved planning baseline
Last reviewed: 2026-09-30

PURPOSE
Defines recommended specialized AI/software-engineering agent responsibilities.

NORMATIVE LANGUAGE
The terms MUST, MUST NOT, REQUIRED, SHALL, SHALL NOT, SHOULD, SHOULD NOT, and MAY are used as engineering requirements.

PLANNING AGENT
Translates approved specs into atomic implementation tasks without inventing business rules.

BACKEND AGENT
Implements API/domain services, transactions, events, integrations, and jobs while preserving invariants.

FRONTEND AGENT
Implements UX and state presentation; never moves authority into the client.

GAME AGENT
Implements Three.js runtime, world, gameplay UI, and game server contracts.

DATABASE AGENT
Designs migrations, constraints, indexes, and queries with integrity/performance checks.

SECURITY AGENT
Threat modeling, code review, webhook/financial/game security tests, secret/privacy checks.

TESTING AGENT
Builds deterministic unit/integration/E2E/financial/security/performance suites.

DOCS/OPS AGENT
Maintains source index, runbooks, progress, change records, and acceptance evidence.

CROSS-AGENT RULE
All agents obey ARCHITECTURAL_LAWS and SOURCE_INDEX. No agent can redefine core business rules unilaterally.

IMPLEMENTATION NOTES
This document is a planning/source-of-truth artifact. Concrete library choices, exact endpoint names, provider-specific payload formats, and deployment values may be finalized during implementation only when they preserve the stated invariants and pass the defined verification gates.

RELATED DOCUMENTS
See 71_ARCHITECTURAL_LAWS.md, 82_SOURCE_INDEX.md, and the domain-specific database/API/acceptance documents for cross-system contracts.


CUSTOMER SUPPORT BOUNDARY
AI coding/development agents are strictly development tools. They must not be exposed as Averra customer-support agents, must not generate customer-facing support replies in production, and must not make financial/support decisions on behalf of human operators.

REVIEW / COMMUNITY RESPONSIBILITIES
Frontend Agent: review cards, rating displays, thread UI, media upload UX, reports, and moderation views without moving authorization client-side.
Backend Agent: review/comment APIs, Verified Experience lookup, notifications, moderation commands, and policy enforcement.
Database Agent: review/comment/report/media schema, indexes, RLS, constraints, and Storage metadata.
Security Agent: review/media authorization, upload abuse, IDOR/BOLA, and public/private data separation.
Testing Agent: deterministic review, media, moderation, and notification test coverage.
Docs/Ops Agent: moderation policy, support boundaries, retention, and progress/acceptance evidence.
