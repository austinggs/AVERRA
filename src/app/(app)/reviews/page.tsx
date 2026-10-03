import { PageHeader } from '@/components/ui/PageHeader';
import { ButtonLink } from '@/components/ui/Button';
import { Card, EmptyState, SectionHeading } from '@/components/ui/Card';
import { StarRating } from '@/components/ui/StarRating';
import { ReviewCard } from '@/components/reviews/ReviewCard';
import { getPublicReviews } from '@/lib/reviews/queries';

export const metadata = { title: 'Reviews - Averra' };

// The public reviews surface (doc 86 PUBLIC REVIEW SURFACE).
//
// Read server-side through `public.list_public_reviews` and
// `public.get_review_summary`, never `.from('reviews')`: the `app` schema is not
// exposed through the Data API.
//
// WHAT THIS PAGE DELIBERATELY DOES NOT SAY
//
// It does not call a review "verified". Doc 86 requires total and verified counts
// to be distinguishable and forbids presenting a user opinion as a verified fact,
// so the badge is rendered per-review and described as completed platform
// activity (law 64). And there is no money anywhere on this page, because a review
// has none (law 63).

export default async function ReviewsPage() {
  const page = await getPublicReviews({ limit: 20 });
  const { summary } = page;

  const hasReviews = page.reviews.length > 0;

  return (
    <div>
      <PageHeader
        title="Reviews"
        description="What people have experienced on Averra. Reviews describe someone's own use of the platform. Publishing a review means a human moderator checked it for abuse — it is not an endorsement, and it never affects a balance."
        // Not a bottom-nav tab. The bar already carries eight destinations and a
        // ninth would crowd it on a phone; this page is reached from the dashboard
        // and links back here.
        action={
          <ButtonLink href="/reviews/mine" variant="secondary" size="sm">
            Your reviews
          </ButtonLink>
        }
      />

      {summary.totalReviews > 0 ? (
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <Card>
            <p className="text-xs font-medium text-ink-500">Average rating</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-ink-900">
              {summary.averageRating ?? '—'}
            </p>
            <StarRating
              rating={Math.round(summary.averageRating ?? 0)}
              size="sm"
              className="mt-1"
            />
          </Card>

          <Card>
            <p className="text-xs font-medium text-ink-500">Total reviews</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-ink-900">
              {summary.totalReviews}
            </p>
          </Card>

          {/*
            Reported separately from the total, and never summed with it. A verified
            badge means the author completed a platform activity; it does not make
            the opinion true, so presenting one number for both would overstate what
            we know.
          */}
          <Card>
            <p className="text-xs font-medium text-ink-500">From verified activity</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-ink-900">
              {summary.verifiedReviews}
            </p>
          </Card>
        </div>
      ) : null}

      <section className="mt-8">
        <SectionHeading title="Published reviews" />

        {!hasReviews ? (
          <div className="mt-3">
            <EmptyState
              title="No published reviews yet"
              description="Reviews appear here once a human moderator has checked them. A submitted review is not public the moment it is written."
            />
          </div>
        ) : (
          <ul className="mt-3 space-y-3">
            {page.reviews.map((review) => (
              <li key={review.id}>
                <ReviewCard review={review} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <Card tone="sunken" className="mt-8">
        <p className="text-xs leading-relaxed text-ink-500">
          Reviews are removed when they abuse the platform, not when they are negative. Paying for a
          positive review is not possible: no review can reference a reward or a payment, and the
          Verified Experience badge is granted by the system after it checks your account activity,
          never by you.
        </p>
      </Card>
    </div>
  );
}
