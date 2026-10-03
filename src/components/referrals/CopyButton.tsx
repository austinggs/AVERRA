'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';

// Copy-to-clipboard for the invite link.
//
// The clipboard API is unavailable on some browsers and over plain HTTP, so the
// failure path selects the text instead of silently doing nothing. A share button
// that quietly fails is worse than no share button.
export function CopyButton({ value, label = 'Copy link' }: { value: string; label?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  async function copy() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');

      await navigator.clipboard.writeText(value);
      setState('copied');
    } catch {
      // Select the field so the user can copy manually.
      const field = document.getElementById('invite-link');
      if (field instanceof HTMLInputElement) {
        field.select();
      }
      setState('failed');
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="secondary" onClick={() => void copy()}>
        {label}
      </Button>
      <span role="status" className="text-xs text-ink-700">
        {state === 'copied' ? 'Copied.' : state === 'failed' ? 'Copy it from the box above.' : ''}
      </span>
    </div>
  );
}
