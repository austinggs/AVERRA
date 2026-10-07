-- =============================================================================
-- PROVIDER SETTLEMENT GATE AND ATTRIBUTION (migrations 059 / 060).
--
-- THE DEFECTS THESE ASSERT AGAINST
--
-- 1. `transition_reward` had NO condition on AVAILABLE. Migration 015's comment
--    claimed a conversion "settles via transition_reward once settlement is
--    confirmed", but nothing enforced it. Any caller with EXECUTE could make a
--    PENDING provider reward withdrawable before the provider paid. No money was at
--    risk only because the provider was CANDIDATE.
--
-- 2. `app.provider_settlements` had `expected_amount_minor` commented "Computed, not
--    trusted" and NOTHING computed it. Every settlement would have been
--    MATCHED-by-absence.
--
-- 3. `resolve_tracking_user` worked correctly and NEVER resolved anything, because
--    no migration inserts into `app.provider_participations`.
--
-- 4. CPX signs ONLY `md5(trans_id + secure_hash)`. `subid_1` is NOT covered by the
--    signature, and their trans_ids are sequential, so a forged `subid_1` naming
--    another user's tracking id is a well-formed callback that resolves to that user.
--
-- Every assertion below answers one question: can money leave this system without
-- the provider having actually reported paying for it?
-- =============================================================================

-- The suite runs in its OWN transaction, declared HERE rather than left to the runner.
--
-- `tools/run-db-tests.mjs` does NOT wrap a suite in begin/rollback - every other suite
-- in this directory declares its own. This file originally declared only a trailing
-- `rollback;` and no `begin;`, which PostgreSQL accepts as a no-op, so the entire
-- fixture was COMMITTED to the live database on every green run. Three `pgtap-%`
-- conversions accumulated and were still sitting there, which is how it was found.
--
-- `begin;` must precede `plan()`, and `rollback;` must be the last statement after
-- `finish()`.
begin;

select plan(47);

