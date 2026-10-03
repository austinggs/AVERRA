import { cx } from '@/components/ui/Card';
import { RATING_MAX, RATING_MIN } from '@/lib/reviews/contract';

// A read-only 1-5 star display (doc 86 RATINGS).
//
// Presentation only: this never submits a rating and never mutates state. The
// interactive control lives in ReviewForm and posts through the API.
//
// `--color-gamify-*` is the right token here and is safe to use: that palette is
// reserved for XP, levels, streaks and badges and must never represent MONEY, so a
// virtual reward cannot be mistaken for cash. A star rating is neither money nor a
// reward - it is an opinion - so using it here breaks no rule. A financial amount
// must still go through MoneyState.
//
// The stars are decorative and the accessible name is on the wrapper, because five
// individual glyphs announced one at a time is unusable.

interface StarRatingProps {
  rating: number;
  /** Rendered inside the accessible name, e.g. "Your rating". */
  label?: string;
  size?: 'sm' | 'md';
  className?: string;
}

const SIZE_CLASS: Record<'sm' | 'md', string> = {
  sm: 'text-sm',
  md: 'text-base',
};

export function StarRating({ rating, label = 'Rating', size = 'md', className }: StarRatingProps) {
  // Clamped rather than trusted: the database constrains this to 1-5, but a
  // corrupted row must not render six stars or crash the page.
  const clamped = Math.min(Math.max(Math.round(rating), RATING_MIN), RATING_MAX);

  return (
    <span
      className={cx('inline-flex items-center gap-0.5', SIZE_CLASS[size], className)}
      role="img"
      aria-label={`${label}: ${clamped} out of ${RATING_MAX}`}
    >
      {Array.from({ length: RATING_MAX }, (_, index) => (
        <span
          key={index}
          aria-hidden="true"
          className={index < clamped ? 'text-gamify-500' : 'text-ink-200'}
        >
          {index < clamped ? '\u2605' : '\u2606'}
        </span>
      ))}
    </span>
  );
}
