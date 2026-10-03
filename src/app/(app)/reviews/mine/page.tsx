import { requireUser } from '@/lib/auth/session';
import { getMyReviews, getReviewComments } from '@/lib/reviews/queries';
import { ReviewForm } from '@/components/reviews/ReviewForm';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, EmptyState, Pill, SectionHeading } from '@/components/ui/Card';
import { StarRating } from '@/components/ui/StarRating';
import {
  describeExperienceType,
  describeReviewState,
  type ReviewExperienceType,
} from '@/lib/reviews/contract';

export const metadata = { title: 'My reviews - Averra' };

// The author's own reviews (doc 09 TRANSPARENCY applied to content).
//
// The point of this page is the HONEST STATE. A review that a moderator hid or
// removed is still the author's, so it is listed with what actually happened to it
// rather than silently disappearing - which is the failure this page exists to
// avoid.

const STATE_TONE: Record<string, 'neutral' | 'brand' | 'warning' | 'danger'> = {
  PENDING: 'warning',
  PUBLISHED: 'brand',
  HIDDEN: 'warning',
  REMOVED: 'danger',
};

export default async function MyReviewsPage() {
  const user = await requireUser();
  const mine = await getMyReviews(user.id);

  // Comments for the author's published reviews, so a reply is visible in context.
  const published = mine.filter((review) => review.status === 'PUBLISHED');

  const conversations = await Promise.all(
    published.map(async (review) => ({
      review,
      comments: await getReviewComments(review.id),
    })),
  );

  return (
    <div>
      <PageHeader
        title="Your reviews"
        description="Everything you have written, and exactly what is happening with it. A review is checked by a person before it is public."
      />

      <Card className="mt-6">
        <SectionHeading title="Write a review" />
        <div className="mt-4">
          <ReviewForm />
        </div>
      </Card>

      <section className="mt-8">
        <SectionHeading title="Your review history" />

        {mine.length === 0 ? (
          <div className="mt-3">
            <EmptyState
              title="No reviews yet"
              description="When you write one it appears here with its current status, whether or not it is public."
            />
          </div>
        ) : (
          <ul className="mt-3 space-y-3">
            {mine.map((review) => (
              <li key={review.id}>
                <Card>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      {review.title ? (
                        <p className="text-sm font-semibold text-ink-900">{review.title}</p>
                      ) : null}
                      <StarRating rating={review.rating} size="sm" className="mt-1" />
                      <p className="mt-1 text-xs text-ink-500">
                        Written {new Date(review.createdAt).toLocaleDateString()}
                      </p>
                    </div>

                    <Pill tone={STATE_TONE[review.status] ?? 'neutral'}>
                      {review.status.toLowerCase()}
                    </Pill>
                  </div>

                  <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-ink-700">
                    {review.body}
                  </p>

                  {/*
                    The state is stated in words as well as in a pill. A pill says
                    "hidden"; this says who did it and what it means, which is what
                    doc 09 asks for.
                  */}
                  <p className="mt-3 text-xs leading-relaxed text-ink-500">
                    {describeReviewState(review.status as never)}
                  </p>

                  {review.verifiedExperienceType ? (
                    <p className="mt-2 text-xs text-ink-500">
                      Badge:{' '}
                      {describeExperienceType(
                        review.verifiedExperienceType as ReviewExperienceType,
                      )}{' '}
                      activity. The badge confirms that activity, not that your opinion is correct.
                    </p>
                  ) : null}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      {conversations.length > 0 ? (
        <section className="mt-8">
          <SectionHeading
            title="Replies to your reviews"
            description="The thread is public, so replies are shown as they will appear to others."
          />

          <ul className="mt-3 space-y-3">
            {conversations.map(({ review, comments }) => (
              <li key={review.id}>
                <Card>
                  <p className="text-sm font-semibold text-ink-900">
                    {review.title ?? 'Your review'}
                  </p>

                  {comments.length === 0 ? (
                    <p className="mt-2 text-xs text-ink-500">No replies yet.</p>
                  ) : (
                    <ul className="mt-3 space-y-3">
                      {comments.map((comment) => (
                        <li key={comment.id} className="border-l-2 border-ink-100 pl-3">
                          <p className="text-xs text-ink-500">
                            {comment.authorDisplayName ?? 'Averra member'} ·{' '}
                            {new Date(comment.createdAt).toLocaleDateString()}
                          </p>
                          <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-ink-700">
                            {comment.body}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