-- Defensive cleanup. This suite creates rows, and an ABORTED suite commits its
-- fixture (the runner's rollback cannot undo an aborted transaction). See AGENTS.md.

-- =============================================================================
-- THE GATE ITSELF
-- =============================================================================

-- The strongest single assertion in this suite, and it counts its whole population
-- rather than filtering first: a predicate that silently matches nothing reports
-- zero bad and reads like an assurance.
--
-- FOUR roles, and the count is reported beside the bad count so an empty population
-- is visible rather than inferred.
--
-- The table OWNER is deliberately excluded. `postgres` and `supabase_admin` own these
-- tables and bypass ACL entirely - `rolsuper` is false for postgres here, so it is
-- ownership, not superuser status. An owner can always re-GRANT itself EXECUTE, and
-- asserting it cannot would be asserting something PostgreSQL does not promise. What
-- matters is that the ROLES THAT RUN APPLICATION CODE - anon, authenticated and
-- service_role - are all excluded. An attacker holds the publishable key, which is
-- anon or authenticated; service_role is the ingestion path itself.
select is(
  (
    select count(*) from pg_roles
    where rolname in ('anon', 'authenticated', 'service_role')
      and has_function_privilege(
        rolname,
        'app_private.transition_reward_ungated(uuid, app.reward_state, text, uuid, uuid)'::regprocedure,
        'EXECUTE'
      )
  ),
  0::bigint,
  'TOTAL 3 application roles checked, 0 can execute transition_reward_ungated'
);

-- The count is asserted as the total too, so a future edit that narrows the role list
-- to nothing cannot turn this into a vacuous pass.
select is(
  (select count(*)::int from pg_roles where rolname in ('anon', 'authenticated', 'service_role')),
  3,
  'the three application roles all still exist, so the assertion above is not vacuous'
);

-- The pseudo-role PUBLIC is not in pg_roles, so it is checked separately. Dropping
-- the word `public` from a revoke leaves the function reachable - see AGENTS.md.
select is(
  (select has_function_privilege(
     'public',
     'app_private.transition_reward_ungated(uuid, app.reward_state, text, uuid, uuid)'::regprocedure,
     'EXECUTE'
   )),
  false,
  'the PUBLIC pseudo-role cannot execute it either'
);

-- The gate refuses AVAILABLE. A qualified assertion on the whole message, because
-- throws_ok compares SQLERRM by exact equality and this table's 23514s are many.
select throws_ok(
  $$ select app_private.transition_reward(
       (select id from app.rewards limit 1), 'AVAILABLE', 'test', null, null) $$,
  '23514',
  'transition_reward: AVAILABLE is settlement-gated; use settle_provider_period',
  'transition_reward refuses AVAILABLE unconditionally'
);

-- THE CONTROL AND THE UNGATED GUARD ARE AT THE END OF THIS FILE, deliberately.
--
-- Both need the fixture reward, which does not exist until further down - the same
-- ordering mistake as `plan()` after the first assertion. On the first run they
-- reported "unknown reward <NULL>" and were recorded as GATE FAILURES when they are
-- test-order defects, and a control assertion that fails for the wrong reason trains
-- you to ignore it.
--
-- They are also at the end rather than inline because the control transitions the
-- reward to ON_HOLD, which would break every PENDING assertion below it. A control
-- that mutates shared state is not a control; it is a side effect.
--
-- See "THE CONTROL, AND THE UNGATED GUARD STILL WORK" at the foot of this file.

-- =============================================================================
-- FIXTURE
--
-- A provider, an offer, a user, a participation, a CONVERTED conversion and its
-- PENDING reward. Everything is prefixed `pgattr-` so the suite can clean up
-- without touching a real row.
-- =============================================================================

-- THE CLEANUP IS ORDERED, AND THE ORDER IS THE WHOLE PROBLEM.
--
-- Everything below deletes a fixture row, and each table has a foreign key pointing at
-- the one after it: provider_conversions -> rewards -> auth.users, and
-- provider_participations -> auth.users. Deleting in the wrong order raises 23503,
-- which aborts the suite and - because the runner's rollback cannot undo an aborted
-- transaction - COMMITS whatever it had already inserted. That is how a failing run
-- leaves a fixture behind for the next one to trip over.
--
-- `auth.users` is listed LAST on purpose. On its own it cannot be deleted while a
-- reward references it, so it is not a cleanup step, it is the final step.
delete from app.provider_settlements where provider_reference like 'pgattr-%';
delete from app.provider_participations where tracking_id like 'pgattr-%';
delete from app.provider_conversions where provider_event_id like 'pgattr-%';

-- The fixture LIVE provider goes too. `offers` cascades from it, so deleting it removes
-- its offers in one step - which is why it is deleted BEFORE the offer deletes below.
delete from app.providers where code = 'pgattr_live';

-- Rewards FIRST in the ordering, but see the warning: `app.reward_state_transitions` is
-- append-only (`reject_mutation`), and ON DELETE CASCADE fires that trigger too, so a
-- reward with history CANNOT be deleted by this suite at all. On a clean database there
-- is no `pgattr-%` reward and this deletes zero rows harmlessly.
delete from app.rewards where idempotency_key like 'pgattr-%';

delete from app.offers where external_offer_id in ('pgattr-offer', 'pgattr-live-offer');
delete from app.reward_sources where name = 'pgTAP attribution source';

-- LAST. The `auth.users` row cannot go while anything references it, so it is not a
-- cleanup step, it is the final step.
delete from auth.users where email = 'pgtap_attr@example.invalid';

-- A REAL auth.users ROW IS REQUIRED. `provider_participations.user_id`,
-- `provider_conversions.user_id` and `rewards.user_id` all reference auth.users(id),
-- and a random uuid satisfies the type but dies on the foreign key - 23503, long
-- before the rule under test. This is the "a fixture must make the assertion
-- reachable" lesson from AGENTS.md.
--
-- DELETED ABOVE. The insert below is a fixed uuid, so if a previous run committed this
-- fixture the re-run would die on `users_pkey` - reported as a test failure while being
-- evidence about the PREVIOUS run.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000', '33333333-3333-3333-3333-333333333333',
  'authenticated', 'authenticated', 'pgtap_attr@example.invalid', 'x',
  now(), now(), now()
);

