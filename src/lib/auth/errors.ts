/**
 * Copy for the codes an authentication route can redirect with.
 *
 * WHY THIS LIVES HERE AND NOT IN THE SIGN-IN PAGE
 *
 * It was declared inside `sign-in/page.tsx`, where it was unreachable from a test:
 * a page is an async Server Component that calls `getSessionUser()` and
 * `redirect()`, so asserting the allowlist meant standing up the whole request.
 * An allowlist is a security POLICY, and the tests that matter here are about the
 * policy - that an attacker-supplied code is never reflected - not about the page
 * that happens to render it.
 *
 * THE RULE: AN UNKNOWN CODE IS NEVER ECHOED.
 *
 * `searchParams.error` is attacker-supplied. Interpolating it back into the page
 * would put arbitrary text into the sign-in form, which is reflected XSS
 * depending on the template and a convincing phishing surface either way. So the
 * code is used only as a LOOKUP KEY. A code we do not recognise still has to tell
 * the user something happened - silently rendering an ordinary sign-in form is
 * what made an expired link look like the site ignoring them - so it gets the
 * generic message, and the generic message carries no part of the input.
 */

export const AUTH_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  auth_callback_failed:
    'That sign-in link could not be completed. It may have expired or already been used.',
  otp_expired: 'That verification link has expired. Request a new one below.',
};

/** Shown for a code we do not recognise. Must never embed the supplied code. */
export const AUTH_ERROR_FALLBACK = 'We could not complete that sign-in. Please try again.';

/**
 * Resolve a caller-supplied error code to display copy.
 *
 * Returns `null` when there is no error at all, which is the common case: the
 * ordinary sign-in page renders no banner. Returns a string - never `undefined` -
 * for any non-empty code, because an unrecognised code must not read as "no
 * error happened".
 *
 * WHY `Object.hasOwn` AND NOT `?? FALLBACK`
 *
 * This is a real bug that shipped, in the page version of this code as well as
 * the first version of this module.
 *
 *     AUTH_ERROR_MESSAGES['constructor']  // => [Function: Object]
 *
 * The allowlist is an object LITERAL, so it inherits from `Object.prototype`.
 * Every prototype member is a defined, non-nullish property, so `??` never
 * fires for them. The names `constructor`, `toString`, `valueOf`, `hasOwnProperty`
 * and `__proto__` therefore resolve to a FUNCTION, the `??` fallback is skipped,
 * and the function is handed to React as a child - which throws and takes down the
 * sign-in page.
 *
 * The reachability is the point: it is one query string. `GET /sign-in?error=toString`
 * is a crash, not a rendering oddity, and nothing about it looks like an attack in
 * a log. This is the same family as the `safeNext` defect one layer over - a check
 * that reads as exhaustive and is only exhaustive over the keys someone imagined.
 *
 * `Object.hasOwn` is the correct test: it asks whether the allowlist really
 * declares this code, rather than whether some property somewhere resolves to it.
 */
export function authErrorMessage(code: string | null | undefined): string | null {
  // An all-whitespace code is treated as absent. It is falsy-adjacent to a user
  // reading "nothing went wrong", and there is no legitimate reason to send one.
  if (typeof code !== 'string') return null;
  const trimmed = code.trim();
  if (trimmed === '') return null;

  if (!Object.hasOwn(AUTH_ERROR_MESSAGES, trimmed)) return AUTH_ERROR_FALLBACK;

  return AUTH_ERROR_MESSAGES[trimmed] as string;
}
