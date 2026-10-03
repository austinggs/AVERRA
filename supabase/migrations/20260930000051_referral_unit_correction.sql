-- =============================================================================
-- Averra migration 051: Correct the qualifying unit
--
-- Correction to migration 050, found by running
-- `supabase/tests/referral_qualification.sql`.
--
-- 050 seeded `referral_qualifying_unit` = 'NGN'. But every funding record in this
-- schema carries the unit as 'NGN-kobo' - `perks.sql` funds an account as
-- 'NGN-kobo', and a deposit records whatever `declared_unit` the submitter used.
--
-- The effect was that EVERY contribution was dropped by the unit check:
--
--     if p_unit is distinct from v_unit then return v_referral; end if;
--
-- so a referral could accumulate ₦5,000 of perfectly valid deposits and still sit
-- at ATTRIBUTED forever. Every deposit assertion failed with `have: NULL`.
--
-- WHICH DIRECTION IS SAFE
--
-- The unit check fails CLOSED: a mismatch means nothing is counted and nothing is
-- paid. That is the right direction for a money path - a silent mismatch in the
-- other direction would let a USD deposit satisfy an NGN threshold. But a filter
-- seeded to a unit that no real record uses is a programme that can never pay,
-- which is the same class of bug as a permanently-closed feature.
--
-- 'NGN-kobo' is the string this codebase actually uses for minor-unit NGN amounts.
-- =============================================================================

update app.system_config
set value = 'NGN-kobo', updated_at = now()
where key = 'referral_qualifying_unit';