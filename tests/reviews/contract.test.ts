import { describe, expect, it } from 'vitest';
import {
  COMMENT_BODY_MAX,
  REPORT_REASON_SUGGESTIONS,
  REVIEW_BODY_MAX,
  REVIEW_CONTENT_TARGETS,
  REVIEW_EXPERIENCE_TYPES,
  REVIEW_MEDIA_STATUSES,
  REVIEW_MODERATION_ACTIONS,
  REVIEW_REPORT_STATUSES,
  REVIEW_STATES,
  REVIEW_TITLE_MAX,
  REVIEW_VERIFICATION_TYPES,
  RATING_MAX,
  RATING_MIN,
  describeExperienceType,
  describeReviewState,
  isPubliclyVisibleMedia,
  isValidRating,
  isVerifiedExperience,
} from '@/lib/reviews/contract';

// The contract mirrors migration 038. These tests exist so that if someone edits
// an enum here, the mismatch is caught in CI rather than surfacing as an opaque
// PostgREST error at runtime.

describe('review enum mirrors', () => {
  it('mirrors app.review_status exactly', () => {
    expect([...REVIEW_STATES]).toEqual(['PENDING', 'PUBLISHED', 'HIDDEN', 'REMOVED']);
  });

  it('mirrors app.review_media_status exactly', () => {
    expect([...REVIEW_MEDIA_STATUSES]).toEqual(['PENDING', 'APPROVED', 'REJECTED', 'REMOVED']);
  });

  it('mirrors app.review_verification_type exactly', () => {
    expect([...REVIEW_VERIFICATION_TYPES]).toEqual(['UNVERIFIED', 'VERIFIED_EXPERIENCE']);
  });

  it('mirrors app.review_experience_type and omits GAME_PURCHASE', () => {
    // GAME_PURCHASE is the deliberate absence recorded in migration 038: no
    // game-purchase table exists, so the database cannot verify one. If it is ever
    // added here, this test is where the owner should be asked to confirm the
    // underlying table landed first.
    expect([...REVIEW_EXPERIENCE_TYPES]).toEqual([
      'TASK_COMPLETION',
      'WITHDRAWAL_COMPLETION',
      'DEPOSIT_CONFIRMATION',
      'SUPPORT_INTERACTION',
    ]);
    expect(REVIEW_EXPERIENCE_TYPES).not.toContain('GAME_PURCHASE' as never);
  });

  it('mirrors app.review_content_target exactly', () => {
    expect([...REVIEW_CONTENT_TARGETS]).toEqual([
      'REVIEW',
      'REVIEW_COMMENT',
      'REVIEW_MEDIA',
      'REVIEW_COMMENT_MEDIA',
    ]);
  });

  it('mirrors app.review_report_status exactly', () => {
    expect([...REVIEW_REPORT_STATUSES]).toEqual(['OPEN', 'IN_REVIEW', 'RESOLVED', 'DISMISSED']);
  });

  it('mirrors app.review_moderation_action exactly', () => {
    expect([...REVIEW_MODERATION_ACTIONS]).toEqual([
      'APPROVE',
      'HIDE',
      'RESTORE',
      'REMOVE',
      'REJECT',
      'DISMISS',
    ]);
  });
});

describe('isValidRating', () => {
  it('accepts the closed 1-5 range the database enforces', () => {
    for (let r = RATING_MIN; r <= RATING_MAX; r += 1) {
      expect(isValidRating(r)).toBe(true);
    }
  });

  it('rejects values outside the range', () => {
    expect(isValidRating(0)).toBe(false);
    expect(isValidRating(6)).toBe(false);
    expect(isValidRating(-1)).toBe(false);
  });

  it('rejects non-integers and non-numbers', () => {
    // The database column is smallint, so 4.5 would round on some paths and fail
    // on others. Refusing it here keeps the two behaviours from diverging.
    expect(isValidRating(4.5)).toBe(false);
    expect(isValidRating(Number.NaN)).toBe(false);
    expect(isValidRating(Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe('isPubliclyVisibleMedia', () => {
  it('only APPROVED media is public', () => {
    expect(isPubliclyVisibleMedia('APPROVED')).toBe(true);
  });

  it('withholds PENDING, REJECTED and REMOVED media', () => {
    // Doc 86: an image can be rejected while its parent review stays published,
    // so this is a per-media decision and cannot be inferred from the review.
    expect(isPubliclyVisibleMedia('PENDING')).toBe(false);
    expect(isPubliclyVisibleMedia('REJECTED')).toBe(false);
    expect(isPubliclyVisibleMedia('REMOVED')).toBe(false);
  });
});

describe('isVerifiedExperience', () => {
  it('requires both the badge and a named activity', () => {
    expect(isVerifiedExperience('VERIFIED_EXPERIENCE', 'TASK_COMPLETION')).toBe(true);
  });

  it('is false when the badge is absent', () => {
    expect(isVerifiedExperience('UNVERIFIED', null)).toBe(false);
  });

  it('is false for a badge with no named activity', () => {
    // `reviews_verification_evidence_consistent` forbids this combination in the
    // database; the helper refuses to render it if it ever appears.
    expect(isVerifiedExperience('VERIFIED_EXPERIENCE', null)).toBe(false);
  });
});

describe('describeReviewState', () => {
  it('covers every state, so an added enum cannot fall through silently', () => {
    for (const state of REVIEW_STATES) {
      expect(describeReviewState(state)).toBeTruthy();
    }
  });

  it('tells the author a hidden review still exists', () => {
    // Doc 09 TRANSPARENCY: silently vanishing would be worse than an honest label.
    expect(describeReviewState('HIDDEN')).toMatch(/hidden/i);
    expect(describeReviewState('REMOVED')).toMatch(/removed/i);
  });

  it('never claims publication means the opinion is true', () => {
    // Law 64: publication is a moderation decision, not an endorsement.
    expect(describeReviewState('PUBLISHED')).toBe('Published.');
  });
});

describe('describeExperienceType', () => {
  it('covers every experience type', () => {
    for (const type of REVIEW_EXPERIENCE_TYPES) {
      expect(describeExperienceType(type)).toBeTruthy();
    }
  });

  it('describes an activity, never a "verified review"', () => {
    // Law 64 wording rule: the badge attests completed activity.
    expect(describeExperienceType('TASK_COMPLETION')).toBe('Completed task');
    expect(describeExperienceType('TASK_COMPLETION')).not.toMatch(/verified review/i);
  });
});

describe('bounds mirror the database constraints', () => {
  it('matches reviews_rating_range', () => {
    expect(RATING_MIN).toBe(1);
    expect(RATING_MAX).toBe(5);
  });

  it('matches reviews_body_max_length and review_comments_body_max_length', () => {
    expect(REVIEW_BODY_MAX).toBe(5000);
    expect(COMMENT_BODY_MAX).toBe(5000);
  });

  it('keeps the route-only title bound distinct from the mirrored ones', () => {
    // Migration 038 sets no title length limit, so this must not be confused with
    // a database constraint.
    expect(REVIEW_TITLE_MAX).toBe(200);
  });
});

describe('REPORT_REASON_SUGGESTIONS', () => {
  it('is a suggestion list, not a whitelist', () => {
    // The database stores reason_code verbatim, so the API must not reject an
    // unlisted reason. This test exists to stop someone converting it into an
    // enum and breaking reports the UI did not anticipate.
    expect(REPORT_REASON_SUGGESTIONS.length).toBeGreaterThan(0);
    expect(REPORT_REASON_SUGGESTIONS).toContain('Other');
  });
});
