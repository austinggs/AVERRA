import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { render, screen } from '@testing-library/react';
import { BrandLockup, BrandMark } from '@/components/brand/BrandLockup';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: React.ComponentProps<'a'>) => (
    <a href={typeof href === 'string' ? href : String(href)} {...rest}>
      {children}
    </a>
  ),
}));

/**
 * The lockup, and the duplication it removed.
 *
 * Two rules. The first is behavioural. The second cannot be: four verbatim copies of
 * a brand mark drift, and the drift is invisible until someone notices the header on
 * one page is not the header on another. So the second rule reads source - the same
 * approach as the vendor-palette gate in design-tokens.test.tsx, for the same reason:
 * a behavioural test cannot tell one lockup from a slightly different one.
 */
describe('BrandLockup renders one mark and one wordmark', () => {
  it('shows the wordmark as real text, not an image', () => {
    // Live text stays selectable, stays translatable, stays crisp at any DPI and is
    // readable by assistive technology. All four are lost the moment a wordmark is
    // baked into a raster asset.
    render(<BrandLockup />);

    expect(screen.getByText('Averra')).toBeInTheDocument();
  });

  it('hides the decorative mark from assistive technology', () => {
    // Without this, a screen reader announces "A, Averra" on every page, which
    // trains users to skip the header entirely.
    const { container } = render(<BrandLockup />);

    expect(container.querySelector('[aria-hidden="true"]')).toBeInTheDocument();
  });

  it('names the link with the wordmark alone', () => {
    render(<BrandLockup href="/" />);

    expect(screen.getByRole('link', { name: 'Averra' })).toHaveAttribute('href', '/');
  });

  it('keeps an accessible name when the wordmark is visually hidden', () => {
    // A narrow viewport may show the mark alone. Hiding the wordmark visually must
    // not leave a link whose name is "A" - which is also what every other icon-only
    // control in the system would then be called.
    render(<BrandLockup href="/" markOnly />);

    const link = screen.getByRole('link');
    expect(link).toHaveAccessibleName('Averra');
  });

  it('renders as plain markup when it is not a link', () => {
    const { container } = render(<BrandLockup />);

    expect(container.querySelector('a')).toBeNull();
  });
});

describe('BrandMark is token-driven, so it cannot diverge from the palette', () => {
  it('paints itself from a token rather than a fixed colour', () => {
    // A hardcoded hex here is exactly what CR-0040 removed from thirteen files,
    // and it is the one colour on the page that must survive both schemes.
    const { container } = render(<BrandMark />);
    const classes = container.firstElementChild?.className ?? '';

    expect(classes).toContain('bg-brand-500');
    expect(classes).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(classes).not.toMatch(/\b(red|blue|purple|green)-\d{2,3}\b/);
  });
});

describe('the lockup exists in exactly one place', () => {
  const files: string[] = (() => {
    const found: string[] = [];
    const stack = ['src/components', 'src/app'];

    while (stack.length) {
      const dir = stack.pop() as string;

      let entries: string[];
      try {
        entries = readdirSync(dir);
      } catch {
        continue;
      }

      for (const entry of entries) {
        const full = join(dir, entry);

        let isDirectory: boolean;
        try {
          isDirectory = statSync(full).isDirectory();
        } catch {
          continue;
        }

        if (isDirectory) stack.push(full);
        else if (/\.tsx$/.test(entry)) found.push(full);
      }
    }

    return found;
  })();

  it('scanned a real population', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('finds no hand-rolled copy of the mark outside BrandLockup', () => {
    // The four duplicates this replaced were all the same three lines: a 32px
    // brand tile, the letter A, and the wordmark. Any file that rebuilds that
    // outside the component is a copy again.
    const offenders: string[] = [];

    for (const file of files) {
      if (file.includes('brand')) continue;

      const source = readFileSync(file, 'utf8');
      if (/bg-brand-500[^"']*['"][\s\S]{0,80}?>\s*A\s*</.test(source)) {
        offenders.push(relative(process.cwd(), file));
      }
    }

    expect(`${files.length} scanned, ${offenders.length} bad: ${offenders.join(', ')}`).toBe(
      `${files.length} scanned, 0 bad: `,
    );
  });
});
