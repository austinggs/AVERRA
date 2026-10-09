import '@testing-library/jest-dom/vitest';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { HowItWorks } from '@/components/marketing/HowItWorks';

// The earning lifecycle stepper.
//
// The thing worth protecting here is that the copy stays TRUTHFUL about the
// sequence. This component is the one place a visitor is walked through what
// happens between "I finished a task" and "I have money", and the load-bearing
// sentence is that a claim is not a payment. If the stepper ever described a
// claim as a credit, that would be doc 12 and doc 09 being violated by
// marketing copy rather than by code - which is precisely how those rules get
// eroded in practice.
//
// The accessibility assertions matter too: a `tablist` whose `aria-controls`
// and `aria-labelledby` point at ids that do not exist is a control a screen
// reader cannot operate, and it fails silently for everyone else.

describe('HowItWorks presents the lifecycle as a real tablist', () => {
  it('renders four steps with exactly one selected', () => {
    render(<HowItWorks />);

    const tablist = screen.getByRole('tablist', { name: /how earning works/i });
    const tabs = within(tablist).getAllByRole('tab');

    expect(tabs).toHaveLength(4);

    const selected = tabs.filter((tab) => tab.getAttribute('aria-selected') === 'true');

    // Reported WITH the population. `toHaveLength(1)` alone would also pass if the
    // filter matched nothing and a separate assertion covered the total, so both
    // numbers are stated here.
    expect(`${tabs.length} tabs, ${selected.length} selected`).toBe('4 tabs, 1 selected');
    expect(selected.at(0)).toHaveTextContent('Claim');
  });

  it('wires the selected tab to a panel that exists and points back at it', () => {
    const { container } = render(<HowItWorks />);

    const tab = screen.getByRole('tab', { selected: true });
    const controls = tab.getAttribute('aria-controls');

    expect(controls).toBeTruthy();

    // An `aria-controls` pointing at nothing is a broken control that no visual
    // inspection will ever catch.
    const panel = container.querySelector(`#${CSS.escape(controls!)}`);
    expect(panel).not.toBeNull();

    // And the relationship runs BOTH ways: the panel names the tab that labels
    // it. One direction alone is the half-finished version of this wiring, and
    // it was the first draft of this test - it asserted `aria-labelledby` on the
    // TAB, where no such attribute belongs.
    expect(panel).toHaveAttribute('aria-labelledby', tab.getAttribute('id'));
  });

  it('mounts exactly one panel, matching the selected tab', () => {
    const { container } = render(<HowItWorks />);

    const tab = screen.getByRole('tab', { selected: true });
    const panels = within(container).getAllByRole('tabpanel');

    expect(panels).toHaveLength(1);
    expect(panels.at(0)?.id).toBe(tab.getAttribute('aria-controls'));
  });
});

describe('selecting a step changes the panel', () => {
  it('moves the selection and swaps the panel content', () => {
    render(<HowItWorks />);

    expect(screen.getByText('You complete the work')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /verify/i }));

    expect(screen.getByText('We check it ourselves')).toBeInTheDocument();
    expect(screen.queryByText('You complete the work')).not.toBeInTheDocument();

    const verifyTab = screen.getByRole('tab', { name: /verify/i });
    expect(verifyTab).toHaveAttribute('aria-selected', 'true');
  });

  it('keeps the previous step reachable after moving on', () => {
    render(<HowItWorks />);

    fireEvent.click(screen.getByRole('tab', { name: /settle/i }));
    fireEvent.click(screen.getByRole('tab', { name: /claim/i }));

    expect(screen.getByText('You complete the work')).toBeInTheDocument();
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
  });
});

/*
 * KEYBOARD OPERATION - the defect a visual review cannot find.
 *
 * The tabs carry `tabIndex={selected ? 0 : -1}`, the APG roving-tabindex pattern.
 * That pattern is only correct when the arrow keys move focus, because `-1`
 * removes a tab from the Tab order. With no key handler the component shipped in
 * that state: a keyboard user could Tab to step 1 and then reach NOTHING else -
 * three of the four lifecycle steps were mouse-only, and the roving tabindex is
 * what made it worse rather than better.
 *
 * So these assert the keys, not the styling.
 */
