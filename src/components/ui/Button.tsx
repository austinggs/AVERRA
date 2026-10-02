import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';
import { cx } from './Card';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

const VARIANT: Record<Variant, string> = {
  primary: 'bg-brand-500 text-white hover:bg-brand-600 active:bg-brand-700 shadow-tile',
  secondary: 'bg-surface text-ink-700 border border-ink-200 hover:bg-surface-sunken',
  ghost: 'text-ink-700 hover:bg-ink-100',
  danger: 'bg-red-600 text-white hover:bg-red-700',
};

const SIZE: Record<Size, string> = {
  // Generous tap targets. Anything interactive is at least 44px tall.
  sm: 'min-h-11 px-4 text-sm',
  md: 'min-h-12 px-5 text-sm',
};

const BASE =
  'inline-flex items-center justify-center gap-2 rounded-pill font-semibold transition-colors disabled:opacity-50 disabled:pointer-events-none';

interface ButtonProps extends ComponentProps<'button'> {
  variant?: Variant;
  size?: Size;
  children: ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button className={cx(BASE, VARIANT[variant], SIZE[size], className)} {...rest}>
      {children}
    </button>
  );
}

interface ButtonLinkProps extends ComponentProps<typeof Link> {
  variant?: Variant;
  size?: Size;
  children: ReactNode;
}

/** A link styled as a button, so navigation never pretends to be a submission. */
export function ButtonLink({
  variant = 'primary',
  size = 'md',
  className,
  children,
  ...rest
}: ButtonLinkProps) {
  return (
    <Link className={cx(BASE, VARIANT[variant], SIZE[size], className)} {...rest}>
      {children}
    </Link>
  );
}

interface PillTabsProps {
  items: ReadonlyArray<{ key: string; label: string; count?: number }>;
  activeKey: string;
  ariaLabel: string;
}

/**
 * Segmented pill control, the filter language used across the references.
 *
 * Rendered as a real `tablist` so it is announced correctly. `ariaLabel` is
 * required because an unlabelled tab group is unusable with a screen reader.
 */
export function PillTabs({ items, activeKey, ariaLabel }: PillTabsProps) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {items.map((item) => {
        const active = item.key === activeKey;

        return (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={active}
            className={cx(
              'inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-pill px-4 text-sm font-semibold transition-colors',
              active
                ? 'bg-brand-500 text-white shadow-tile'
                : 'bg-surface text-ink-500 border border-ink-200 hover:bg-surface-sunken',
            )}
          >
            {item.label}
            {item.count !== undefined ? (
              <span className={cx('text-xs', active ? 'text-white/80' : 'text-ink-400')}>
                {item.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
