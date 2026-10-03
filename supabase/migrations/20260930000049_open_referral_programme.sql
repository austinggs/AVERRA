-- =============================================================================
-- Averra migration 049: Open the referral programme
--
-- This is the LAUNCH EVENT, recorded rather than done by hand.
--
-- The flag exists so that opening and closing the programme is a decision. Before an
-- admin console exists (doc 87 section 18 is unbuilt), a migration is the only
-- auditable way to record one - and an audit trail of "the programme opened on this
-- date" is worth more than the convenience of an unrecorded flip.
--
-- Closing it again is the same statement with 'false'. Nothing else needs to change:
-- codes already issued stay valid, and attribution continues to work for a code that
-- somebody is holding, because a code that stops working the moment a switch moves
-- would be worse than either state.
--
-- Doc 39 is unaffected: attribution still pays nothing. Qualification and reward
-- remain separate, server-driven steps.
-- =============================================================================

update app.system_config
set value = 'true', updated_at = now()
where key = 'referral_programme_open';

-- Mint codes for everyone who already had an account. Without this, opening the flag
-- would only ever reach people who happen to sign up next, and the existing user base
-- would still see "programme not open" - which is exactly the state this migration
-- is meant to end.
select app_private.backfill_missing_referral_codes();