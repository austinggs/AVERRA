// Reviews & Community domain contract (doc 86).
//
// PURE MODULE. It imports nothing from the server, so both the route handlers and
// the client components can use it, and it is unit tested. Like
// `src/lib/contracts/states.ts`, it MIRRORS the database and decides nothing: if
// this file and migration 038 ever disagree, the database wins and this is the
// bug.
//
// Source of truth:
//   supabase/migrations/20260930000038_reviews_foundation.sql   tables + enums
//   86_REVIEWS_COMMUNITY_SYSTEM.md                              behaviour
//
// The two invariants worth stating out loud, because the rest of this module
// exists to serve them:
//
//   Law 63 - a review is never a financial record. Nothing here can move money,
//             and nothing in this file represents an amount.
//   Law 64 - Verified Experience is a verified ACTIVITY, not an endorsement. A
//             review does not earn a badge because its author claims one.

export const REVIEW_STATES = ['PENDING', 'PUBLISHED', 'HIDDEN', 'REMOVED'] as const;
export type ReviewState = (typeof REVIEW_STATES)[number];

export const REVIEW_MEDIA_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'REMOVED'] as const;
export type ReviewMediaStatus = (typeof REVIEW_MEDIA_STATUSES)[number];

export const REVIEW_VERIFICATION_TYPES = ['UNVERIFIED', 'VERIFIED_EXPERIENCE'] as const;
export type ReviewVerificationType = (typeof REVIEW_VERIFICATION_TYPES)[number];

/**
 * Mirrors `app.review_experience_type`.
 *
 * `GAME_PURCHASE` is deliberately absent. Migration 038 omits it because no
 * game-purchase table exists, and adding it would claim a verification the
 * database cannot perform. It joins this list when the game economy lands
 * (docs 17, 75).
 */
export const REVIEW_EXPERIENCE_TYPES = [
  'TASK_COMPLETION',
  'WITHDRAWAL_COMPLETION',
  'DEPOSIT_CONFIRMATION',
  'SUPPORT_INTERACTION',
] as const;
export type ReviewExperienceType = (typeof REVIEW_EXPERIENCE_TYPES)[number];

export const REVIEW_CONTENT_TARGETS = [
  'REVIEW',
  'REVIEW_COMMENT',
  'REVIEW_MEDIA',
  'REVIEW_COMMENT_MEDIA',
] as const;
export type ReviewContentTarget = (typeof REVIEW_CONTENT_TARGETS)[number];

export const REVIEW_REPORT_STATUSES = ['OPEN', 'IN_REVIEW', 'RESOLVED', 'DISMISSED'] as const;
export type ReviewReportStatus = (typeof REVIEW_REPORT_STATUSES)[number];

export const REVIEW_MODERATION_ACTIONS = [
  'APPROVE',
  'HIDE',
  'RESTORE',
  'REMOVE',
  'REJECT',
  'DISMISS',
] as const;
export type ReviewModerationAction = (typeof REVIEW_MODERATION_ACTIONS)[number];

// --- Bounds -------------------------------------------------------------------
// These mirror `constraint reviews_*` in migration 038. Where a value here has no
// database counterpart it says so, because inventing a database rule and then
// "mirroring" it is how the two drift apart.

/** `constraint reviews_rating_range check (rating between 1 and 5)`. */
export const RATING_MIN = 1;
export const RATING_MAX = 5;

/** `constraint reviews_body_max_length check (length(body) <= 5000)`. */
export const REVIEW_BODY_MAX = 5000;

/** `constraint review_comments_body_max_length check (length(body) <= 5000)`. */
export const COMMENT_BODY_MAX = 5000;

/**
 * Route-level bound only. Migration 038 constrains `title` to "not blank" but sets
 * no length limit, so this is an API surface decision, not a mirrored rule.
 */
export const REVIEW_TITLE_MAX = 200;

/**
 * Route-level bound only. There is no `review_reports.details` length constraint
 * in migration 038.
 */
export const REPORT_DETAILS_MAX = 2000;

/** `constraint review_reports_reason_not_blank check (length(btrim(reason_code)) > 0)`. */
export const REPORT_REASON_MAX = 80;

/**
 * Suggested report reasons for the UI picker.
 *
 * NOT a validation list. `reason_code` is free text in the database and is stored
 * verbatim for moderators, so rejecting an unlisted reason here would refuse a
 * legitimate report. This exists so the client offers consistent options.
 */
export const REPORT_REASON_SUGGESTIONS = [
  'Spam or advertising',
  'Harassment or abuse',
  'False or misleading claim',
  'Personal information',
  'Off-topic',
  'Other',
] as const;

/**
 * Only APPROVED media is publicly readable, and a media row can be rejected
 * while its parent review stays published (doc 86 MODERATION). Both SQL wrappers
 * already filter on this; the UI repeats it so a hand-built payload cannot render
 * an image that the database would withhold.
 */
export function isPubliclyVisibleMedia(status: ReviewMediaStatus): boolean {
  return status === 'APPROVED';
}

export function isValidRating(rating: number): boolean {
  return Number.isInteger(rating) && rating >= RATING_MIN && rating <= RATING_MAX;
}

/** True when the badge names real verified activity. */
export function isVerifiedExperience(
  verificationType: ReviewVerificationType,
  experienceType: ReviewExperienceType | null,
): boolean {
  return verificationType === 'VERIFIED_EXPERIENCE' && experienceType !== null;
}

/**
 * Author-facing label for a review's state.
 *
 * Doc 09 TRANSPARENCY applied to content: a hidden or removed review is still the
 * author's, and silently vanishing is worse than an honest label. Note what this
 * does NOT do - it never says a review was approved as true, because publication
 * is a moderation decision, not an endorsement (law 64).
 */
export function describeReviewState(state: ReviewState): string {
  switch (state) {
    case 'PENDING':
      return 'Waiting for a moderator to review this. Only you can see it.';
    case 'PUBLISHED':
      return 'Published.';
    case 'HIDDEN':
      return 'Hidden by a moderator. It is not visible to anyone but you.';
    case 'REMOVED':
      return 'Removed by a moderator. It stays on your record for transparency.';
  }
}

/**
 * Public-facing label for the Verified Experience badge.
 *
 * "Verified activity", never "verified review". The badge attests that the author
 * completed a platform activity; it says nothing about whether the opinion is
 * correct (law 64).
 */
export function describeExperienceType(type: ReviewExperienceType): string {
  switch (type) {
    case 'TASK_COMPLETION':
      return 'Completed task';
    case 'WITHDRAWAL_COMPLETION':
      return 'Completed withdrawal';
    case 'DEPOSIT_CONFIRMATION':
      return 'Confirmed deposit';
    case 'SUPPORT_INTERACTION':
      return 'Support interaction';
  }
}
