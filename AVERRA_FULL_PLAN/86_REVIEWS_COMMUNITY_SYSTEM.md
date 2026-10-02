AVERRA — REVIEWS & COMMUNITY FEEDBACK SYSTEM

Document: 86_REVIEWS_COMMUNITY_SYSTEM.md
Version: 1.0
Status: Approved planning baseline
Last reviewed: 2026-09-30

PURPOSE
Defines Averra's public review, rating, threaded discussion/chat, image attachment, authenticity, moderation, reporting, privacy, storage, and administration model.

CORE PRODUCT BEHAVIOR
Users may rate and review their experience with Averra so other users can see aggregated and individual feedback. A review may contain a 1–5 star rating, written text, an optional category, and optional image attachments. Each review has a threaded conversation area where other users may reply and optionally attach images.

The review/community system is public-facing and separate from private Support tickets. Reviews are designed to communicate user experience, not to replace account support or financial case handling.

PUBLIC REVIEW SURFACE
The product SHOULD expose:
- Overall average rating and review count.
- Review list with pagination/infinite loading.
- Rating distribution.
- Category/filter controls where useful.
- Review date and author display name/pseudonym according to profile privacy settings.
- Verified Experience indicator when the review is linked to a qualifying Averra event.
- Threaded replies/comments beneath each review.
- Report controls on reviews, comments, and media.

REVIEW CREATION
A review form MUST support:
- Star rating: 1–5.
- Written review text.
- Optional category.
- Optional image attachments.
- Clear publication confirmation.
- Disclosure that reviews are public and may receive replies.

A user SHOULD be eligible to submit a review only where the account satisfies configured anti-abuse/experience criteria. The exact minimum activity rule is configurable. Where a review references a specific platform event, the system SHOULD associate that event reference so authenticity can be checked without exposing private financial details.

REVIEW AUTHENTICITY
A review MAY receive a "Verified Experience" indicator when Averra can verify that the account had the underlying interaction, such as a completed task, completed withdrawal, confirmed deposit, Mining Game purchase, or support interaction where the underlying event is appropriate to disclose.

The indicator means only that the underlying interaction was verified. It does NOT mean Averra agrees with, endorses, guarantees, or approves the contents of the review.

Averra MUST NOT pay, reward, unlock monetary benefits, or otherwise condition financial rewards on a positive review. Reviews must not be solicited with misleading promises such as guaranteed payment for favorable ratings.

THREAD / CHAT MODEL
Each review MAY contain a threaded discussion. Other eligible users may reply to the review and to configured thread levels, subject to moderation and rate limits.

The thread is a public community conversation, not private messaging. The initial implementation does not require arbitrary user-to-user direct messages. A private support matter must move to the Support Center.

IMAGE SUPPORT
Users may attach images to reviews and thread messages.

Recommended initial constraints:
- JPEG, PNG, and WebP only unless later expanded by policy.
- Server-enforced maximum file size.
- Server-enforced maximum image dimensions.
- Safe filename normalization.
- Content-type verification based on actual file bytes, not only the client-reported MIME type.
- Strip unnecessary metadata where practical, especially location metadata.
- Generate safe derivative sizes for public display.
- Store original/derived media under controlled object-storage paths.

Supabase Storage is the intended initial object-storage layer. Media metadata and moderation state remain in PostgreSQL. Public media access must use a deliberate access policy; private/moderation evidence must not become publicly readable through a predictable URL.

MODERATION
Reviews, comments, and attached images are user-generated content and require moderation controls.

Required capabilities:
- Report review.
- Report comment.
- Report image/media.
- Admin moderation queue.
- Hide/remove content.
- Restore content where appropriate.
- Block or mute abusive accounts where supported.
- Spam and rate-limit controls.
- Reason codes.
- Moderator identity and timestamp.
- Appeals or reconsideration workflow where appropriate.
- Moderation audit log.

AI BOUNDARY
Averra customer support remains 100% human-operated. AI-generated customer-support replies are prohibited.

For the initial review system, AI MUST NOT write or send public support replies, private support replies, moderation decisions, or public responses on behalf of Averra. Automated technical safeguards such as file-size/type validation, rate limiting, duplicate detection, and abuse heuristics are allowed when they are deterministic/system rules rather than AI-authored conversations or financial/support decisions. Human moderators retain authority over content removal, restoration, and escalated abuse decisions.

