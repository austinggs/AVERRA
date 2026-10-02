import type { ComponentProps, ReactNode } from 'react';
import { cx } from './Card';

export const INPUT_CLASS =
  'mt-1.5 min-h-12 w-full rounded-tile border border-ink-200 bg-surface px-3 text-sm transition-colors placeholder:text-ink-400 focus:border-brand-400';

export const LABEL_CLASS = 'text-xs font-medium text-ink-500';

interface FieldProps {
  id: string;
  label: string;
  /** Guidance shown under the input. Never a substitute for an error. */
  hint?: string;
  error?: string;
  children: ReactNode;
}

export function Field({ id, label, hint, error, children }: FieldProps) {
  return (
    <div>
      <label htmlFor={id} className={LABEL_CLASS}>
        {label}
      </label>
      {children}
      {hint && !error ? (
        <p id={`${id}-hint`} className="mt-1.5 text-xs text-ink-500">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="mt-1.5 text-xs text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}

interface TextInputProps extends Omit<ComponentProps<'input'>, 'id'>, Omit<FieldProps, 'children'> {
  id: string;
}

export function TextInput({ id, label, hint, error, className, ...rest }: TextInputProps) {
  return (
    <Field id={id} label={label} hint={hint} error={error}>
      <input
        id={id}
        // The hint id is referenced so assistive technology reads the guidance
        // with the field rather than leaving it as orphaned text.
        aria-describedby={hint && !error ? `${id}-hint` : undefined}
        aria-invalid={error ? true : undefined}
        className={cx(INPUT_CLASS, error && 'border-red-300', className)}
        {...rest}
      />
    </Field>
  );
}
