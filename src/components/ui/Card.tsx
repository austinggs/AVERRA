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
 */
export function Card({ children, className, tone = 'surface', as = 'div' }: CardProps) {
  const Tag = as;

  return <Tag className={cx('rounded-card border p-5', TONE[tone], className)}>{children}</Tag>;
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
  tone?: 'neutral' | 'brand' | 'gamify' | 'warning' | 'danger';
  className?: string;
}

const PILL_TONE: Record<NonNullable<PillProps['tone']>, string> = {
  neutral: 'bg-ink-100 text-ink-700',
  brand: 'bg-brand-100 text-brand-800',
  gamify: 'bg-gamify-400/25 text-gamify-600',
  warning: 'bg-gamify-400/30 text-gamify-600',
  danger: 'bg-red-100 text-red-800',
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