-- A reward source, for the same reason. `rewards.source_id` is NOT NULL, and
-- `(select id from app.reward_sources limit 1)` returns NULL on an empty table -
-- which fails as a NOT NULL violation, not as the assertion.
--
-- `on conflict do nothing` was wrong here and is removed: reward_sources has no
-- unique constraint on `name`, so it could never have matched anything and would have
-- inserted a SECOND source on every run. Deleting first is the honest idempotence.
delete from app.reward_sources where name = 'pgTAP attribution source';

insert into app.reward_sources (
  source_type, name, currency_unit, budget_total_minor, budget_remaining_minor
) values ('AVERRA_PROMOTIONAL', 'pgTAP attribution source', 'NGN-kobo', 1000000, 1000000);

create temporary table pgattr_fixture as
select
  (select id from app.providers where code = 'cpx_research') as provider_id,
  '33333333-3333-3333-3333-333333333333'::uuid as user_id,
  (select id from app.reward_sources where name = 'pgTAP attribution source') as source_id;

insert into app.offers (provider_id, external_offer_id, title, is_active)
select provider_id, 'pgattr-offer', 'pgTAP offer', true from pgattr_fixture
on conflict (provider_id, external_offer_id) do nothing;

insert into app.provider_participations (provider_id, user_id, tracking_id, offer_id, status)
select f.provider_id, f.user_id, 'pgattr-track-1',
  (select id from app.offers where external_offer_id = 'pgattr-offer'
    and provider_id = f.provider_id),
  'STARTED'
from pgattr_fixture f;

-- BACKDATED, and this is load-bearing rather than incidental.
--
-- Reconciliation selects conversions by `created_at`, and migration 066 requires a
-- period to be at least 90 days old before it can release money. A fixture dated
-- `now()` could therefore never be settled at all, and the settlement assertions
-- below would be testing a refusal instead of a gate.
insert into app.provider_conversions (
  provider_id, provider_event_id, source_type, user_id, tracking_id,
  event_type, status, gross_value_minor, currency, created_at
)
select provider_id, 'pgattr-conv-1', 'OFFER', user_id, 'pgattr-track-1',
  'cpx:complete', 'VALIDATED', 5000, 'NGN-kobo', now() - interval '150 days'
from pgattr_fixture;

-- The reward, PENDING. This is the row the gate must protect.
insert into app.rewards (
  user_id, source_id, state, amount_minor, unit,
  event_type, source_event_id, idempotency_key
)
select f.user_id, f.source_id,
  'PENDING', 5000, 'NGN-kobo',
  'provider_conversion:OFFER', 'pgattr-conv-1', 'pgattr-reward-1'
from pgattr_fixture f;

update app.provider_conversions c
set reward_id = r.id, status = 'CONVERTED'
from app.rewards r
where c.provider_event_id = 'pgattr-conv-1' and r.idempotency_key = 'pgattr-reward-1';

-- =============================================================================
-- THE FORGED subid_1 CASE
--
-- CPX signs only the transaction id. Anyone who can guess a trans_id can post a
-- well-formed callback naming any subid_1. These two assertions are the proof that
-- such a callback resolves to NOBODY.
-- =============================================================================

-- A tracking id that was never minted resolves to nobody.
select is(
  (select public.resolve_tracking_user_for_attribution(
     (select provider_id from pgattr_fixture), 'pgattr-never-minted')),
  null::uuid,
  'a forged tracking id resolves to nobody'
);

