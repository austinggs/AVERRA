'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Field, INPUT_CLASS, LABEL_CLASS } from '@/components/ui/Field';

// Display name editor.
//
// The only thing on the Settings page a user may change about themselves.
//
// It calls `update_my_display_name`, which scopes its lookup by BOTH the session user
// id and the record id. The id never comes from the request body, so this form cannot
// be pointed at somebody else's profile even if the endpoint were reachable another
// way.

interface DisplayNameFormProps {
  initialName: string;
  email: string | null;
  accountStatus: string;
}

export function DisplayNameForm({ initialName, email, accountStatus }: DisplayNameFormProps) {
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const dirty = name.trim() !== initialName;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSaved(false);

    if (name.trim().length === 0) {
      setError('A display name is required.');
      return;
    }

    setSubmitting(true);

    try {
      const response = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ displayName: name.trim() }),
      });

      const payload = await response.json();

      if (!response.ok) {
        setError(payload?.error?.message ?? 'Could not save your display name.');
        return;
      }

      setSaved(true);
    } catch {
      setError('Could not reach the server. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <Field
        id="display-name"
        label="Display name"
        hint="This is the name other people see on your reviews and replies."
        error={error ?? undefined}
      >
        <input
          id="display-name"
          className={INPUT_CLASS}
          value={name}
          maxLength={60}
          required
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'display-name-error' : 'display-name-hint'}
          onChange={(e) => {
            setName(e.target.value);
            setSaved(false);
          }}
        />
      </Field>

      <div>
        <p className={LABEL_CLASS}>Email address</p>
        <p className="mt-1.5 text-sm text-ink-700">{email ?? 'Not available'}</p>
        <p className="mt-1 text-xs text-ink-500">
          Your sign-in address. Changing it needs a verified new address, which is not available
          yet.
        </p>
      </div>

      <div>
        <p className={LABEL_CLASS}>Account status</p>
        <p className="mt-1.5 text-sm text-ink-700">{accountStatus.toLowerCase()}</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" disabled={!dirty || submitting}>
          {submitting ? 'Saving...' : 'Save changes'}
        </Button>

        {saved ? (
          <p role="status" className="text-xs text-ink-500">
            Saved.
          </p>
        ) : null}
      </div>
    </form>
  );
}
