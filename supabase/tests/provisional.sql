-- =============================================================================
-- PROVISIONAL PROVIDER EARNINGS: THE READ-ONLY, NON-PAYABLE PROJECTION.
--
-- Migration 064 adds `public.get_provisional_earnings`, so a user can see that a
-- real CPX callback was attributed to them while CPX is still CANDIDATE and no
-- money can move.
--
-- The dangerous property is not that it works. It is that it READS money-shaped
-- numbers, so three ways it could be wrong are financial defects, not cosmetics:
--
--   1. DOUBLE-COUNTING. `reward_id is null` is the only thing standing between
--      this projection and the real payable path. The moment a conversion becomes
--      a reward it must vanish, or the user sees the same money twice.
--
--   2. SHOWING A CLAWBACK AS STILL PENDING. `apply_provider_reversal` returns
--      EARLY at migration 057 line 337 when the original has no reward, and in
--      that path NOTHING updates the original's status. Every CPX conversion has
--      reward_id null, so a reversed conversion still reads `VALIDATED` forever.
--      `status <> 'REVERSED'` is therefore NOT a working filter here, and the
--      suite asserts the reverses_conversion_id LINK so a future "simplification"
--      back to the status check is caught.
--
--   3. REACHABLE BY `anon`. A function in `public` is born executable by anyone
--      holding the publishable key. Q-22 was a live breach of exactly this.
--
-- It is ALSO asserted not to touch money: ledger and outbox counts are taken
-- around the reads, because a "read" that quietly writes is the worst outcome.
--
-- Fixture rows only: `pgtmp_` provider codes, `pgtmp-%` event ids, one fixture
-- auth user. The deployed `cpx_research` row is never touched or promoted.
--
-- Suite mechanics (AGENTS.md): `begin;` precedes `plan()`, the suite deletes its
-- own prefix before creating anything, and `rollback;` is the final statement.
-- =============================================================================

begin;

select plan(33);

-- Defensive cleanup, in FK order. On a clean database every statement matches
-- zero rows; a non-zero match means a previous run aborted and committed its
-- fixture, which is itself worth failing loudly on.
delete from app.provider_conversions where provider_event_id like 'pgtmp-%';
delete from app.rewards where source_event_id like 'pgtmp-%';
delete from app.reward_sources where name like 'pgtmp%';
delete from app.providers where code like 'pgtmp_%';
delete from auth.users where id = 'ffffffff-ffff-4fff-8fff-fffffffffffe';

-- =============================================================================
-- FIXTURES
-- =============================================================================

insert into auth.users (id, email) values
  ('ffffffff-ffff-4fff-8fff-fffffffffffe', 'pgtmp-provisional@example.invalid');

-- A CANDIDATE provider, the state CPX is actually in today. This is the only
-- provider whose conversions may appear in the projection.
insert into app.providers (code, display_name, provider_class, lifecycle_state)
values ('pgtmp_cand', 'Provisional Candidate', 'SURVEY', 'CANDIDATE');

-- A LIVE provider. Its conversions have entered the real reward path and must be
-- excluded even though the conversion row itself looks identical.
--
-- Doc 07's `providers_live_requires_all_gates` constraint makes LIVE mean all
-- seven verification timestamps set, so the fixture satisfies it rather than
-- bypassing it. A test that reached LIVE by disabling a constraint would be
-- asserting behaviour no real provider can ever have.
insert into app.providers (
  code, display_name, provider_class, lifecycle_state,
  integration_tested_at, callback_authenticity_tested_at,
  duplicate_replay_tested_at, economic_validated_at,
  commercial_approved_at, compliance_approved_at,
  last_verified_at, verification_expires_at
)
values (
  'pgtmp_live', 'Provisional Live', 'SURVEY', 'LIVE',
  now(), now(), now(), now(), now(), now(),
  now(), now() + interval '30 days'
);

