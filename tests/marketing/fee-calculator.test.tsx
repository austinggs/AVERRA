import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { FEE_BASIS_POINTS } from '@/lib/financial/fee';

// The fee module is mocked so the LAST test in this file can prove the component
// DELEGATES rather than recomputing. Every other test reads through the real
// implementation, which is what makes the delegation test meaningful: it is the
// only thing here that depends on the mock, so a default of "use the real
// implementation" is the safe failure mode.
const calculateWithdrawalFeeMock = vi.hoisted(() =>
  vi.fn<(gross: bigint, feeBasisPoints?: number) => {
    grossMinor: bigint;
    feeMinor: bigint;
    netMinor: bigint;
    feeBasisPoints: number;
  }>(),
);

vi.mock('@/lib/financial/fee', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/financial/fee')>();

  return {
    ...actual,
    calculateWithdrawalFee: calculateWithdrawalFeeMock,
  };
});

// Imported AFTER the mock is declared so the component binds to the mocked
// function. Top-level await is required for this to work - a plain hoisted
// import would bind to the real module and the delegation test would be
// measuring nothing.
const { FeeCalculator } = await import('@/components/marketing/FeeCalculator');

// The REAL implementation, obtained before mocking. `vi.mock` intercepts
// subsequent imports of the module, so this reference is the un-mocked original.
const { calculateWithdrawalFee: realCalculateWithdrawalFee } = await vi.importActual<
  typeof import('@/lib/financial/fee')
>('@/lib/financial/fee');

beforeEach(() => {
  calculateWithdrawalFeeMock.mockReset();

  // Default to the REAL behaviour. Every test except the delegation one wants
  // genuine arithmetic, and taking it from the original module rather than
  // re-writing it here is what stops these tests being tautological.
  calculateWithdrawalFeeMock.mockImplementation(realCalculateWithdrawalFee);
});

// The landing page's fee calculator.
//
// THIS IS MONEY ARITHMETIC RENDERED ON A PUBLIC, UNAUTHENTICATED PAGE.
//
// That is worth stating plainly, because it sets the bar for what these tests
// are checking. The component has no session, no fetch and no server action, so
// the ONLY thing it can get wrong is DISPLAY. And displaying a withdrawal fee
// incorrectly to a prospective user is not a cosmetic bug: it is a published
// number about what somebody will be charged, rendered by the same module the
// charge actually comes from.
//
// The assertion that matters is the last one in this file, and it is written to
// fail if anyone reimplements the arithmetic locally.

/*
 * THE SLIDER'S SPOKEN VALUE.
 *
 * A native range input announces its raw `value`. This slider's value is in
 * MINOR UNITS, so at the default the accessibility layer says "twenty thousand"
 * while the page displays N200.00 - a hundredfold contradiction, on the one
 * control whose entire job is disclosing money honestly.
 *
 * `aria-valuetext` replaces it with the formatted figures the reader can see.
 */
