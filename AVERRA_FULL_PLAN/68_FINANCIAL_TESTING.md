AVERRA — FINANCIAL TESTING

Document: 68_FINANCIAL_TESTING.md
Version: 1.1
Status: Approved planning baseline
Last reviewed: 2026-09-30

PURPOSE
Defines deterministic financial correctness tests.

REWARD TESTS
Valid/invalid callbacks, duplicate events, reversals, caps, pending→available, chargebacks, settlement lag, and campaign budgets.

LEDGER TESTS
Append-only behavior, compensating entries, balance derivation, concurrent mutations, idempotency, and referential integrity.

MANUAL MINIPAY CRYPTO DEPOSIT TESTS
- Celo + supported token + exact amount + successful transaction → VERIFIED candidate.
- Same transfer event submitted twice → only one credit is possible.
- Screenshot without transaction settlement → no credit.
- Unsupported token on Celo → NEEDS_REVIEW, no automatic credit.
- Supported token on wrong network → NEEDS_REVIEW, no automatic credit.
- Native CELO sent to deposit address → NEEDS_REVIEW, no automatic credit.
- Underpayment → NEEDS_REVIEW, no declared-amount credit.
- Overpayment → NEEDS_REVIEW; excess disposition is audited.
- Expired request with later transfer → NEEDS_REVIEW.
- Duplicate transaction hash with distinct transfer events → event-level uniqueness prevents double credit.
- Admin rejection → no funding credit.
- Admin confirmation → one immutable funding credit.
- Funding spend → separate debit; earned reward balance unchanged.

DAIMO DEPOSIT TESTS
Hurry request, duplicate Hurry, session creation, one-hour expiry design, payment before/after expiration, callback replay, settlement verification, admin confirmation, credit, and manual review.

FEE TESTS
Gross withdrawal × 15% fee, exact fee display, exact net payout, fee ledger event, and confirmation-screen disclosure. Deposit must not incur this fee.

RECONCILIATION TESTS
Missing event, extra event, amount mismatch, duplicate reference, externally settled but stale internal state, provider outage recovery, and unresolved manual-review cases.
