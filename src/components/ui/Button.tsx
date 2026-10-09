import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';
import { cx } from './Card';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

const VARIANT: Record<Variant, string> = {
  primary: 'bg-brand-500 text-white hover:bg-brand-600 active:bg-brand-700 shadow-tile',
  secondary: 'bg-surface text-ink-700 border border-ink-200 hover:bg-surface-sunken',
  ghost: 'text-ink-700 hover:bg-ink-100',
  danger: 'bg-danger-600 text-white hover:bg-danger-700',
};

const SIZE: Record<Size, string> = {
  // Generous tap targets. Anything interactive is at least 44px tall.
  sm: 'min-h-11 px-4 text-sm',
  md: 'min-h-12 px-5 text-sm',
};

const BASE =
  // `active:scale-[0.98]` is the whole "it felt real" trick. A button that does
  // not visibly depress under a finger reads as a picture of a button,
  // especially at arm's length on a phone. The scale is small enough that it
  // never causes a reflow, and it is disabled under reduced motion by the
  // global transition rule in globals.css.
  //
  // `select-none` stops a fast double-tap selecting the label as text, which on
  // mobile looks like a bug and interrupts a second tap.
  'inline-flex items-center justify-center gap-2 rounded-pill font-semibold select-none ' +
  'transition-[transform,background-color,border-color,color,box-shadow,opacity] duration-200 ' +
  'ease-[var(--ease-out-expo)] active:scale-[0.98] ' +
  'disabled:opacity-50 disabled:pointer-events-none disabled:active:scale-100';

interface ButtonProps extends ComponentProps<'button'> {
  variant?: Variant;
  size?: Size;
  children: ReactNode;
}

/**
 * PENDING AFFORDANCES ARE TEXT SWAPS, NOT SPINNERS
 *
 * Every caller already passes its own busy label ("Recording…", "Starting…",
 * "Signing in…"), so a spinner would duplicate a state the user is already
 * reading, and inserting one into a pill button shifts the label sideways as it
 * appears. The `disabled:opacity-50` above plus the label change is enough to
 * make a button obviously not-yet-clickable.
 *
 * There is deliberately no `Spinner` export here. If one is ever added it will
 * need a width reservation, or the button will resize mid-request and the user
 * will see the layout jump at the exact moment they are told to wait.
 */
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
