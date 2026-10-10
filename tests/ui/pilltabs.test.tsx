import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PillTabs } from '@/components/ui/PillTabs';
// From the plain module, not the 'use client' one - see src/components/ui/pillTabIds.ts.
import { pillTabId, pillTabPanelId } from '@/components/ui/pillTabIds';

// PillTabs shipped completely inert.
//
// It rendered `<button role="tab">` with no onClick, no href and no form, while the
// page derived the active tab from `searchParams.tab`. The two halves could not reach
// each other: the server decided which tab was active, and the client had no mechanism
// to change the URL the server reads. Clicking "Surveys" did nothing at all, with no
// error - it looked like a working tab that simply had no data.
//
// This file protects the two properties that make it work:
//
//   1. REACHABILITY. A tab is a real link with an href. It must work before JavaScript
//      runs, support middle-click and open-in-new-tab, and be crawlable. A
//      handler-only tab is all three failures at once.
//   2. KEYBOARD (APG). Roving tabIndex plus Arrow/Home/End, so the group is operable by
//      keyboard rather than only by Tab-through-everything.

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: React.ComponentProps<'a'>) => (
    <a href={typeof href === 'string' ? href : String(href)} {...rest}>
      {children}
    </a>
  ),
}));

// Each item carries its own href rather than the component taking a `hrefFor(key)`
// callback. Props crossing from a Server Component to a Client Component must be
// serialisable and a function is not - and the page that renders these tabs IS a
// Server Component, so the callback shape would typecheck and then fail at runtime.
const ITEMS = [
  { key: 'offers', label: 'Offers', href: '/earn?tab=offers' },
  { key: 'surveys', label: 'Surveys', href: '/earn?tab=surveys' },
  { key: 'tasks', label: 'Tasks', href: '/earn?tab=tasks' },
] as const;

function renderTabs(activeKey = 'offers', extra: Record<string, unknown> = {}) {
  return render(
    <PillTabs
      items={ITEMS}
      activeKey={activeKey}
      ariaLabel="Choose between offers and surveys"
      {...extra}
    />,
  );
}

// `noUncheckedIndexedAccess` types `tabs[0]` as `HTMLElement | undefined`, which
// turns every focus assertion into a type error. This group always has exactly three
// tabs, so the tuple is asserted once here rather than guarded at each index.
function threeTabs(): [HTMLElement, HTMLElement, HTMLElement] {
  return screen.getAllByRole('tab') as [HTMLElement, HTMLElement, HTMLElement];
}

describe('PillTabs is reachable', () => {
  it('renders every tab as a link carrying the href it navigates to', () => {
    // THE regression. Against the inert implementation this finds zero links,
    // because every tab was a <button> with no handler and no href.
    renderTabs('offers');

    expect(screen.getByRole('tab', { name: 'Offers' })).toHaveAttribute('href', '/earn?tab=offers');
    expect(screen.getByRole('tab', { name: 'Surveys' })).toHaveAttribute(
      'href',
      '/earn?tab=surveys',
    );
    expect(screen.getByRole('tab', { name: 'Tasks' })).toHaveAttribute('href', '/earn?tab=tasks');
  });

  it('marks exactly the active tab as selected', () => {
    renderTabs('surveys');

    expect(screen.getByRole('tab', { name: 'Offers' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tab', { name: 'Surveys' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Tasks' })).toHaveAttribute('aria-selected', 'false');
  });

  it('exposes the tablist with the label the caller supplied', () => {
    // An unlabelled tab group is unusable with a screen reader.
    renderTabs();
    expect(screen.getByRole('tablist')).toHaveAccessibleName('Choose between offers and surveys');
  });

  it('renders an optional count beside the label', () => {
    render(
      <PillTabs
        items={[{ key: 'offers', label: 'Offers', count: 12 }]}
        activeKey="offers"
        ariaLabel="Inventory"
      />,
    );

    expect(screen.getByRole('tab', { name: /Offers/ })).toHaveTextContent('12');
  });
});