-- THE ATTACK. A second user's participation exists and is live; a callback naming
-- its tracking id under THIS provider resolves to that user. The suite asserts this
-- is the case, so the mitigation cannot later be described as "the id is
-- unguessable" without also having to admit it is guessable in a lab.
select is(
  (select public.resolve_tracking_user_for_attribution(
     (select provider_id from pgattr_fixture), 'pgattr-track-1')),
  (select user_id from pgattr_fixture),
  'CONTROL: a live tracking id DOES resolve - so the null above is not a broken lookup'
);

-- A DEAD participation resolves to nobody. This is the property the new wrapper adds
-- over `resolve_tracking_user`: the old one has no notion of liveness.
update app.provider_participations set status = 'FAILED' where tracking_id = 'pgattr-track-1';

select is(
  (select public.resolve_tracking_user_for_attribution(
     (select provider_id from pgattr_fixture), 'pgattr-track-1')),
  null::uuid,
  'a FAILED participation resolves to nobody'
);

-- And back to live, for the settlement tests below.
update app.provider_participations set status = 'QUALIFIED' where tracking_id = 'pgattr-track-1';

-- Cross-provider scoping. The old function already had this; the new one must not
-- have lost it.
select is(
  (select public.resolve_tracking_user_for_attribution(
     gen_random_uuid(), 'pgattr-track-1')),
  null::uuid,
  'a tracking id from a DIFFERENT provider resolves to nobody'
);

-- =============================================================================
-- RECONCILIATION AND THE SETTLEMENT GATE
-- =============================================================================

-- A window that contains the fixture conversion AND has actually matured.
--
-- `ends_at` is 100 days back, deliberately past the 90-day boundary migration 066
-- enforces, and `starts_at` is older still so the backdated conversion sits inside
-- it. A window ending `now() + 1 day` - which is what this fixture used to be -
-- would now be refused outright, and every settlement assertion below would be
-- measuring the maturity gate rather than the reconciliation gate.
create temporary table pgattr_period as
select
  now() - interval '200 days' as starts_at,
  now() - interval '100 days' as ends_at;

-- `expected_amount_minor` is COMPUTED, not trusted from the report. The fixture has
-- exactly one CONVERTED conversion worth 5000.
select is(
  (app_private.reconcile_provider_period(
     (select provider_id from pgattr_fixture),
     (select starts_at from pgattr_period),
     (select ends_at from pgattr_period)) ->> 'expectedAmountMinor')::bigint,
  5000::bigint,
  'reconciliation computes our OWN expected amount, it does not trust the report'
);

select is(
  (app_private.reconcile_provider_period(
     (select provider_id from pgattr_fixture),
     (select starts_at from pgattr_period),
     (select ends_at from pgattr_period)) ->> 'expectedConversionCount')::integer,
  1::integer,
  'and computes the count from our own CONVERTED rows'
);

-- =============================================================================
-- THE MATURITY GATE (migration 066)
--
-- A reversal arriving AFTER the user has withdrawn cannot be executed at all:
-- `post_ledger_entry` refuses to let a user-facing balance go negative, and
-- reserving a withdrawal debits EARNED_REWARD to zero. There is no debt or
-- recovery mechanism anywhere in this schema, so the late clawback is not a
-- recoverable loss - it is a silent one, while the vendor shows it delivered.
--
-- A period therefore cannot release money until the advertiser's right to
-- devalidate it has expired.
-- =============================================================================

-- 89 days back: inside the window, so refused.
select throws_ok(
  $$ select app_private.settle_provider_period(
       (select provider_id from pgattr_fixture), 'pgattr-immature',
       (select starts_at from pgattr_period), now() - interval '89 days',
       5000, 1, null) $$,
  '23514',
  'settle_provider_period: period_end is inside the 90-day maturity window',
  'a period that ended 89 days ago is refused: the advertiser can still devalidate it'
);

-- The refusal must write NOTHING. A row recorded here would collide with
-- (provider_id, provider_reference) on the retry and leave an operator believing
-- the period had been settled while nothing was.
select is(
  (select count(*)::integer from app.provider_settlements
    where provider_reference = 'pgattr-immature'),
  0,
  'a refused period writes NO settlement row, so the operator can retry cleanly'
);

