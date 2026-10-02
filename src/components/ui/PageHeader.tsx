import type { ReactNode } from 'react';
import { cx } from './Card';

interface PageHeaderProps {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

/**
 * The title block for a page.
 *
 * `description` is where a page states its own transparency rule, so the copy
 * sits directly under the heading where a user reads it before acting.
 */
export function PageHeader({ title, description, action, className }: PageHeaderProps) {
  return (
    <header className={cx('flex items-start justify-between gap-4 pt-6 pb-2', className)}>
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight text-ink-900">{title}</h1>
        {description ? (
          <p className="mt-1.5 max-w-prose text-sm leading-relaxed text-ink-500">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}
