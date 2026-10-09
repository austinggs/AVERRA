/**
 * Same-origin post-authentication redirect.
 *
 * ONE implementation, used by the OAuth callback and anything else that
 * forwards a caller-supplied destination. There were two redirect helpers with
 * two different (and differently incomplete) rules, which is how one of them
 * ends up permitting `/\evil.com` while the other does not.
 *
 * THE RULE IS AN ALLOWLIST, NOT A BLOCKLIST.
 *
 * The previous check in the callback was:
 *
 *     next.startsWith('/') && !next.startsWith('//')
 *
 * which rejects `https://evil.com` and `//evil.com` and looks thorough. It
 * accepts `/\evil.com`. Browsers normalise a backslash to a forward slash in the
 * authority position, so that string is protocol-relative and leaves the origin -
 * a working open redirect that passes a review reading for "does it allow //".
 *
 * Anything that is not a plain absolute path on this origin fails closed.
 */

export const DEFAULT_REDIRECT = '/dashboard';

export function safeNext(raw: string | null | undefined): string {
  if (typeof raw !== 'string') return DEFAULT_REDIRECT;

  // Browsers ignore leading and trailing whitespace before resolving a URL, so
  // " //evil.com" and "/dashboard " must be judged on their trimmed form.
  const value = raw.trim();

  // A plain absolute path, and nothing else. This alone rejects
  // `https://evil.com`, `javascript:alert(1)` and `evil.com`.
  if (!value.startsWith('/')) return DEFAULT_REDIRECT;

  // Protocol-relative: `//evil.com`. Also its backslash spelling `/\evil.com`,
  // which normalises to the same thing.
  if (value.startsWith('//') || value.startsWith('/\\')) return DEFAULT_REDIRECT;

  // Any OTHER backslash is not obviously dangerous but normalises to a slash,
  // and the only reason to have one in a path is to smuggle one past the rules
  // above. `/\/\/evil.com` is the obvious example.
  if (value.includes('\\')) return DEFAULT_REDIRECT;

  // Control characters are stripped by the URL parser, so `/%09//evil.com`
  // resolves as `///evil.com`. Rejected before it can.
  if (/[\u0000-\u001F\u007F]/.test(value)) return DEFAULT_REDIRECT;

  return value;
}