-- Five conversions on the CANDIDATE provider, all with reward_id null.
--   pgtmp-a  NGN  250000  VALIDATED   -> must appear
--   pgtmp-b  NGN  100000  RECEIVED    -> must appear (not yet validated)
--   pgtmp-c  USD   1500   VALIDATED   -> must appear, under USD, never merged
--   pgtmp-d  NGN  999999  VALIDATED   -> EXCLUDED: a reversal points at it
--   pgtmp-e  NGN  888888  VALIDATED   -> EXCLUDED: it already carries a reward
insert into app.provider_conversions (
  provider_id, provider_event_id, source_type, user_id, event_type, status,
  gross_value_minor, currency
)
select p.id, v.event_id, 'SURVEY', 'ffffffff-ffff-4fff-8fff-fffffffffffe'::uuid,
  'SURVEY', v.status::app.conversion_status, v.amount, v.currency
from app.providers p
cross join (values
  ('pgtmp-a', 'VALIDATED', 250000::bigint, 'NGN'::text),
  ('pgtmp-b', 'RECEIVED',  100000::bigint, 'NGN'::text),
  ('pgtmp-c', 'VALIDATED',   1500::bigint, 'USD'::text),
  ('pgtmp-d', 'VALIDATED', 999999::bigint, 'NGN'::text),
  ('pgtmp-e', 'VALIDATED', 888888::bigint, 'NGN'::text)
) as v(event_id, status, amount, currency)
where p.code = 'pgtmp_cand';

-- pgtmp-e carries a reward, so it belongs to the payable path and must drop out
-- of the projection.
--
-- The reward row must be CREATED, not merely referenced. An UPDATE that matched
-- nothing would leave reward_id null, pgtmp-e would still be counted, and the
-- "already rewarded conversions are excluded" assertion would pass for entirely
-- the wrong reason. This is the AGENTS.md fixture rule: an assertion that cannot
-- fail is worse than a missing one.
--
-- The funding source is created too, because `rewards.source_id` is NOT NULL and
-- references one. No real source is reused, so nothing decrements a live budget.
insert into app.reward_sources (
  source_type, name, currency_unit, budget_total_minor, budget_remaining_minor, is_active
) values (
  'PROVIDER', 'pgtmp-source', 'NGN', 0, 0, false
);

insert into app.rewards (
  user_id, source_id, state, amount_minor, unit, event_type,
  source_event_id, gross_value_minor, idempotency_key
)
select
  'ffffffff-ffff-4fff-8fff-fffffffffffe'::uuid,
  (select rs.id from app.reward_sources rs where rs.name = 'pgtmp-source'),
  'PENDING', 888888, 'NGN', 'PROVIDER_CONVERSION',
  'pgtmp-e', 888888, 'pgtmp-reward-e'
;

update app.provider_conversions c
set reward_id = r.id,
    -- `provider_conversions_reward_only_when_converted` requires this. The
    -- constraint is doing its job: a conversion only carries a reward once it has
    -- been converted, so the fixture has to move through that state rather than
    -- shortcut it.
    status = 'CONVERTED'
from app.rewards r
where c.provider_event_id = 'pgtmp-e'
  and r.source_event_id = 'pgtmp-e';

-- Prove the UPDATE actually did something, so the assertions downstream cannot
-- pass because the fixture silently failed to build its own premise.
select ok(
  exists (select 1 from app.provider_conversions where provider_event_id = 'pgtmp-e'
          and reward_id is not null),
  'the rewarded conversion really does carry a reward_id'
);

-- A reversal pointing at pgtmp-d. Per CR-0032 the reversal is its OWN row and
-- inherits no user, which is why it is invisible in its own right and why
-- pgtmp-d must be excluded by the LINK.
insert into app.provider_conversions (
  provider_id, provider_event_id, source_type, user_id, event_type, status,
  reverses_conversion_id
)
select p.id, 'pgtmp-rev', 'SURVEY', null, 'REVERSAL', 'REVERSED', c.id
from app.providers p
join app.provider_conversions c on c.provider_event_id = 'pgtmp-d'
where p.code = 'pgtmp_cand';

