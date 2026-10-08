import { describe, expect, it } from 'vitest';
import {
  AD_FORMATS,
  AD_PLACEMENTS,
  EXCLUDED_AD_FORMATS,
  findPlacement,
  isAdEligibleRoute,
  isAdFormat,
  isBannerFormat,
  placementsForPath,
  reservedSizeFor,
  validatePlacements,
  type AdPlacement,
} from '@/lib/ads/placements';

// Enumerate the population FIRST, then filter.
//
// Per AGENTS.md, the third gate in this repository to fail by filtering before
// counting. A suite that only ever asks "is the landing page allowed?" and never
// counts what was rejected would report `ok` on a policy that had quietly been
// widened to every route. Every negative assertion below counts the whole set it is
// filtering, so a predicate that matches nothing is visible.

describe('ad placement policy', () => {
  it('approves exactly the four intended formats and no others', () => {
    // 4 total, 4 allowed. If a format were added without review, this count moves.
    expect(AD_FORMATS.length).toBe(4);
    expect(AD_FORMATS).toContain('native');
    expect(AD_FORMATS).toContain('300x250');

    // Popunder, social bar, interstitial and push are all absent.
    for (const excluded of EXCLUDED_AD_FORMATS) {
      expect(isAdFormat(excluded)).toBe(false);
    }
  });

  it('treats native as having no fixed banner size', () => {
    expect(isBannerFormat('native')).toBe(false);
    expect(reservedSizeFor('native')).toBeNull();
    expect(reservedSizeFor('300x250')).toEqual({ width: 300, height: 250 });
    expect(reservedSizeFor('728x90')).toEqual({ width: 728, height: 90 });
  });

  it('keeps every placement on a route that requires no session', () => {
    // Enumerate the whole table, then count the bad ones. Reporting only the bad
    // count would hide a predicate that silently matched nothing.
    const placements = AD_PLACEMENTS;
    const sessioned = placements.filter((placement) => !isAdEligibleRoute(placement.path));

    expect(`${placements.length} total, ${sessioned.length} sessioned`).toBe(
      `${placements.length} total, 0 sessioned`,
    );
  });

  it('refuses ads on authenticated routes, enumerating the candidates', () => {
    // The routes an ad must NEVER reach. If `/dashboard` ever became eligible this
    // fails with a named message rather than passing on an empty result set.
    const mustRefuse = [
      '/dashboard',
      '/wallet',
      '/tasks',
      '/earn',
      '/withdraw',
      '/game',
      '/admin',
    ];

    const admitted = mustRefuse.filter((route) => isAdEligibleRoute(route));

    expect(`${mustRefuse.length} candidates, ${admitted.length} admitted`).toBe(
      `${mustRefuse.length} candidates, 0 admitted`,
    );
  });

  it('refuses ads on the sign-in and sign-up routes specifically', () => {
    // An ad covering a credential form is the concrete harm behind the rule, so it
    // gets its own assertion rather than being folded into the list above.
    expect(isAdEligibleRoute('/sign-in')).toBe(false);
    expect(isAdEligibleRoute('/sign-up')).toBe(false);
  });

  it('approves the landing page and returns its placements', () => {
    expect(isAdEligibleRoute('/')).toBe(true);

    const placements = placementsForPath('/');
    expect(placements.length).toBe(AD_PLACEMENTS.length);
    expect(placements.every((placement) => placement.path === '/')).toBe(true);
  });

  it('returns nothing for any route outside the approved set', () => {
    // Includes a NEAR MISS. `/unknown` is not `/`, and a prefix match would wrongly
    // admit it; `/` must not be treated as a prefix of everything.
    expect(placementsForPath('/pricing')).toEqual([]);
    expect(placementsForPath('/earn')).toEqual([]);
    expect(placementsForPath('/unknown')).toEqual([]);
  });

  it('looks up a placement by id and reports null for an unknown one', () => {
    expect(findPlacement('home-native')?.format).toBe('native');
    expect(findPlacement('nope')).toBeNull();
  });

  it('stagger breakpoints so one viewport does not stack every format', () => {
    // A phone rendering all four placements at once is the layout failure the
    // breakpoint stagger exists to prevent.
    const atBase = AD_PLACEMENTS.filter((placement) => placement.showFrom === 'base');
    expect(atBase.length).toBeLessThan(AD_PLACEMENTS.length);
    expect(atBase.length).toBeGreaterThan(0);
  });
});

// PROVING THE VALIDATOR FAILS
//
// A validator run only on valid input proves nothing. These feed it deliberately
// broken tables and assert each rule fires. If a rule is removed, one of these turns
// red - which is the only evidence that the rule was ever load-bearing.

describe('validatePlacements (negative cases)', () => {
  const bad = (overrides: Partial<AdPlacement> & { id: string }): AdPlacement =>
    ({
      path: '/',
      format: 'native',
      showFrom: 'base',
      ...overrides,
    }) as AdPlacement;

  it('reports a placement on a sessioned route', () => {
    const problems = validatePlacements([bad({ id: 'x', path: '/wallet' })]);

    expect(problems.length).toBeGreaterThan(0);
    expect(problems.some((problem) => problem.includes('requires a session'))).toBe(true);
  });

  it('reports a duplicate placement id', () => {
    const problems = validatePlacements([bad({ id: 'dupe' }), bad({ id: 'dupe' })]);

    expect(problems.some((problem) => problem.includes('duplicate placement id'))).toBe(true);
  });

  it('reports a format outside the allowlist', () => {
    const problems = validatePlacements([
      bad({ id: 'x', format: 'popunder' as AdPlacement['format'] }),
    ]);

    expect(problems.some((problem) => problem.includes('not in the allowlist'))).toBe(true);
    // The exclusion list must also fire, so neither rule is a redundant duplicate.
    expect(problems.some((problem) => problem.includes('explicitly excluded'))).toBe(true);
  });

  it('reports an unknown breakpoint', () => {
    const problems = validatePlacements([
      bad({ id: 'x', showFrom: 'xl' as AdPlacement['showFrom'] }),
    ]);

    expect(problems.some((problem) => problem.includes('known breakpoint'))).toBe(true);
  });

  it('reports a route outside the approved placement set', () => {
    // `/pricing` is public (so the session check passes) but is not an approved ad
    // route. Without the second rule, any public path could host an ad.
    const problems = validatePlacements([bad({ id: 'x', path: '/pricing' })]);

    expect(problems.some((problem) => problem.includes('not in the approved placement set'))).toBe(
      true,
    );
  });

  it('accepts the real table with zero problems', () => {
    // Reported WITH its population, so an empty match is distinguishable from a clean
    // table.
    expect(`${AD_PLACEMENTS.length} placements, ${validatePlacements().length} problems`).toBe(
      `${AD_PLACEMENTS.length} placements, 0 problems`,
    );
  });
});