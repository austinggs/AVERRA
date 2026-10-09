import type { ReactNode } from 'react';

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export type CardTone = 'surface' | 'sunken' | 'brand';

interface CardProps {
  children: ReactNode;
  className?: string;
  tone?: CardTone;
  as?: 'div' | 'section' | 'article' | 'li';
  /**
   * Adds a hover lift for cards that WRAP something interactive.
   *
   * Opt-in, and not the default, because a lift is a promise: it says "this
   * responds". Applying it to every card made a page of static information
   * look clickable, which is the affordance lie in its own right - and a worse
   * one than a missing hover state, because a user taps an apparently-active
   * card and nothing happens.
   *
   * A card containing a link or button SHOULD take it. A card that is purely
   * information should not.
   */
  interactive?: boolean;
}

const TONE: Record<CardTone, string> = {
  surface: 'bg-surface border-ink-100 shadow-card',
  sunken: 'bg-surface-sunken border-ink-100',
  brand: 'bg-brand-500 border-brand-500 text-white shadow-card',
};

/**
 * The base surface. One card, one radius, one shadow.
 *
 * `as` lets a list render `<li>` while reusing the same styling, so a card in a
 * list keeps the visual language without nesting a div inside a li.
 *
 * TRANSITION SCOPED TO THE TWO PROPERTIES THAT CHANGE.
 *
 * `transition-shadow` alone, deliberately. A blanket `transition-all` on a card
 * animates layout-adjacent properties too, so a card whose contents change
 * width will animate that width and produce a visible smear. Shadow is the only
 * thing `interactive` changes.
 */
export function Card({ children, className, tone = 'surface', as = 'div', interactive = false }: CardProps) {
  const Tag = as;

  return (
    <Tag
      className={cx(
        'rounded-card border p-5',
        TONE[tone],
        interactive &&
          'transition-shadow duration-200 ease-[var(--ease-out-expo)] hover:-translate-y-0.5 hover:shadow-lift motion-reduce:hover:translate-y-0',
        className,
      )}
    >
      {children}
    </Tag>
  );
}

interface SectionHeadingProps {
  title: string;
  /** One short line. Kept in the component so spacing stays consistent. */
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function SectionHeading({ title, description, action, className }: SectionHeadingProps) {
  return (
    <div className={cx('flex items-end justify-between gap-4', className)}>
      <div>
        <h2 className="text-base font-semibold tracking-tight text-ink-900">{title}</h2>
        {description ? (
          <p className="mt-1 max-w-prose text-sm leading-relaxed text-ink-500">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

interface PillProps {
  children: ReactNode;
  tone?: 'neutral' | 'brand' | 'gamify' | 'warning' | 'danger' | 'locked';
  className?: string;
}

// `warning` and `gamify` used to be the SAME colour - `bg-gamify-400` at /30 and
// /25 respectively, identical text colour. A five-point alpha difference is not a
// distinction, and it put a financial state and a virtual one in the same family,
// which doc 47 forbids in the other direction.
//
// They are now separated by hue (orange against gold) AND by treatment: `warning`
// carries a ring, `gamify` is a flat tint. `locked` exists because MoneyState
// mapped both `eligible` and `reserved` to `warning` - "verified and owed to you"
// and "already claimed by a withdrawal you started" rendered identically, and that
// is precisely the transparency doc 09 requires to preserve.
const PILL_TONE: Record<NonNullable<PillProps['tone']>, string> = {
  neutral: 'bg-ink-100 text-ink-700',
  brand: 'bg-brand-100 text-brand-800',
  gamify: 'bg-gamify-400/25 text-gamify-600',
  warning: 'bg-warning-100 text-warning-700 ring-1 ring-warning-300',
  locked: 'bg-locked-100 text-locked-700 ring-1 ring-locked-300',
  danger: 'bg-danger-100 text-danger-800',
};

export function Pill({ children, tone = 'neutral', className }: PillProps) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-xs font-medium',
        PILL_TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <Card tone="sunken" className="text-center">
      <p className="text-sm font-medium text-ink-700">{title}</p>
      {description ? (
        <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-ink-500">{description}</p>
      ) : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </Card>
  );
}