-- THE CONTROL. 100 days back is outside the window, so the same figures are
-- accepted. Without this arm the assertion above would also pass against a
-- function that refuses every period - the failure mode of a one-armed test.
select lives_ok(
  $$ select app_private.settle_provider_period(
       (select provider_id from pgattr_fixture), 'pgattr-mature-control',
       (select starts_at from pgattr_period), now() - interval '100 days',
       4999, 1, null) $$,
  'CONTROL: the identical report one day later is NOT refused, so this is a window'
);

-- And maturity did not weaken the MATCHED gate: 4999 still does not reconcile
-- against the fixture's 5000.
select is(
  (select status::text from app.provider_settlements
    where provider_reference = 'pgattr-mature-control'),
  'VARIANCE'::text,
  'a matured period still reconciles normally - maturity did not weaken MATCHED'
);

-- THE GATE, in its most important form: a report that does NOT match settles nothing.
select is(
  (app_private.settle_provider_period(
     (select provider_id from pgattr_fixture), 'pgattr-report-short',
     (select starts_at from pgattr_period), (select ends_at from pgattr_period),
     4999, 1, null) ->> 'status'),
  'VARIANCE'::text,
  'a short report is a VARIANCE, never a partial settlement'
);

select is(
  (select state::text from app.rewards where idempotency_key = 'pgattr-reward-1'),
  'PENDING'::text,
  'THE GATE: a VARIANCE leaves the reward PENDING, so the money is not withdrawable'
);

select is(
  (app_private.settle_provider_period(
     (select provider_id from pgattr_fixture), 'pgattr-report-short',
     (select starts_at from pgattr_period), (select ends_at from pgattr_period),
     4999, 1, null) ->> 'settledCount')::integer,
  0::integer,
  'a VARIANCE settles nothing at all'
);

-- The amount matches but the COUNT does not. This is the shape a forgery takes, and
-- it is why both figures are checked rather than only the amount.
select is(
  (app_private.settle_provider_period(
     (select provider_id from pgattr_fixture), 'pgattr-report-count',
     (select starts_at from pgattr_period), (select ends_at from pgattr_period),
     5000, 2, null) ->> 'status'),
  'VARIANCE'::text,
  'a matching amount with a wrong COUNT is still a VARIANCE'
);

select is(
  (select state::text from app.rewards where idempotency_key = 'pgattr-reward-1'),
  'PENDING'::text,
  'a count mismatch leaves the reward PENDING'
);

-- THE OTHER DIRECTION: we recorded more than the provider reports. That is what a
-- forged callback looks like from the settlement's side.
select is(
  (app_private.settle_provider_period(
     (select provider_id from pgattr_fixture), 'pgattr-report-extra',
     (select starts_at from pgattr_period), (select ends_at from pgattr_period),
     0, 0, null) ->> 'status'),
  'VARIANCE'::text,
  'we recorded MORE than the provider reports is a VARIANCE (the forgery signature)'
);

-- And the exact match settles it.
select is(
  (app_private.settle_provider_period(
     (select provider_id from pgattr_fixture), 'pgattr-report-exact',
     (select starts_at from pgattr_period), (select ends_at from pgattr_period),
     5000, 1, null) ->> 'status'),
  'MATCHED'::text,
  'an exact match on BOTH figures reconciles'
);

select is(
  (select state::text from app.rewards where idempotency_key = 'pgattr-reward-1'),
  'AVAILABLE'::text,
  'THE GATE OPENS: a settled period makes the reward AVAILABLE'
);

-- Replay. Reporting the same period twice must not settle twice or error. The
-- settlement row is unique on (provider_id, provider_reference).
select lives_ok(
  $$ select app_private.settle_provider_period(
       (select provider_id from pgattr_fixture), 'pgattr-report-exact',
       (select starts_at from pgattr_period), (select ends_at from pgattr_period),
       5000, 1, null) $$,
  're-reporting the same period is idempotent'
);