FINANCIAL / SUPPORT SEPARATION
A review or community message MUST NOT directly change balances, deposit status, withdrawal status, reward status, fraud decisions, or other financial state.

A public review may link internally to a private support case or financial record for verification, but private evidence MUST NOT be exposed publicly.

Support tickets remain the authoritative channel for account-specific problems. A Telegram conversation with @vipaverra remains a support intake channel and must not be treated as a financial authority.

ANTI-MANIPULATION
The system SHOULD detect and control:
- Review spam.
- Multiple reviews tied to the same qualifying event.
- Rapid high-volume posting.
- Coordinated abuse.
- Incentivized positive-only reviewing.
- Duplicate media or copied content where detectable.
- Reviews from accounts with conflicting risk signals.

Financial/reward systems MUST NOT grant extra earnings merely because a user posts a review or reply. Any future review-related promotion must be separately specified, legally reviewed, and must not condition monetary benefits on favorable sentiment.

EDITING / DELETION
Users may edit or request removal of their own review according to configured rules. Edits MUST preserve an audit trail. Soft deletion is preferred so moderation and audit records remain reconstructable.

Deleting a review MUST NOT delete or modify the underlying financial or platform event it refers to.

RATINGS
The public average should be computed only from reviews that meet publication rules. Removed/rejected content must not continue to affect the public rating unless explicitly retained for a documented reason.

The UI SHOULD distinguish total review count from verified-review count. The platform MUST NOT manufacture ratings, suppress authentic negative reviews solely because they are negative, or present a selected rating as a verified fact when it is only a user opinion.

DATABASE MODEL
Logical tables:
- reviews
  - id
  - user_id
  - rating
  - title (optional)
  - body
  - category
  - status
  - verification_type
  - verified_experience_type
  - verified_experience_id/reference
  - created_at
  - updated_at
  - published_at
  - deleted_at

- review_media
  - id
  - review_id
  - uploader_id
  - storage_path
  - mime_type
  - byte_size
  - width
  - height
  - metadata_stripped
  - status
  - created_at

- review_comments
  - id
  - review_id
  - parent_comment_id where threaded replies are enabled
  - user_id
  - body
  - status
  - created_at
  - updated_at
  - deleted_at

- review_comment_media
  - id
  - comment_id
  - uploader_id
  - storage_path
  - mime_type
  - byte_size
  - width
  - height
  - metadata_stripped
  - status
  - created_at

- review_reports
  - id
  - reporter_id
  - target_type
  - target_id
  - reason_code
  - details
  - status
  - resolved_by
  - resolved_at
  - created_at

- review_moderation_actions
  - id
  - target_type
  - target_id
  - action
  - reason_code
  - moderator_id
  - created_at
  - evidence_reference

AUTHORIZATION / RLS
Every exposed review/community table MUST have an explicit access model and Row Level Security. Public read access should reveal only published public content. User write access must be limited to the user's own content. Moderation writes are restricted to authorized moderator/admin roles.

Do not rely on client-supplied profile metadata for authorization. Authorization data must live in trusted server-side claims/roles or database records protected by policy.

API SURFACE
Illustrative contracts:
- GET /reviews
- POST /reviews
- GET /reviews/:id
- PATCH /reviews/:id
- DELETE /reviews/:id or soft-delete equivalent
- POST /reviews/:id/comments
- PATCH /reviews/comments/:id
- DELETE /reviews/comments/:id
- POST /reviews/:id/media
- POST /reviews/comments/:id/media
- POST /reviews/:id/report
- POST /reviews/comments/:id/report
- POST /reviews/media/:id/report
- GET /admin/reviews
- GET /admin/review-reports
- POST /admin/reviews/:id/moderate

All write endpoints require authentication and server-side authorization. Mutations SHOULD be idempotent where retry duplication is possible.

NOTIFICATIONS
When someone replies to a user's review, the system MAY create an in-app notification. The notification is a factual system event, not an AI-generated conversational response. Initial delivery uses Averra's first-party notification records and does not require a paid notification provider.

