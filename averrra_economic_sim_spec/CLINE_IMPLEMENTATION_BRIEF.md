# CLINE IMPLEMENTATION BRIEF

Build this feature as a replacement for the current mining simulator in the AVERRA repository.

## Non-negotiable outcome
AVERRA becomes a persistent virtual economic simulation with stocks, fictional crypto, jobs/wages, player wallets, custom trades, marketplace, news/events, seasons and a small isolated promotional real-reward layer.

## Non-negotiable boundaries
1. Virtual economy is not real money.
2. Fictional crypto is not blockchain crypto.
3. Real AVERRA wallet is not a game wallet.
4. Provisional real earnings are not withdrawable/spendable.
5. Manual payment verification is used for V1 store purchases.
6. No age/KYC bypass.
7. No client-authoritative finance.

## Required deliverable behavior
Before coding, inspect the existing repo and write a migration map for the current mining simulator.
Then implement the phases in `18_BUILD_ORDER.md`.

At each phase:
- add tests first where practical;
- run existing relevant tests;
- preserve unrelated AVERRA functionality;
- record migrations cleanly;
- update docs/counts only after tests are actually run.

Do not stop at UI mockups. The result must be a functioning server-authoritative system with database constraints, transactional mutations, tests, and responsive UI.