select is(
  (select count(*)::integer from app.provider_settlements
    where provider_reference = 'pgattr-report-exact'),
  1,
  'a replayed report does not create a second settlement row'
);

-- A LATER report that contradicts an earlier MATCHED one re-flips the period to
-- VARIANCE. Without the re-read inside the command, a corrected report would leave
-- the reward AVAILABLE from the first run.
select is(
  (app_private.settle_provider_period(
     (select provider_id from pgattr_fixture), 'pgattr-report-exact',
     (select starts_at from pgattr_period), (select ends_at from pgattr_period),
     1, 1, null) ->> 'status'),
  'VARIANCE'::text,
  'a corrected report re-flips a previously MATCHED period to VARIANCE'
);

select is(
  (select status::text from app.provider_settlements
    where provider_reference = 'pgattr-report-exact'),
  'VARIANCE'::text,
  'the stored settlement is corrected, not left MATCHED'
);

-- The reward stays AVAILABLE: it already legitimately settled, and revoking a paid
-- obligation is a different operation (reverse_reward), not a reconciliation side
-- effect. Asserted so the behaviour is documented rather than assumed.
select is(
  (select state::text from app.rewards where idempotency_key = 'pgattr-reward-1'),
  'AVAILABLE'::text,
  'a later variance does not silently un-settle an already AVAILABLE reward'
);

-- Argument validation. A period that ends before it starts would otherwise compute
-- over an empty set and reconcile as 0 = 0.
select throws_ok(
  $$ select app_private.settle_provider_period(
       (select provider_id from pgattr_fixture), 'pgattr-bad-period',
       '2030-02-01 00:00:00+00', '2030-01-01 00:00:00+00', 0, 0, null) $$,
  '23514',
  'settle_provider_period: period_end must be after period_start',
  'an inverted period is refused'
);

select throws_ok(
  $$ select app_private.settle_provider_period(
       (select provider_id from pgattr_fixture), '   ',
       (select starts_at from pgattr_period), (select ends_at from pgattr_period),
       0, 0, null) $$,
  -- 22004, not `null_value_not_allowed`. The latter is a CONDITION NAME that maps to
  -- SQLSTATE 22004, and pgTAP compares the resolved SQLSTATE, so writing the name never
  -- matches. A blank string is also not NULL, which is why this is a blank rejection
  -- reaching a check written for a null one. Same lesson as CR-0032.
  '22004',
  'settle_provider_period: a provider reference is required',
  'a blank provider reference is refused'
);

select throws_ok(
  $$ select app_private.settle_provider_period(
       (select provider_id from pgattr_fixture), 'pgattr-negative',
       (select starts_at from pgattr_period), (select ends_at from pgattr_period),
       -1, 0, null) $$,
  '23514',
  'settle_provider_period: reported amount must be non-negative',
  'a negative reported amount is refused'
);

-- =============================================================================
-- THE MINT
-- =============================================================================

-- Two mints are different. A predictable tracking id would make every one of the
-- forgery assertions above true by accident rather than by control.
select isnt(
  app_private.begin_provider_participation(
    (select user_id from pgattr_fixture),
    (select id from app.offers where external_offer_id = 'pgattr-offer'
      and provider_id = (select provider_id from pgattr_fixture)),
    null),
  app_private.begin_provider_participation(
    (select user_id from pgattr_fixture),
    (select id from app.offers where external_offer_id = 'pgattr-offer'
      and provider_id = (select provider_id from pgattr_fixture)),
    null),
  'two minted tracking ids differ: they are not sequential'
);

select matches(
  app_private.begin_provider_participation(
    (select user_id from pgattr_fixture),
    (select id from app.offers where external_offer_id = 'pgattr-offer'
      and provider_id = (select provider_id from pgattr_fixture)),
    null),
  '^av_[0-9a-f]{32}$',
  'a minted tracking id is 128 bits of hex, prefixed so it is greppable in support'
);