REALTIME / CHAT EXPERIENCE
Realtime updates MAY be added through Supabase Realtime where beneficial. Realtime delivery is an enhancement; the database remains authoritative. A user must be able to refresh and recover the full conversation from persisted records.

SUPABASE IMPLEMENTATION
Supabase PostgreSQL is the authoritative store for reviews, comments, reports, moderation actions, and media metadata. Supabase Storage is the intended media store. RLS is required on exposed tables. Server-side functions or controlled backend routes may enforce privileged moderation operations.

New public-schema tables must not assume automatic Data API exposure. Explicit grants and RLS should be reviewed for every exposed relation because current Supabase projects can require explicit opt-in for newly created public tables.

VERCEL IMPLEMENTATION
The Averra web application is intended to be hosted on Vercel. Public review pages may be statically/partially rendered where appropriate, but all writes and privileged operations must pass through authenticated server-side logic and the database authorization model.

PRIVACY
Collect only data required to publish and moderate reviews. Do not expose private payment evidence, sender addresses, transaction hashes, internal moderation notes, or support correspondence merely because a user mentions a transaction in a public review.

RETENTION
Published reviews and comments may be retained while they are useful to the public community. Deleted/removed content may remain in restricted moderation/audit storage for the period required by Averra policy, security investigations, dispute handling, or applicable legal obligations.

ADMINISTRATION
Admin tooling must provide:
- Search/filter reviews.
- Filter verified experiences.
- Review media.
- View reports.
- Apply moderation actions.
- See moderation history.
- Link reviews to relevant internal events without exposing them publicly.
- Review user abuse history as permitted.
- Export required moderation evidence where permitted.

OBSERVABILITY
Track volume of reviews/comments, report rate, moderation queue age, attachment upload failures, publication failures, notification creation failures, and unusual spikes. Analytics do not replace moderation records.

ACCEPTANCE CRITERIA
1. User can publish a 1–5 star review with text.
2. User can optionally attach permitted images.
3. Other users can view published reviews.
4. Other users can reply in a threaded discussion.
5. Replies can optionally contain images.
6. Users can report reviews, comments, and images.
7. Moderators can inspect and act on reports.
8. Public content exposes only intended fields.
9. Verified Experience status is based on a real qualifying internal event.
10. A verified badge does not imply Averra endorsement.
11. Positive reviews are not financially rewarded.
12. Support and financial decisions cannot be made through public review content.
13. No production AI support-reply path exists.
14. Review/media writes are protected by authentication and authorization.
15. Media access policies prevent unauthorized private evidence exposure.
16. Deleted/removed content no longer appears publicly but remains auditable according to retention rules.
17. Refresh/retry cannot create accidental duplicate comments or duplicate media records beyond documented retry semantics.
18. In-app notifications for review replies work without a paid third-party notification API.

RELATED DOCUMENTS
See 10_UI_UX_SPECIFICATION.txt, 43_ADMIN_PLATFORM.txt, 46_ANALYTICS.txt, 48_DATABASE_SCHEMA.txt, 49_API_SPECIFICATION.txt, 50_BACKEND_ARCHITECTURE.txt, 51_FRONTEND_ARCHITECTURE.txt, 53_SECURITY_ARCHITECTURE.txt, 54_PRIVACY_DATA_PROTECTION.txt, 58_CONTENT_MODERATION.txt, 60_INFRASTRUCTURE.txt, 61_DEPLOYMENT.txt, 62_MONITORING_OBSERVABILITY.txt, 65_TESTING_STRATEGY.md, 67_SECURITY_TESTING.md, 69_INTEGRATION_TESTING.md, 70_ACCEPTANCE_CRITERIA.md, 71_ARCHITECTURAL_LAWS.md, 72_SYSTEM_DEPENDENCY_MAP.md, 73_DATA_FLOW_MAP.md, 76_IMPLEMENTATION_PHASES.md, 77_MILESTONES.md, 78_AI_DEVELOPMENT_RULES.md, 79_AGENTS.md, and 82_SOURCE_INDEX.md.


## V7 Admin Integration
Operational administration for this subsystem is defined in `87_ADMIN_PORTAL_EXPANDED.md`.
