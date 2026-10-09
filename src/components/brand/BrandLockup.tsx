import Link from 'next/link';
import { cx } from '@/components/ui/Card';

/**
 * The Averra mark and wordmark, in one place.
 *
 * WHY THIS IS A COMPONENT AND NOT FOUR COPIES
 *
 * The lockup was duplicated verbatim in the app shell, the sign-in page, the
 * sign-up page and the marketing header. Four copies of a brand mark is four
 * chances to drift, and a brand that is correct in three places and slightly
 * wrong in the fourth is worse than one that is consistently the older version -
 * because the inconsistency reads as intentional.
 *
 * WHY THE MARK IS STILL A LETTER TILE AND NOT THE SUPPLIED LOGO
 *
 * `AVERRA_LOGO.png` cannot be used as-is, for three independent reasons:
 *
 *   1. It is a full LOCKUP on an opaque near-black square, not a square mark.
 *      Placed at 32px in a header, the wordmark becomes an unreadable smear and
 *      the black square becomes a visible dark block on every light surface.
 *   2. Its gradient is BLUE TO PURPLE. Every token in this design system is
 *      green - `--brand-500`, the active pill, the settled-money badge. Shipping
 *      the logo means shipping a second, competing brand identity, which is a
 *      decision for whoever owns the brand, not something to settle by dropping
 *      a PNG into a component.
 *   3. There is no transparent-background export and no vector. Rasterising it to
 *      32px destroys exactly the detail that makes it recognisable.
 *
 * So this ships the token-driven mark the application has always shown, and the
 * real asset lands in one place - here - when a transparent vector arrives.
 * `docs/DISCREPANCIES.md` Q-68 records what the designer needs to supply.
 *
 * This is a Server Component. It is on the critical path of every page, and the
 * only thing it does is render two elements.
 */

export type BrandSize = 'sm' | 'md' | 'lg';

const MARK_SIZE: Record<BrandSize, string> = {
  sm: 'size-7 text-[0.7rem]',
  md: 'size-8 text-sm',
  lg: 'size-11 text-lg',
};

const WORD_SIZE: Record<BrandSize, string> = {
  sm: 'text-sm',
  md: 'text-base',
  lg: 'text-xl',
};

export interface BrandLockupProps {
  /** When present the whole lockup becomes a link to this destination. */
  href?: string;
  size?: BrandSize;
  /** Hide the wordmark. Only for a viewport too narrow to carry it. */
  markOnly?: boolean;
  className?: string;
}

/**
 * The square mark on its own.
 *
 * `aria-hidden` because the wordmark beside it is the accessible name. Two
 * elements both saying "Averra" makes a screen reader read it twice on every
 * page, which trains users to skip the header entirely.
 */
export function BrandMark({ size = 'md', className }: { size?: BrandSize; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        'grid shrink-0 place-items-center rounded-tile bg-brand-500 font-black text-white',
        MARK_SIZE[size],
        className,
      )}
    >
      A
    </span>
  );
}

export function BrandLockup({ href, size = 'md', markOnly = false, className }: BrandLockupProps) {
  const content = (
    <>
      <BrandMark size={size} />
      {/*
        `markOnly` hides the wordmark VISUALLY, so the link still needs a name.
        Rather than adding an aria-label that duplicates the visible text in the
        normal case, the wordmark is simply always rendered and collapsed with a
        screen-reader-only span when the mark is alone.
      */}
      {markOnly ? (
        <span className="sr-only">Averra</span>
      ) : (
        <span className={cx('font-bold tracking-tight text-ink-900', WORD_SIZE[size], className)}>
          Averra
        </span>
      )}
    </>
  );

  if (!href) {
    return <span className="flex items-center gap-2">{content}</span>;
  }

  return (
    <Link href={href} className="flex items-center gap-2">
      {content}
    </Link>
  );
}