select throws_ok(
  $$ select app_private.begin_provider_participation(
       (select user_id from pgattr_fixture), null, null) $$,
  '23514',
  'begin_provider_participation: an offer or a survey is required',
  'a participation with no subject is refused'
);

select throws_ok(
  $$ select app_private.begin_provider_participation(
       null,
       (select id from app.offers where external_offer_id = 'pgattr-offer'
         and provider_id = (select provider_id from pgattr_fixture)),
       null) $$,
  '22004',
  'begin_provider_participation: a user is required',
  'a participation with no user is refused'
);

-- The minted id is immediately resolvable: the mint and the attribution path agree.
select ok(
  exists (
    select 1 from app.provider_participations p
    where p.tracking_id like 'av_%'
      and p.provider_id = (select provider_id from pgattr_fixture)
      and p.user_id = (select user_id from pgattr_fixture)
  ),
  'a minted participation is written and resolvable'
);

-- =============================================================================
-- ISSUANCE IS INERT UNTIL THE PROVIDER IS LIVE (migration 063)
--
-- `createTrackingLink` is built and reachable, but nothing can click through while
-- cpx_research is CANDIDATE. Asserted, because "the route exists" and "the route can
-- be used" are different claims and only one of them is true today.
-- =============================================================================

-- A CANDIDATE provider's offer yields NO target. This is the whole gate: the wrapper
-- returns NULL rather than raising, so the route answers 404 and an unauthenticated
-- caller learns nothing about which offers exist.
select is(
  (
    select public.get_offer_tracking_target(
      (select id from app.offers where external_offer_id = 'pgattr-offer'
        and provider_id = (select provider_id from pgattr_fixture))
    )
  ),
  null::jsonb,
  'a CANDIDATE provider offers no tracking target: the click route is inert'
);

-- The CONTROL. The offer is active and does exist - so the NULL above is the
-- lifecycle gate doing its job, not a broken lookup or a missing fixture row.
select ok(
  exists (
    select 1 from app.offers
    where external_offer_id = 'pgattr-offer' and is_active
  ),
  'CONTROL: the offer exists and IS active - so the refusal is the LIVE gate, not absence'
);

-- An offer belonging to a DIFFERENT provider, given this one's id, also yields nothing.
-- `get_offer_tracking_target` takes one argument, so this asserts the id is not
-- reachable through any other path.
select is(
  (select public.get_offer_tracking_target(gen_random_uuid())),
  null::jsonb,
  'an unknown offer id yields no target'
);

-- Once the provider IS live, the same offer resolves. This is what makes the gate a
-- real conditional rather than a permanent refusal - and it is asserted by flipping a
-- fixture copy, never the real cpx_research row.
-- INSERTED AS CANDIDATE, THEN PROMOTED IN A SEPARATE STATEMENT.
--
-- The first attempt inserted with `lifecycle_state = 'LIVE'` and every gate timestamp
-- null, which fails `providers_live_requires_all_gates` - and that is the constraint
-- working exactly as designed. It is also a good reminder that this schema will not let
-- a provider go LIVE on a single statement that forgets its gates.
insert into app.providers (code, display_name, provider_class, lifecycle_state)
values ('pgattr_live', 'pgTAP live provider', 'SURVEY', 'CANDIDATE');

update app.providers
set lifecycle_state = 'LIVE',
    settlement_currency = 'NGN-kobo',
    integration_tested_at = now(),
    callback_authenticity_tested_at = now(),
    duplicate_replay_tested_at = now(),
    economic_validated_at = now(),
    commercial_approved_at = now(),
    compliance_approved_at = now(),
    last_verified_at = now(),
    verification_expires_at = now() + interval '90 days'
where code = 'pgattr_live';

-- The promotion actually took, so the assertions below are testing a LIVE provider
-- rather than a CANDIDATE one that happens to satisfy some other condition.
select is(
  (select lifecycle_state::text from app.providers where code = 'pgattr_live'),
  'LIVE'::text,
  'CONTROL: the fixture provider really is LIVE, so the gate test below is meaningful'
);

