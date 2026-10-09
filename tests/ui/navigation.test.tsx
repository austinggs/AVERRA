import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { BottomNav } from '@/components/ui/BottomNav';
import { TopNav } from '@/components/ui/TopNav';
import { ALL_TABS, CORE_TABS, SECONDARY_TABS } from '@/components/ui/navItems';

// Navigation components depend on next/link (router context) and
// next/navigation (app router). Both are replaced with the minimum surface
// they use: a plain anchor and a controllable pathname.

const route = vi.hoisted(() => ({ pathname: '/dashboard' }));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: React.ComponentProps<'a'>) => (
    <a href={typeof href === 'string' ? href : String(href)} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => route.pathname,
}));

beforeEach(() => {
  route.pathname = '/dashboard';
});

describe('navigation split (navItems.ts)', () => {
  // The split IS the fix for the cramped bar: nine tabs at 320px is ~35px
  // each, under the 44px tap rule. If someone adds a seventh core tab, this
  // fails before the tap rule breaks again.
  it('core has exactly six destinations and secondary has the rest', () => {
    expect(CORE_TABS).toHaveLength(6);
    expect(SECONDARY_TABS).toHaveLength(3);
    expect(ALL_TABS).toHaveLength(9);
  });

  it('the two lists are disjoint and every href is unique', () => {
    const coreHrefs = CORE_TABS.map((tab) => tab.href);
    const secondaryHrefs = SECONDARY_TABS.map((tab) => tab.href);

    expect(coreHrefs.filter((href) => secondaryHrefs.includes(href))).toEqual([]);
    expect(new Set(ALL_TABS.map((tab) => tab.href)).size).toBe(ALL_TABS.length);
  });

  it('ALL_TABS is core followed by secondary (header order)', () => {
    expect(ALL_TABS.map((tab) => tab.href)).toEqual([
      ...CORE_TABS.map((tab) => tab.href),
      ...SECONDARY_TABS.map((tab) => tab.href),
    ]);
  });
});

describe('BottomNav (mobile)', () => {
  it('renders the six core tabs plus a More trigger, and is hidden from md up', () => {
    const { container } = render(<BottomNav core={CORE_TABS} secondary={SECONDARY_TABS} />);

    const nav = container.querySelector('nav');
    expect(nav).toHaveAttribute('aria-label', 'Primary');
    // The responsive gate itself: removing md:hidden resurrects the desktop
    // footer bar under TopNav.
    expect(nav?.className).toContain('md:hidden');

    for (const tab of CORE_TABS) {
      expect(screen.getByRole('link', { name: new RegExp(tab.label) })).toBeInTheDocument();
    }

    expect(screen.getByRole('button', { name: /More/ })).toBeInTheDocument();
    // Secondary destinations must NOT appear in the bar itself.
    expect(screen.queryByRole('link', { name: /Perks/ })).not.toBeInTheDocument();
  });

  it('marks the current destination with aria-current', () => {
    route.pathname = '/earn';
    render(<BottomNav core={CORE_TABS} secondary={SECONDARY_TABS} />);

    expect(screen.getByRole('link', { name: /Earn/ })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: /Home/ })).not.toHaveAttribute('aria-current');
  });

  it('opens a modal dialog from More and shows the secondary destinations', () => {
    render(<BottomNav core={CORE_TABS} secondary={SECONDARY_TABS} />);

    const trigger = screen.getByRole('button', { name: /More/ });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');

    fireEvent.click(trigger);

    const dialog = screen.getByRole('dialog', { name: 'More destinations' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    for (const tab of SECONDARY_TABS) {
      expect(within(dialog).getByRole('link', { name: new RegExp(tab.label) })).toBeInTheDocument();
    }

    // The core tabs are NOT duplicated inside the sheet.
    expect(within(dialog).queryByRole('link', { name: /Wallet/ })).not.toBeInTheDocument();
  });

  it('Escape closes the sheet, restores focus and unlocks body scroll', () => {
    render(<BottomNav core={CORE_TABS} secondary={SECONDARY_TABS} />);

    const trigger = screen.getByRole('button', { name: /More/ });
    fireEvent.click(trigger);
    expect(document.body.style.overflow).toBe('hidden');

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe('');
    expect(document.activeElement).toBe(trigger);
  });

  it('the backdrop closes the sheet but a click inside the sheet does not', () => {
    render(<BottomNav core={CORE_TABS} secondary={SECONDARY_TABS} />);

    fireEvent.click(screen.getByRole('button', { name: /More/ }));
    const dialog = screen.getByRole('dialog', { name: 'More destinations' });

    // Click the sheet itself - stopPropagation should keep it open.
    fireEvent.click(dialog);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // Click the backdrop container (the dialog's parent).
    fireEvent.click(dialog.parentElement!);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('aggregates secondary badges onto the More trigger with an sr-only count', () => {
    const secondary = SECONDARY_TABS.map((tab, index) =>
      index === 0 ? { ...tab, badge: 3 } : index === 1 ? { ...tab, badge: 2 } : tab,
    );

    render(<BottomNav core={CORE_TABS} secondary={secondary} />);

    const trigger = screen.getByRole('button', { name: /More/ });
    expect(trigger).toHaveTextContent('5');
    expect(trigger).toHaveTextContent(', 5 unread');
  });

  it('renders no More trigger when there are no secondary destinations', () => {
    render(<BottomNav core={CORE_TABS} secondary={[]} />);

    expect(screen.queryByRole('button', { name: /More/ })).not.toBeInTheDocument();
  });
});

describe('TopNav (desktop header)', () => {
  it('is hidden below md and rendered as a Primary landmark from md up', () => {
    const { container } = render(<TopNav items={ALL_TABS} />);

    const nav = container.querySelector('nav');
    expect(nav).toHaveAttribute('aria-label', 'Primary');
    expect(nav?.className).toContain('hidden');
    expect(nav?.className).toContain('md:flex');
  });

  it('renders every destination exactly once', () => {
    render(<TopNav items={ALL_TABS} />);

    expect(screen.getAllByRole('link')).toHaveLength(ALL_TABS.length);

    for (const tab of ALL_TABS) {
      // The accessible name comes from the text label even when the label is
      // visually hidden below xl, so name-based lookup works at every width.
      expect(screen.getByRole('link', { name: new RegExp(tab.label) })).toBeInTheDocument();
    }
  });

  it('marks the current destination, including a destination behind More on mobile', () => {
    route.pathname = '/perks';
    render(<TopNav items={ALL_TABS} />);

    expect(screen.getByRole('link', { name: /Perks/ })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: /Earn/ })).not.toHaveAttribute('aria-current');
  });
});