describe('PillTabs keyboard behaviour (APG)', () => {
  it('uses a roving tabIndex: one tab is reachable, the rest are skipped', () => {
    // Without this, a three-tab group costs three Tab presses to traverse and screen
    // readers announce all of them as stops.
    renderTabs('offers');

    const tabs = threeTabs();

    expect(tabs[0]).toHaveAttribute('tabindex', '0');
    expect(tabs[1]).toHaveAttribute('tabindex', '-1');
    expect(tabs[2]).toHaveAttribute('tabindex', '-1');
  });

  it('moves focus with ArrowRight and wraps at the end', () => {
    renderTabs('offers');

    const tabs = threeTabs();
    tabs[0].focus();
    expect(document.activeElement).toBe(tabs[0]);

    fireEvent.keyDown(tabs[0], { key: 'ArrowRight' });
    expect(document.activeElement).toBe(tabs[1]);

    fireEvent.keyDown(tabs[1], { key: 'ArrowRight' });
    expect(document.activeElement).toBe(tabs[2]);

    // Wraps rather than dead-ending on the last tab.
    fireEvent.keyDown(tabs[2], { key: 'ArrowRight' });
    expect(document.activeElement).toBe(tabs[0]);
  });

  it('moves focus with ArrowLeft and wraps at the start', () => {
    renderTabs('offers');

    const tabs = threeTabs();
    tabs[0].focus();

    fireEvent.keyDown(tabs[0], { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(tabs[2]);
  });

  it('jumps to the first tab with Home and the last with End', () => {
    renderTabs('offers');

    const tabs = threeTabs();
    tabs[0].focus();

    fireEvent.keyDown(tabs[0], { key: 'End' });
    expect(document.activeElement).toBe(tabs[2]);

    fireEvent.keyDown(tabs[2], { key: 'Home' });
    expect(document.activeElement).toBe(tabs[0]);
  });

  // ACTIVATION IS DERIVED FROM THE ITEMS, AND THE TWO CASES DIFFER
  //
  // This file previously asserted "automatic activation" against a group whose items
  // all carried an `href`, and it passed - because the test passed an `onSelect` that
  // the only real caller (the earn page) does not pass, and the component called it
  // on arrow regardless. The earn page's tabs are links, so a link was never
  // activated by an arrow key: focus moved and nothing happened.
  //
  // That is the right behaviour for a link, and APG says so - automatic activation is
  // wrong when activating a tab costs a page load. But the code and its comment
  // claimed something else, which is the defect worth pinning. So:
  //
  //   a group with LINKS   -> manual: arrows move focus, Enter or click navigates
  //   a group with NO href -> automatic: arrows move focus AND filter in place
  it('moves focus WITHOUT activating a linked tab, because a link needs Enter', () => {
    // THE regression. Against the unconditional `onSelect` call this fires, and the
    // earn page would have re-requested the page on every arrow press.
    const onSelect = vi.fn();
    renderTabs('offers', { onSelect });

    const tabs = threeTabs();
    fireEvent.keyDown(tabs[0], { key: 'ArrowRight' });

    expect(document.activeElement).toBe(tabs[1]);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('still lets a linked tab be clicked, so manual activation is reachable', () => {
    // Manual must not mean unreachable. The link navigates natively.
    renderTabs('offers');

    expect(screen.getByRole('tab', { name: 'Surveys' })).toHaveAttribute(
      'href',
      '/earn?tab=surveys',
    );
  });

  it('activates automatically when no tab navigates, because filtering is free', () => {
    const onSelect = vi.fn();
    render(
      <PillTabs
        items={[
          { key: 'offers', label: 'Offers' },
          { key: 'surveys', label: 'Surveys' },
          { key: 'tasks', label: 'Tasks' },
        ]}
        activeKey="offers"
        ariaLabel="Inventory"
        onSelect={onSelect}
      />,
    );

    const tabs = screen.getAllByRole('tab') as [HTMLElement, HTMLElement, HTMLElement];
    fireEvent.keyDown(tabs[0], { key: 'ArrowRight' });

    expect(onSelect).toHaveBeenCalledWith('surveys');
  });

  it('honours an explicit override, so a caller can force manual', () => {
    // The escape hatch, asserted because an escape hatch nobody tests is a lie.
    const onSelect = vi.fn();
    render(
      <PillTabs
        items={[
          { key: 'offers', label: 'Offers' },
          { key: 'surveys', label: 'Surveys' },
        ]}
        activeKey="offers"
        ariaLabel="Inventory"
        onSelect={onSelect}
        activation="manual"
      />,
    );

    const tabs = screen.getAllByRole('tab') as [HTMLElement, HTMLElement];
    fireEvent.keyDown(tabs[0], { key: 'ArrowRight' });

    expect(document.activeElement).toBe(tabs[1]);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('does not re-activate the tab that is already active', () => {
    // Arrowing onto the current tab must not fire a selection for where the user
    // already is, which would reset the list for no reason.
    const onSelect = vi.fn();
    render(
      <PillTabs
        items={[
          { key: 'offers', label: 'Offers' },
          { key: 'surveys', label: 'Surveys' },
        ]}
        activeKey="offers"
        ariaLabel="Inventory"
        onSelect={onSelect}
      />,
    );

    fireEvent.keyDown(screen.getAllByRole('tab')[0] as HTMLElement, { key: 'Home' });

    expect(onSelect).not.toHaveBeenCalled();
  });

  it('ignores keys it does not handle, leaving browser behaviour intact', () => {
    const onSelect = vi.fn();
    renderTabs('offers', { onSelect });

    const tabs = threeTabs();
    tabs[0].focus();

    fireEvent.keyDown(tabs[0], { key: 'ArrowDown' });
    fireEvent.keyDown(tabs[0], { key: 'a' });

    expect(document.activeElement).toBe(tabs[0]);
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe('PillTabs with items that have no href', () => {
  it('still renders and still marks the active tab, for in-page filtering', () => {
    // Not every tab group navigates. `href` is optional per item, so a caller doing
    // client-side filtering gets buttons rather than links and the group still works.
    render(
      <PillTabs
        items={[
          { key: 'offers', label: 'Offers' },
          { key: 'surveys', label: 'Surveys' },
        ]}
        activeKey="surveys"
        ariaLabel="Inventory"
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByRole('tab', { name: 'Surveys' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Offers' })).toHaveAttribute('aria-selected', 'false');
  });

  it('selects on click when there is no href to navigate to', () => {
    const onSelect = vi.fn();
    render(
      <PillTabs
        items={[
          { key: 'offers', label: 'Offers' },
          { key: 'surveys', label: 'Surveys' },
        ]}
        activeKey="offers"
        ariaLabel="Inventory"
        onSelect={onSelect}
      />,
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Surveys' }));

    expect(onSelect).toHaveBeenCalledWith('surveys');
  });
});

describe('PillTabs wires tabs to their panel only when one is declared', () => {
  it('emits no aria-controls without a prefix, rather than a dangling id', () => {
    // An `aria-controls` naming an element that does not exist is a BROKEN
    // relationship, which assistive technology reports differently from no
    // relationship at all. A filter bar above a table has no panel to point at.
    renderTabs('offers');

    for (const tab of screen.getAllByRole('tab')) {
      expect(tab).not.toHaveAttribute('aria-controls');
      expect(tab.id).toBe('');
    }
  });

  it('points each tab at the panel id the page will render for it', () => {
    renderTabs('offers', { idPrefix: 'earn' });

    expect(screen.getByRole('tab', { name: 'Offers' })).toHaveAttribute(
      'aria-controls',
      pillTabPanelId('earn', 'offers'),
    );
    expect(screen.getByRole('tab', { name: 'Surveys' })).toHaveAttribute(
      'aria-controls',
      pillTabPanelId('earn', 'surveys'),
    );
  });

  it('gives each tab the id the panel will point back to', () => {
    // The reverse half of the relationship, which is what makes a screen reader
    // announce WHICH tab a panel belongs to.
    renderTabs('offers', { idPrefix: 'earn' });

    expect(screen.getByRole('tab', { name: 'Offers' })).toHaveAttribute(
      'id',
      pillTabId('earn', 'offers'),
    );
  });

  it('keeps two groups on one page from colliding', () => {
    // Ids are global to the document. A hardcoded prefix would make the second
    // tab group on any page shadow the first.
    render(
      <>
        <PillTabs items={ITEMS} activeKey="offers" ariaLabel="A" idPrefix="earn" />
        <PillTabs items={ITEMS} activeKey="offers" ariaLabel="B" idPrefix="tasks" />
      </>,
    );

    const both = screen.getAllByRole('tab', { name: 'Offers' });
    const first = both[0] as HTMLElement;
    const second = both[1] as HTMLElement;

    expect(first.id).not.toBe(second.id);
    expect(first.getAttribute('aria-controls')).not.toBe(second.getAttribute('aria-controls'));
  });
});

describe('PillTabs tap targets', () => {
  it('meets the 44px minimum tap target the design system requires', () => {
    // It was min-h-10 (40px). The project rule is 44px for anything interactive,
    // and a filter row is exactly where thumbs land.
    renderTabs();

    for (const tab of screen.getAllByRole('tab')) {
      expect(tab.className).toContain('min-h-11');
    }
  });
});