-- One conversion on the LIVE provider, identical in every respect except the
-- provider. It must never appear.
insert into app.provider_conversions (
  provider_id, provider_event_id, source_type, user_id, event_type, status,
  gross_value_minor, currency
)
select p.id, 'pgtmp-live', 'SURVEY', 'ffffffff-ffff-4fff-8fff-fffffffffffe'::uuid,
  'SURVEY', 'VALIDATED', 777777, 'NGN'
from app.providers p
where p.code = 'pgtmp_live';

-- Baselines for the "a read is not a write" deltas below. Taken AFTER the
-- fixtures, so only the projection's own behaviour is measured.
create temporary table pgtmp_baseline as
select
  (select count(*)::int from app.ledger_entries) as ledger_before,
  (select count(*)::int from app.outbox_events) as outbox_before;

-- =============================================================================
-- 1. THE FUNCTION EXISTS AND RETURNS A SINGLE JSONB VALUE
-- =============================================================================

select has_function(
  'public', 'get_provisional_earnings', array['uuid'],
  'migration 064 exposes the provisional read as a named public function'
);

select is(
  pg_get_function_result('public.get_provisional_earnings(uuid)'::regprocedure),
  'jsonb',
  'it returns a single jsonb value rather than a set of rows'
);

-- =============================================================================
-- 2. REACHABILITY. Q-22 happened because this was missing.
-- =============================================================================

-- The roles are asserted to EXIST first. A `revoke ... from anon` against a role
-- that no longer exists passes silently, which would make every assertion below
-- vacuous. `postgres` and `supabase_admin` are deliberately excluded: they own
-- these objects and bypass ACL regardless of rolsuper, so asserting otherwise
-- would be asserting something PostgreSQL does not promise.
select ok(
  exists (select 1 from pg_roles where rolname = 'anon'),
  'the anon role exists, so the revoke assertions below are meaningful'
);

select ok(
  exists (select 1 from pg_roles where rolname = 'authenticated'),
  'the authenticated role exists, so the revoke assertions below are meaningful'
);

select ok(
  exists (select 1 from pg_roles where rolname = 'service_role'),
  'the service_role exists, so the grant assertion below is meaningful'
);

select ok(
  not has_function_privilege('anon', 'public.get_provisional_earnings(uuid)', 'EXECUTE'),
  'anon cannot execute the provisional read (Q-22 regression)'
);

select ok(
  not has_function_privilege('authenticated', 'public.get_provisional_earnings(uuid)', 'EXECUTE'),
  'authenticated cannot execute the provisional read (Q-22 regression)'
);

select ok(
  has_function_privilege('service_role', 'public.get_provisional_earnings(uuid)', 'EXECUTE'),
  'service_role CAN execute it, because the server route is the only caller'
);

-- Enumerate the population, then filter. The AGENTS.md rule: a security check
-- that filters before counting reports `0 bad` whether or not it matched
-- anything.
select is(
  (
    select count(*)::int from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'get_provisional_earnings'
  ),
  1,
  'exactly one get_provisional_earnings signature exists, so the ACL checks above test one function'
);

-- =============================================================================
-- 3. WHAT APPEARS
-- =============================================================================

select is(
  jsonb_array_length(
    public.get_provisional_earnings('ffffffff-ffff-4fff-8fff-fffffffffffe')->'byCurrency'
  )::int,
  2,
  'two currency groups: NGN and USD, never one merged bucket'
);

select is(
  public.get_provisional_earnings('ffffffff-ffff-4fff-8fff-fffffffffffe')->'byCurrency' -> 0 ->> 'unit',
  'NGN',
  'the first group is NGN (results are ordered by unit)'
);