describe('FeeCalculator announces its value in currency, not minor units', () => {
  it('gives the slider an aria-valuetext in formatted naira', () => {
    render(<FeeCalculator />);

    const slider = screen.getByRole('slider');

    // Asserted against the VISIBLE figures rather than a literal string, so the
    // spoken value cannot drift away from the printed one if formatting changes.
    //
    // The destructured elements are `| undefined` under
    // `noUncheckedIndexedAccess`, and that is CORRECT: if the component ever
    // renders a different number of figures these reads stop being meaningful.
    // The explicit length assertion is what makes that visible instead of
    // letting `?? ''` quietly assert that the spoken text contains nothing.
    const figures = screen.getAllByRole('definition');
    expect(`${figures.length} figures`).toBe('3 figures');

    const [gross, , net] = figures;

    expect(slider).toHaveAttribute(
      'aria-valuetext',
      expect.stringContaining(gross?.textContent ?? ''),
    );
    expect(slider).toHaveAttribute(
      'aria-valuetext',
      expect.stringContaining(net?.textContent ?? ''),
    );
  });

  it('never announces the raw minor-unit integer', () => {
    render(<FeeCalculator />);

    const slider = screen.getByRole('slider');

    // The default is 20,000 kobo. Spoken as "20000" that reads as a N20,000
    // withdrawal. Its presence as a leading token is the regression this guards.
    expect(slider.getAttribute('aria-valuetext')).not.toMatch(/^20,?000/);
  });

  it('keeps the spoken fee rate in step with the module, not a literal', () => {
    render(<FeeCalculator />);

    const rate = `${FEE_BASIS_POINTS / 100}%`;

    expect(screen.getByRole('slider')).toHaveAttribute(
      'aria-valuetext',
      expect.stringContaining(rate),
    );
    expect(screen.getByText(new RegExp(rate.replace('.', '\\.')))).toBeInTheDocument();
  });

  it('re-announces the new value when the slider moves', () => {
    render(<FeeCalculator />);

    const slider = screen.getByRole('slider');
    const before = slider.getAttribute('aria-valuetext');

    fireEvent.change(slider, { target: { value: '100000' } });

    const after = screen.getByRole('slider').getAttribute('aria-valuetext');

    expect(after).not.toBe(before);
    // 100,000 kobo is N1,000.00 gross and N850.00 net.
    expect(after).toContain('₦1,000.00');
    expect(after).toContain('₦850.00');
  });
});

