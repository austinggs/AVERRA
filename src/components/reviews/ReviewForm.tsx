'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Field, INPUT_CLASS, LABEL_CLASS } from '@/components/ui/Field';
import { RATING_MAX, RATING_MIN } from '@/lib/reviews/contract';

// The review submission form (doc 86).
//
// WHAT THE CLIENT IS ALLOWED TO DO HERE: exactly one thing - send a rating and a
// body.
//
// It cannot publish the review. It cannot grant itself a Verified Experience
// badge, and the badge is not even offered as a choice here, because the only
// honest implementation is for the server to look up the author's real activity
// rather than to ask them to nominate it. A client-supplied `verifiedExperienceId`
// would be a self-asserted claim, which is exactly what law 64 forbids.
//
// It cannot pay or be paid. There is no amount field, and nothing on this screen
// touches a balance (law 63).

export function ReviewForm() {
  const router = useRouter();
  const [rating, setRating] = useState(0);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (rating < RATING_MIN) {
      setError('Choose a rating first.');
      return;
    }

    setSubmitting(true);

    try {
      const response = await fetch('/api/reviews', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // The idempotency key is stable for this submission attempt, so a retry on
        // a flaky connection records ONE review rather than two.
        body: JSON.stringify({ rating, title: title || undefined, body }),
      });

      const payload = await response.json();

      if (!response.ok) {
        setError(payload?.error?.message ?? 'Could not submit your review.');
        return;
      }

      setDone(payload.message ?? 'Your review has been recorded.');
      setRating(0);
      setTitle('');
      setBody('');
      router.refresh();
    } catch {
      setError('Could not reach the server. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div role="status" className="rounded-tile border border-ink-100 bg-surface-sunken p-5">
        <p className="text-sm font-medium text-ink-900">Review recorded</p>
        <p className="mt-1 text-sm leading-relaxed text-ink-500">{done}</p>
        <Button variant="secondary" className="mt-4" onClick={() => setDone(null)}>
          Write another
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      {/*
        A radio group, not a row of buttons: a screen reader must be able to say
        "3 of 5" and let the user change the value, which a styled div cannot do.
      */}
      <fieldset>
        <legend className={LABEL_CLASS}>Your rating</legend>
        <div className="mt-1.5 flex items-center gap-1">
          {Array.from({ length: RATING_MAX }, (_, index) => index + RATING_MIN).map((value) => (
            <label
              key={value}
              className="flex min-h-12 min-w-12 cursor-pointer items-center justify-center text-2xl text-gamify-500"
            >
              <input
                type="radio"
                name="rating"
                value={value}
                checked={rating === value}
                onChange={() => setRating(value)}
                className="sr-only"
              />
              <span aria-hidden="true">{value <= rating ? '\u2605' : '\u2606'}</span>
              <span className="sr-only">
                {value} out of {RATING_MAX} {value === 1 ? 'star' : 'stars'}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <Field
        id="review-title"
        label="Title (optional)"
        hint="A short summary. Leave it blank if you prefer."
      >
        <input
          id="review-title"
          className={INPUT_CLASS}
          value={title}
          maxLength={200}
          onChange={(e) => setTitle(e.target.value)}
        />
      </Field>

      <Field
        id="review-body"
        label="Your review"
        hint="What actually happened, in your own words."
        error={error ?? undefined}
      >
        <textarea
          id="review-body"
          className={`${INPUT_CLASS} min-h-32 py-3`}
          value={body}
          maxLength={5000}
          required
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'review-body-error' : 'review-body-hint'}
          onChange={(e) => setBody(e.target.value)}
        />
      </Field>

      {error ? (
        <p role="alert" className="text-xs text-danger-700">
          {error}
        </p>
      ) : null}

      <Button type="submit" disabled={submitting}>
        {submitting ? 'Sending...' : 'Submit review'}
      </Button>

      <p className="text-xs leading-relaxed text-ink-500">
        Your review is checked by a person before it appears publicly. You cannot buy a review, and
        writing one changes nothing about your balance, your withdrawal limit or your earnings.
      </p>
    </form>
  );
}