describe('the tablist is operable from the keyboard alone', () => {
  it('moves selection and focus with ArrowRight and ArrowLeft', () => {
    render(<HowItWorks />);

    const first = screen.getByRole('tab', { name: /claim/i });
    first.focus();
    expect(first).toHaveFocus();

    fireEvent.keyDown(first, { key: 'ArrowRight' });

    const second = screen.getByRole('tab', { name: /verify/i });
    expect(second).toHaveAttribute('aria-selected', 'true');
    // Focus MUST follow selection. Selecting without moving focus leaves the
    // arrow keys pressing against a stale index, so the next press jumps two.
    expect(second).toHaveFocus();
    expect(screen.getByText('We check it ourselves')).toBeInTheDocument();

    fireEvent.keyDown(second, { key: 'ArrowLeft' });

    expect(first).toHaveAttribute('aria-selected', 'true');
    expect(first).toHaveFocus();
    expect(screen.getByText('You complete the work')).toBeInTheDocument();
  });

  it('supports ArrowUp and ArrowDown as well as horizontal arrows', () => {
    render(<HowItWorks />);

    const first = screen.getByRole('tab', { name: /claim/i });
    first.focus();

    fireEvent.keyDown(first, { key: 'ArrowDown' });
    expect(screen.getByRole('tab', { name: /verify/i })).toHaveFocus();

    fireEvent.keyDown(screen.getByRole('tab', { name: /verify/i }), { key: 'ArrowUp' });
    expect(first).toHaveFocus();
  });

  it('wraps around at both ends rather than dead-ending', () => {
    render(<HowItWorks />);

    const first = screen.getByRole('tab', { name: /claim/i });
    first.focus();

    // Backwards off the first step lands on the LAST, which is what makes the
    // control feel continuous instead of having two dead edges.
    fireEvent.keyDown(first, { key: 'ArrowLeft' });
    const last = screen.getByRole('tab', { name: /withdraw/i });
    expect(last).toHaveFocus();

    fireEvent.keyDown(last, { key: 'ArrowRight' });
    expect(first).toHaveFocus();
  });

  it('jumps to the first and last step with Home and End', () => {
    render(<HowItWorks />);

    const first = screen.getByRole('tab', { name: /claim/i });
    first.focus();

    fireEvent.keyDown(first, { key: 'End' });
    const last = screen.getByRole('tab', { name: /withdraw/i });
    expect(last).toHaveFocus();
    expect(last).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(last, { key: 'Home' });
    expect(first).toHaveFocus();
    expect(first).toHaveAttribute('aria-selected', 'true');
  });

  it('prevents the default scroll only for the keys it handles', () => {
    render(<HowItWorks />);

    const first = screen.getByRole('tab', { name: /claim/i });

    const handled = fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(handled).toBe(false); // preventDefault was called -> default prevented

    const second = screen.getByRole('tab', { name: /verify/i });

    // PageDown must keep scrolling the page. A handler that swallows unlisted
    // keys takes browser behaviour nobody asked it to remove.
    const untouched = fireEvent.keyDown(second, { key: 'PageDown' });
    expect(untouched).toBe(true);
    expect(second).toHaveAttribute('aria-selected', 'true');
  });
});

describe('the copy does not describe a claim as a payment', () => {
  it('states that a claim is evidence, not a payment', () => {
    render(<HowItWorks />);

    fireEvent.click(screen.getByRole('tab', { name: /claim/i }));

    // The load-bearing sentence. Doc 12: a client completion claim is evidence
    // only, and the UI must never imply otherwise.
    expect(
      screen.getByText(/only ever evidence that you said you did it/i),
    ).toBeInTheDocument();
  });

  it('says a claim is never described to the user as a payment', () => {
    render(<HowItWorks />);

    expect(screen.getByText(/a claim is never described to you as a payment/i)).toBeInTheDocument();
  });

  it('attributes the settlement gate rather than implying instant payout', () => {
    render(<HowItWorks />);

    fireEvent.click(screen.getByRole('tab', { name: /settle/i }));

    // A visitor who believes a survey pays instantly is a visitor who churns in
    // week three. The slow part is named as the mechanism, not as an excuse.
    expect(screen.getByText(/settlement matches our records exactly/i)).toBeInTheDocument();
  });
});