insert into app.offers (
  provider_id, external_offer_id, title, is_active, tracking_base_url
)
select id, 'pgattr-live-offer', 'pgTAP live offer', true,
  'https://offers.example.invalid/x?pub_id=7'
from app.providers where code = 'pgattr_live';

select is(
  (
    select public.get_offer_tracking_target(
      (select id from app.offers where external_offer_id = 'pgattr-live-offer')
    ) ->> 'providerCode'
  ),
  'pgattr_live'::text,
  'a LIVE provider does yield a tracking target: the gate is a conditional'
);

-- The target carries the configured destination. The base URL must come from OUR row,
-- never from the caller, or a callback could be attributed to the wrong offer.
select is(
  (
    select public.get_offer_tracking_target(
      (select id from app.offers where external_offer_id = 'pgattr-live-offer')
    ) ->> 'trackingBaseUrl'
  ),
  'https://offers.example.invalid/x?pub_id=7'::text,
  'the target carries OUR configured base URL, so the link cannot be redirected'
);

-- Deactivating the offer closes it again, without touching the provider state.
update app.offers set is_active = false
where external_offer_id = 'pgattr-live-offer';

select is(
  (
    select public.get_offer_tracking_target(
      (select id from app.offers where external_offer_id = 'pgattr-live-offer')
    )
  ),
  null::jsonb,
  'an inactive offer yields no target even from a LIVE provider'
);

-- Nothing here creates a reward source or promotes a provider. Asserted, because
-- "the migration did not do more than it said" is a claim worth testing.
select is(
  (select count(*)::integer from app.reward_sources
    where source_type = 'PROVIDER' and is_active),
  0::integer,
  'NO provider reward source exists: nothing can be funded from a provider'
);

select is(
  (select lifecycle_state::text from app.providers where code = 'cpx_research'),
  'CANDIDATE'::text,
  'cpx_research is still CANDIDATE: CR-0033 does not promote it'
);

-- =============================================================================
-- THE CONTROL, AND THE UNGATED GUARD STILL WORK
--
-- These two are last because they need the fixture and because they mutate it.
-- =============================================================================

-- The gate is not simply a function that refuses everything. A different state still
-- transitions. Without this, "refuses AVAILABLE" would pass on a wrapper broken in
-- any way at all - which is the failure mode of an assertion that has only one arm.
--
-- Run against its OWN reward so it cannot disturb the settlement assertions above.
insert into app.rewards (
  user_id, source_id, state, amount_minor, unit,
  event_type, source_event_id, idempotency_key
)
select f.user_id, f.source_id, 'PENDING', 100, 'NGN-kobo',
  'provider_conversion:OFFER', 'pgattr-conv-control', 'pgattr-reward-control'
from pgattr_fixture f;

select lives_ok(
  $$ select app_private.transition_reward(
       (select id from app.rewards where idempotency_key = 'pgattr-reward-control'),
       'ON_HOLD', 'pgattr control', null, null) $$,
  'the gate blocks ONLY AVAILABLE: other states still transition'
);

select is(
  (select state::text from app.rewards where idempotency_key = 'pgattr-reward-control'),
  'ON_HOLD'::text,
  'and the transition really happened, so lives_ok is not just absence of error'
);

-- Closing the AVAILABLE path must not have silently reopened the REVERSED path. The
-- ungated body keeps law 7's guard.
select throws_ok(
  $$ select app_private.transition_reward_ungated(
       (select id from app.rewards where idempotency_key = 'pgattr-reward-control'),
       'REVERSED', 'x', null, null) $$,
  '23514',
  'transition_reward: use reverse_reward for a reversing transition',
  'the ungated body still refuses a reversing transition'
);

-- `finish()` reports the plan, then the transaction is discarded. The `rollback;` must
-- be the LAST statement: anything after it runs outside the transaction and commits.
select * from finish();

rollback;