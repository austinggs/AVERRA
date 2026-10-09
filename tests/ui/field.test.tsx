import '@testing-library/jest-dom/vitest';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Field, TextInput } from '@/components/ui/Field';

// Field renders its error paragraph with `role="alert"` and an id of
// `${id}-error`, which is the right markup. But TextInput wired
// `aria-describedby` to the HINT only:
//
//     aria-describedby={hint && !error ? `${id}-hint` : undefined}
//
// The condition means that whenever an error is showing, the attribute is
// `undefined`. So the one moment the description matters most is the one moment
// the input stops describing anything: the error is on screen, announced by
// `role="alert"`, and not wired to the field it is about.
//
// This matters more than a normal wiring slip. `role="alert"` fires on
// INSERTION. If the error paragraph is already present when the input receives
// focus - re-render, validation on blur, a password manager redisplaying the
// form - no alert fires and the message is silently stranded. `aria-describedby`
// is what makes the text reachable when the user goes looking with a screen
// reader, and it is the only mechanism that works on a field that is merely
// invalid rather than newly errored.

describe('TextInput describes its hint', () => {
  it('references the hint so assistive technology reads it with the field', () => {
    render(<TextInput id="email" label="Email" hint="We never share it." />);

    const input = screen.getByLabelText('Email');

    expect(input).toHaveAttribute('aria-describedby', 'email-hint');
    expect(screen.getByText('We never share it.')).toHaveAttribute('id', 'email-hint');
  });
});

describe('TextInput describes its error', () => {
  it('references the error, which is currently orphaned', () => {
    // THE regression. This fails against the implementation because the
    // `hint && !error` condition resolves the whole attribute to undefined.
    render(
      <TextInput
        id="password"
        label="Password"
        hint="At least 12 characters."
        error="Too short."
      />,
    );

    const input = screen.getByLabelText('Password');

    expect(input.getAttribute('aria-describedby') ?? '').toContain('password-error');
    expect(screen.getByText('Too short.')).toHaveAttribute('id', 'password-error');
  });

  it('marks the field invalid when there is an error', () => {
    render(<TextInput id="password" label="Password" error="Too short." />);

    expect(screen.getByLabelText('Password')).toHaveAttribute('aria-invalid', 'true');
  });

  it('does not mark the field invalid when there is not', () => {
    render(<TextInput id="password" label="Password" />);

    expect(screen.getByLabelText('Password')).not.toHaveAttribute('aria-invalid');
  });

  it('announces the error with role=alert', () => {
    render(<TextInput id="password" label="Password" error="Too short." />);

    expect(screen.getByRole('alert')).toHaveTextContent('Too short.');
  });

  it('describes nothing when there is neither hint nor error', () => {
    // No dangling reference to an element that does not exist.
    render(<TextInput id="password" label="Password" />);

    expect(screen.getByLabelText('Password')).not.toHaveAttribute('aria-describedby');
  });
});

describe('Field ids are unique per field', () => {
  it('does not collide when two fields share a label', () => {
    // The hint and error ids are derived from the field id, so two fields given
    // the same id would cross-wire their descriptions to each other.
    render(
      <>
        <Field id="a" label="Alpha" hint="Hint A" error="Error A">
          <input id="a" />
        </Field>
        <Field id="b" label="Beta" hint="Hint B" error="Error B">
          <input id="b" />
        </Field>
      </>,
    );

    expect(screen.getByText('Error A')).toHaveAttribute('id', 'a-error');
    expect(screen.getByText('Error B')).toHaveAttribute('id', 'b-error');
  });
});
