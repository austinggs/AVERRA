import { Card, Pill } from '@/components/ui/Card';
import { StarRating } from '@/components/ui/StarRating';
import {
  describeExperienceType,
  isVerifiedExperience,
  type ReviewExperienceType,
} from '@/lib/reviews/contract';
import type { PublicReview } from '@/lib/reviews/queries';

// One published review (doc 86 PUBLIC REVIEW SURFACE).
//
// WHAT THIS COMPONENT REFUSES TO DO
//
// It never renders an amount, because a review carries none (law 63). It never
// renders the author's user id or the id of the activity behind a badge, because
// the public projection withholds both (law 69). And it never describes a review as
// "verified" in the sense of trustworthy - the badge means completed platform
// activity, which is a different and much weaker claim (law 64).

interface ReviewCardProps {
  review: PublicReview;
}

export function ReviewCard({ review }: ReviewCardProps) {
  const verified = isVerifiedExperience(
    review.verificationType as 'UNVERIFIED' | 'VERIFIED_EXPERIENCE',
    review.verifiedExperienceType as ReviewExperienceType | null,
  );

  return (
    <Card as="article">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {review.title ? (
            <h3 className="text-sm font-semibold tracking-tight text-ink-900">{review.title}</h3>
          ) : null}

          <StarRating rating={review.rating} className="mt-1" />

          <p className="mt-1 text-xs text-ink-500">
            {review.authorDisplayName ?? 'Averra member'}
            {review.publishedAt ? ` · ${new Date(review.publishedAt).toLocaleDateString()}` : null}
          </p>
        </div>

        {verified ? (
          // Law 64: the badge attests a completed ACTIVITY, not the correctness of
          // the opinion. The wording says so in full, because "Verified" alone
          // reads as an endorsement.
          <Pill tone="brand">
            {describeExperienceType(review.verifiedExperienceType as ReviewExperienceType)}
          </Pill>
        ) : null}
      </div>

      <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-ink-700">{review.body}</p>

      {/*
        Media renders as a placeholder, not an <img>. The Storage bucket that would
        resolve a `storagePath` into a public URL does not exist yet, and
        doc 86 requires media access to go through a deliberate policy rather than
        a predictable URL. Rendering a guessed URL would leak that intent.
      */}
      {review.media.length > 0 ? (
        <p className="mt-3 text-xs text-ink-500">
          {review.media.length} image{review.media.length === 1 ? '' : 's'} attached.
        </p>
      ) : null}

      {review.category ? (
        <p className="mt-3 text-xs text-ink-500">Category: {review.category}</p>
      ) : null}
    </Card>
  );
}
