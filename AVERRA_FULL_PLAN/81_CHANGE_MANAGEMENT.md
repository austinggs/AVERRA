AVERRA — AVERRA — CHANGE MANAGEMENT

Document: 81_CHANGE_MANAGEMENT.md
Version: 1.0
Status: Approved planning baseline
Last reviewed: 2026-09-29

PURPOSE
Defines how product, schema, API, payment, provider, and architecture changes are proposed and approved.

NORMATIVE LANGUAGE
The terms MUST, MUST NOT, REQUIRED, SHALL, SHALL NOT, SHOULD, SHOULD NOT, and MAY are used as engineering requirements.

CHANGE CLASSES
Cosmetic, behavior, schema, financial, provider, security, compliance, architecture, emergency.

IMPACT ASSESSMENT
Identify affected source docs, data model, APIs, migrations, tests, financial flows, security/privacy, operations, and rollback.

APPROVAL
Financial, payout, provider, security, compliance, and architectural changes require the appropriate review before production.

COMPATIBILITY
Prefer additive/backward-compatible changes; version APIs/contracts when necessary.

DOCUMENTATION SYNC
Every approved change updates affected TXT/MD source documents and SOURCE_INDEX references before or alongside implementation.

EMERGENCY
Emergency changes may temporarily disable a subsystem but must be documented retrospectively and reviewed.

IMPLEMENTATION NOTES
This document is a planning/source-of-truth artifact. Concrete library choices, exact endpoint names, provider-specific payload formats, and deployment values may be finalized during implementation only when they preserve the stated invariants and pass the defined verification gates.

RELATED DOCUMENTS
See 71_ARCHITECTURAL_LAWS.md, 82_SOURCE_INDEX.md, and the domain-specific database/API/acceptance documents for cross-system contracts.