describe('FeeCalculator renders the real fee function', () => {
  it('shows gross, fee and net for the default amount', () => {
    render(<FeeCalculator />);

    // Selected by ROLE rather than text. `getByText('₦200.00')` would also have
    // to survive the slider's end-labels, and would keep doing so only by luck
    // of the default amount not colliding with a range bound.
    const [gross, fee, net] = screen.getAllByRole('definition');

    expect(gross).toHaveTextContent('₦200.00');
    expect(fee).toHaveTextContent('-₦30.00');
    expect(net).toHaveTextContent('₦170.00');
  });

  it('renders exactly three figures, never fewer', () => {
    render(<FeeCalculator />);

    // The population check, stated separately so a component that silently
    // dropped the fee cannot pass by matching the two figures it did render.
    expect(screen.getAllByRole('definition')).toHaveLength(3);
  });

  it('updates every figure when the slider moves', () => {
    render(<FeeCalculator />);

    const slider = screen.getByRole('slider');

    // 10,000 minor units -> 1,500 fee -> 8,500 net.
    fireEvent.change(slider, { target: { value: '10000' } });

    const values = screen.getAllByRole('definition').map((node) => node.textContent?.trim());

    expect(values).toEqual(['₦100.00', '-₦15.00', '₦85.00']);
  });

  it('renders the net after fee, never before it', () => {
    render(<FeeCalculator />);

    fireEvent.change(screen.getByRole('slider'), { target: { value: '50000' } });

    // 50,000 -> 7,500 fee -> 42,500 net. A component that applied the fee to the
    // wrong side would render 50,000 as the net, overstating what the user
    // receives by 17%. `queryByText` for the gross confirms the number that
    // SHOULD be present is also absent from the net position.
    const [gross, , net] = screen.getAllByRole('definition');

    expect(gross).toHaveTextContent('₦500.00');
    expect(net).toHaveTextContent('₦425.00');
    expect(net).not.toHaveTextContent('₦500.00');
  });

  it('derives the rate label from FEE_BASIS_POINTS rather than a literal', () => {
    render(<FeeCalculator />);

    // The label is built from the constant, so a change to the fee cannot leave
    // a stale "15%" sitting on the marketing page next to a different charge.
    expect(screen.getByText(`${FEE_BASIS_POINTS / 100}% Platform Service and Maintenance Fee`)).toBeInTheDocument();
  });

  it('discloses that the illustration is not a balance or a credit', () => {
    render(<FeeCalculator />);

    // This sentence is the compliance half of the widget. Without it the three
    // figures sit on a public page looking exactly like a balance, which is the
    // one thing MoneyState exists to prevent.
    expect(screen.getByText(/not a balance\s+and not a credit/i)).toBeInTheDocument();
  });

  it('exposes a labelled slider with the real gross as its value', () => {
    render(<FeeCalculator />);

    const slider = screen.getByRole('slider', { name: /try a withdrawal amount/i });
    expect(slider).toHaveValue('20000');
  });

  it('agrees with calculateWithdrawalFee at every slider stop it offers', () => {
    render(<FeeCalculator />);

    const slider = screen.getByRole('slider');

    // Sweep the range and assert the RENDERED strings against the module.
    for (const raw of ['500', '1000', '20000', '33333', '123456', '500000']) {
      fireEvent.change(slider, { target: { value: raw } });

      const gross = BigInt(raw);
      // The ORIGINAL implementation, not the mock, so this test compares the
      // rendered output against the authoritative fee rather than against
      // whatever the mock happens to be configured to return.
      const expected = realCalculateWithdrawalFee(gross);

      const naira = (minor: bigint) => {
        const whole = (minor / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        return `₦${whole}.${(minor % 100n).toString().padStart(2, '0')}`;
      };

      // Scoped to the readout. `getByText` on the whole document is ambiguous at
      // the low end of the range: ₦5.00 is BOTH the gross readout and the
      // slider's minimum end-label, so an unscoped query throws "found multiple
      // elements" - a test bug that reads like a product bug.
      //
      // `dd` is the semantic hook: gross, fee and net are each the definition of
      // their own term, so selecting by role is what the markup is FOR rather
      // than a way around the ambiguity.
      const values = screen.getAllByRole('definition');

      // Reported WITH its population. Two figures when three are expected is the
      // "0 bad out of an empty set" shape that has bitten this repository before.
      expect(values).toHaveLength(3);

      const rendered = values.map((node) => node.textContent?.trim());
      expect(rendered).toContain(naira(expected.grossMinor));
      expect(rendered).toContain(naira(expected.netMinor));
      expect(rendered).toContain(`-${naira(expected.feeMinor)}`);
    }
  });

  it('DELEGATES to calculateWithdrawalFee rather than recomputing the fee', () => {
    // THIS IS THE TEST THAT ACTUALLY ENFORCES THE INVARIANT. The sweep above
    // does not, and the first draft of this file claimed it did.
    //
    // A local reimplementation of `gross * 0.15` was injected into the component
    // and the sweep test still PASSED. Measured over all 500,000 representable
    // slider values, the float form and the integer form AGREE EVERYWHERE for a
    // 15% rate - `Math.floor(n * 0.15)` and `(n * 1500n) / 10000n` return the
    // same integer for every n. So a value-comparison test cannot distinguish the
    // real implementation from a copy of it, and any test asserting only that
    // the numbers look right is measuring coincidence rather than delegation.
    //
    // What actually matters is the CALL. The component must go through the one
    // module the withdrawal path uses, so that a future change to the fee - a
    // different basis point count, a per-provider rate, a rounding-direction
    // change - propagates to this page by construction rather than requiring
    // someone to remember to update a second arithmetic expression.
    //
    // This asserts the delegation directly, by making the module's output
    // deliberately absurd. If the component computes the fee itself it will
    // ignore the mock and render real arithmetic, and the sentinel will not
    // appear - which is a failure, not a pass.
    calculateWithdrawalFeeMock.mockReturnValue({
      grossMinor: 20_000n,
      feeMinor: 4_242n,
      netMinor: 15_758n,
      feeBasisPoints: FEE_BASIS_POINTS,
    });

    render(<FeeCalculator />);

    // 4242 is not 15% of 20,000. Its presence proves the rendered figure came
    // from the module rather than from arithmetic in the component.
    expect(screen.getByText('-₦42.42')).toBeInTheDocument();
    expect(screen.getByText('₦157.58')).toBeInTheDocument();
    expect(screen.queryByText('-₦30.00')).not.toBeInTheDocument();
  });
});