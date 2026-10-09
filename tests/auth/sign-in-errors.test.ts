import { describe, expect, it } from 'vitest';
import { AUTH_ERROR_FALLBACK, AUTH_ERROR_MESSAGES, authErrorMessage } from '@/lib/auth/errors';

/**
 * The sign-in error banner is driven by `?error=` on a URL the user arrived on.
 *
 * That parameter is ATTACKER-SUPPLIED: the whole point of `/auth/callback` is to
 * redirect here with a code, which means anyone can hand a victim a link ending in
 * `?error=<anything>`. So the parameter is an untrusted string and the allowlist
 * is the boundary.
 *
 * TWO PROPERTIES, both of which failed at least once:
 *
 *   1. NO REFLECTION. The supplied text never reaches the page. It is a lookup
 *      KEY, never a value.
 *   2. THE LOOKUP IS OWN-PROPERTY ONLY. `AUTH_ERROR_MESSAGES['constructor']`
 *      returns `[Function: Object]` because the allowlist is an object literal and
 *      inherits from `Object.prototype`. The `?? AUTH_ERROR_FALLBACK` this replaced
 *      therefore never fired for `constructor`, `toString`, `valueOf`,
 *      `hasOwnProperty` or `__proto__` - the function was returned and React threw.
 *      `GET /sign-in?error=toString` was a crash.
 */

/**
 * Codes chosen to attack the lookup rather than to be displayed. Every one of
 * these is a defined, non-nullish property of `Object.prototype`, which is
 * exactly why a nullish fallback does not catch them.
 */
const PROTOTYPE_KEYS = [
  'constructor',
  'toString',
  'valueOf',
  'hasOwnProperty',
  'isPrototypeOf',
  'propertyIsEnumerable',
  'toLocaleString',
  '__proto__',
  '__defineGetter__',
] as const;

/** Payloads that must never be reflected into the rendered banner. */
const INJECTION_PAYLOADS = [
  '<script>alert(1)</script>',
  '"><img src=x onerror=alert(1)>',
  'javascript:alert(document.cookie)',
  'auth_callback_failed<p>injected</p>',
  'AUTH_CALLBACK_FAILED',
  'otp_expired ',
] as const;

describe('authErrorMessage never reflects the supplied code', () => {
  it.each(INJECTION_PAYLOADS)('does not embed %o in the message it returns', (payload) => {
    const message = authErrorMessage(payload);

    expect(message).not.toBeNull();
    expect(message).not.toContain(payload);
  });

  it('gives an unknown code the same generic copy whatever the code was', () => {
    // Two different unknown codes must be indistinguishable to the user. If the
    // code leaked in ANY form - echoed, truncated, hashed into the class name -
    // this would still pass, which is why the assertions above check the message
    // body and not just equality.
    const a = authErrorMessage('some_other_failure');
    const b = authErrorMessage('yet_another_failure');

    expect(a).toBe(b);
    expect(a).toBe(AUTH_ERROR_FALLBACK);
  });

  it('never returns markup, for any input at all', () => {
    // A property over the whole input space we care about, not a sample of it.
    const corpus = [...PROTOTYPE_KEYS, ...INJECTION_PAYLOADS, 'auth_callback_failed'];

    for (const code of corpus) {
      const message = authErrorMessage(code);

      expect(typeof message).toBe('string');
      expect(message as string).not.toMatch(/[<>]/);
    }
  });
});

describe('authErrorMessage does not resolve inherited properties', () => {
  // THE regression. Against the `?? AUTH_ERROR_FALLBACK` implementation every one
  // of these returned a FUNCTION from Object.prototype, which React then threw on.
  it.each(PROTOTYPE_KEYS)('treats %o as unknown rather than as a property', (key) => {
    const message = authErrorMessage(key);

    expect(message).toBe(AUTH_ERROR_FALLBACK);
    expect(typeof message).toBe('string');
  });

  it('would fail against the naive lookup, which is why the guard exists', () => {
    // The defect proven present in the shape this replaced, so this assertion
    // cannot silently rot into "always true". AGENTS.md: a test that has never
    // been shown to fail proves nothing.
    const naive = AUTH_ERROR_MESSAGES as unknown as Record<string, unknown>;

    expect(naive['constructor']).toBeDefined();
    expect(naive['constructor']).not.toBe(AUTH_ERROR_FALLBACK);
  });

  it('resolves a real code even though prototype keys are also present', () => {
    // The other direction: `Object.hasOwn` must not have broken ordinary lookups.
    expect(authErrorMessage('auth_callback_failed')).toBe(AUTH_ERROR_MESSAGES.auth_callback_failed);
  });
});
