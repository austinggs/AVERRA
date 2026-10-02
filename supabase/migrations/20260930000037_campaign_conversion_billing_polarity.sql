-- =============================================================================
-- Averra migration 037: correct the advertiser billing constraint
--
-- Source of truth: 42_ADVERTISER_PLATFORM.txt (BILLING), 71_ARCHITECTURAL_LAWS.md,
--                  docs/change-records/CR-0015-database-test-repair.md
--
-- Doc 42 BILLING: "Advertiser charges reconcile to VERIFIED conversions and
-- agreed pricing, not raw clicks unless the campaign is explicitly CPC/CPM."
-- Migration 025 expressed that as
--
--     check (verified = false or charged_amount_minor = 0)
--
-- which is the INVERSE of its own comment. As written it
--   * PERMITS an unverified conversion to carry a charge, because verified = false
--     makes the first disjunct true; and
--   * REFUSES a charge on a verified conversion, because both disjuncts are false.
--
-- The second effect is the louder one: it makes legitimate advertiser billing
-- unrepresentable, so the bug would have surfaced as a broken invoice, not as a
-- silent overcharge. The constraint is corrected FORWARDS rather than by editing
-- 025, because 025 has already been applied; the drop-then-add is idempotent, so
-- replaying this file after a manual correction is harmless.
--
-- Found by supabase/tests/growth.sql, which had never been executed. That suite's
-- assertion is the regression test for this fix and is deliberately NOT weakened
-- to match the old expression.
-- =============================================================================

alter table app.campaign_conversions
  drop constraint campaign_conversions_unverified_not_charged;

alter table app.campaign_conversions
  add constraint campaign_conversions_unverified_not_charged check (
    verified = true or charged_amount_minor = 0
  );

comment on constraint campaign_conversions_unverified_not_charged on app.campaign_conversions is
  'Doc 42 BILLING: only a VERIFIED conversion may carry a charge. Polarity corrected in migration 037; the original expression permitted billing an unverified conversion and refused it on a verified one.';