select is(
  public.get_provisional_earnings('ffffffff-ffff-4fff-8fff-fffffffffffe')->'byCurrency' -> 0 ->> 'totalMinor',
  '350000',
  'NGN total is 250000 + 100000; the reversed and rewarded conversions are excluded'
);

select is(
  public.get_provisional_earnings('ffffffff-ffff-4fff-8fff-fffffffffffe')->'byCurrency' -> 0 ->> 'eventCount',
  '2',
  'NGN counts two qualifying conversions'
);

select is(
  public.get_provisional_earnings('ffffffff-ffff-4fff-8fff-fffffffffffe')->'byCurrency' -> 1 ->> 'unit',
  'USD',
  'the second group is USD'
);

select is(
  public.get_provisional_earnings('ffffffff-ffff-4fff-8fff-fffffffffffe')->'byCurrency' -> 1 ->> 'totalMinor',
  '1500',
  'USD stays in its own group at its own amount'
);

-- The headline invariant: there is NO cross-currency total anywhere in the
-- payload. 350000 + 1500 = 351500, and if any field carried it, the projection
-- would have invented a number corresponding to no real amount.
select ok(
  public.get_provisional_earnings('ffffffff-ffff-4fff-8fff-fffffffffffe')::text not like '%351500%',
  'no cross-currency total is present anywhere in the payload'
);

-- =============================================================================
-- 4. WHAT MUST NOT APPEAR. Each is a financial defect, not cosmetics.
-- =============================================================================

-- THE CLAWBACK CASE. pgtmp-d still reads VALIDATED because the reversal early
-- returned, so a status-based filter would show 999999 as still-pending. This is
-- the assertion that makes the NOT EXISTS filter non-negotiable.
select ok(
  not exists (
    select 1 from jsonb_array_elements(
      public.get_provisional_earnings('ffffffff-ffff-4fff-8fff-fffffffffffe')->'byCurrency'
    ) g
    where (g->>'totalMinor')::bigint >= 999999
  ),
  'a reversed conversion is excluded even though its own status still reads VALIDATED'
);

-- Prove the premise of that assertion, so it cannot pass merely because the
-- fixture failed to build the condition it claims to test.
select is(
  (select c.status::text from app.provider_conversions c where c.provider_event_id = 'pgtmp-d'),
  'VALIDATED',
  'the reversed original really does still read VALIDATED, which is why the link is the only filter'
);

select ok(
  exists (
    select 1 from app.provider_conversions c
    where c.provider_event_id = 'pgtmp-d'
      and exists (select 1 from app.provider_conversions r where r.reverses_conversion_id = c.id)
  ),
  'and a reversal really does point at it'
);

-- THE DOUBLE-COUNT CASE. pgtmp-e has a reward, so it is in the payable path and
-- must not also appear as an estimate.
select ok(
  not exists (
    select 1 from jsonb_array_elements(
      public.get_provisional_earnings('ffffffff-ffff-4fff-8fff-fffffffffffe')->'byCurrency'
    ) g
    where (g->>'totalMinor')::bigint >= 888888
  ),
  'a conversion that already carries a reward is excluded from the projection'
);

-- THE LIVE-PROVIDER CASE. pgtmp-live is 777777 on a LIVE provider.
select ok(
  not exists (
    select 1 from jsonb_array_elements(
      public.get_provisional_earnings('ffffffff-ffff-4fff-8fff-fffffffffffe')->'byCurrency'
    ) g
    where (g->>'totalMinor')::bigint >= 777777
  ),
  'a LIVE provider conversion is excluded; the scope is lifecycle_state, not the provider code'
);

-- The reversal row itself inherits no user, so it can never be attributed to
-- anyone. Asserted because "it has no user_id" is the reason, not the filter.
select ok(
  not exists (
    select 1 from app.provider_conversions
    where provider_event_id = 'pgtmp-rev' and user_id is not null
  ),
  'the reversal row inherits no user, so it cannot be shown as anyone''s earning'
);

-- =============================================================================
-- 5. THE RECENT LIST
-- =============================================================================

select is(
  jsonb_array_length(
    public.get_provisional_earnings('ffffffff-ffff-4fff-8fff-fffffffffffe')->'recent'
  )::int,
  3,
  'the recent list holds the three qualifying conversions'
);

select is(
  public.get_provisional_earnings('ffffffff-ffff-4fff-8fff-fffffffffffe')->'recent' -> 0 ->> 'providerCode',
  'pgtmp_cand',
  'a recent item names its provider'
);

-- The wording rule: the payload exposes the provider-reported status verbatim
-- and adds no field that claims payability. There is deliberately no
-- `payable`, `confirmed` or `settled` key.
select ok(
  not exists (
    select 1
    from jsonb_array_elements(
      public.get_provisional_earnings('ffffffff-ffff-4fff-8fff-fffffffffffe')->'recent'
    ) item,
    lateral jsonb_object_keys(item) as k(k)
    where k.k in ('payable', 'confirmed', 'settled', 'availableMinor', 'rewardId')
  ),
  'no recent item claims to be payable, confirmed or settled'
);

-- The payload exposes no total-shaped key that could be mistaken for a balance.
select ok(
  not exists (
    select 1 from jsonb_object_keys(
      public.get_provisional_earnings('ffffffff-ffff-4fff-8fff-fffffffffffe')
    ) as k(k)
    where k.k in ('totalMinor', 'total', 'availableMinor', 'grandTotal')
  ),
  'the payload exposes no total-shaped key that could be mistaken for a balance'
);

-- =============================================================================
-- 6. A READ IS NOT A WRITE
-- =============================================================================

-- The failure mode that matters most: a "read" that quietly posts money.
--
-- Counts are taken BEFORE and AFTER and compared as a DELTA. An absolute
-- `is(count, 0)` would fail on a database that already holds events - and it
-- failed here with `have: 13`, because this project has real data in it. A
-- financial read is only meaningfully "clean" if it moves nothing, and a delta
-- measures exactly that while being immune to whatever else is in the table.
select is(
  (select count(*)::int from app.ledger_entries),
  (select ledger_before from pgtmp_baseline),
  'reading the projection posts no ledger entry'
);

select is(
  (select count(*)::int from app.outbox_events),
  (select outbox_before from pgtmp_baseline),
  'reading the projection enqueues no outbox event'
);

-- =============================================================================
-- 7. SCOPE ENFORCEMENT
-- =============================================================================

-- A user with no conversions reads as EMPTY, never as another user's figures and
-- never as an error.
select is(
  public.get_provisional_earnings('ffffffff-ffff-4fff-8fff-ffffffffffed')->'byCurrency'::text,
  '[]',
  'an unrelated user reads as empty rather than forbidden'
);

select is(
  jsonb_array_length(
    public.get_provisional_earnings('ffffffff-ffff-4fff-8fff-ffffffffffed')->'recent'
  )::int,
  0,
  'and gets an empty recent list'
);

-- A null user id returns a well-formed EMPTY projection rather than raising.
--
-- The assertion states what the function ACTUALLY does. `jsonb_build_object`
-- with a null input returns a non-null object, so the payload is present and its
-- lists are empty - which is the safe outcome: a caller that mishandles the id
-- sees nothing rather than another user's figures, and nothing is invented.
select is(
  public.get_provisional_earnings(null)->'byCurrency'::text,
  '[]',
  'a null user id yields an empty currency list rather than raising'
);

select is(
  jsonb_array_length(public.get_provisional_earnings(null)->'recent')::int,
  0,
  'and an empty recent list'
);

-- select * from finish() rather than a bare inish(). A bare call parses as a
-- column reference and raises a syntax error, because finish is a FUNCTION in the
-- pgtap schema and not a keyword. Every other suite in this directory does it
-- this way, and the runner reports the error as a suite-level failure, so the
-- one-word difference is the whole difference between green and red.
select * from finish();

rollback;
