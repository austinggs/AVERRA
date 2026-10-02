-- =============================================================================
-- pgTAP: provider ecosystem invariants
--
-- Spec: 06_PROVIDER_ECOSYSTEM.txt, 07_PROVIDER_ELIGIBILITY_MATRIX.txt,
--       08_PROVIDER_INTEGRATION.txt, 13_OFFERWALL_SYSTEM.txt,
--       71_ARCHITECTURAL_LAWS.md laws 4/5/12/25
-- =============================================================================

begin;

select plan(18);

select has_table('app', 'providers', 'providers table exists');
select has_table('app', 'provider_callbacks', 'raw callback evidence exists');
select has_table('app', 'provider_callback_results', 'callback outcomes exist');
select has_table('app', 'provider_conversions', 'conversions table exists');
select has_table('app', 'provider_participations', 'participations exist');

-- ---------------------------------------------------------------------------
-- DOC 07 DECISION GATES, enforced structurally.
--
-- The central test: a provider cannot be flipped to LIVE without every gate
-- recorded. This turns an operational checklist into a database invariant, so a
-- single UPDATE that forgets one of them fails.
-- ---------------------------------------------------------------------------
select throws_ok(
  $$
    update app.providers
    set lifecycle_state = 'LIVE'
    where code = 'cpx_research'
  $$,
  '23514',
  'new row for relation "providers" violates check constraint "providers_live_requires_all_gates"',
  'a provider cannot be marked LIVE without every doc 07 decision gate recorded'
);

select results_eq(
  $$
    select count(*) from app.providers where lifecycle_state = 'LIVE'
  $$,
  $$ values (0::bigint) $$,
  'no provider is live; none has passed the doc 07 gates'
);

-- Every seeded candidate is a CANDIDATE with no approvals. Seeding a vendor
-- name is not an endorsement and not an integration.
select results_eq(
  $$
    select count(*) from app.providers
    where lifecycle_state <> 'CANDIDATE'
       or commercial_approved_at is not null
       or compliance_approved_at is not null
       or integration_tested_at is not null
  $$,
  $$ values (0::bigint) $$,
  'every seeded provider is a CANDIDATE with no recorded approval'
);

-- Doc 07 REQUIRED COLUMNS exist as real columns, not prose.
select results_eq(
  $$
    select count(*) from information_schema.columns
    where table_schema = 'app' and table_name = 'providers'
      and column_name in (
        'nigeria_available','incentive_policy_verified_at','commercial_approved_at',
        'compliance_approved_at','integration_owner','last_verified_at',
        'verification_expires_at','integration_tested_at',
        'callback_authenticity_tested_at','duplicate_replay_tested_at',
        'economic_validated_at','signature_scheme','settlement_currency','payout_rail'
      )
  $$,
  $$ values (14::bigint) $$,
  'every doc 07 required column is present on the providers table'
);

-- ---------------------------------------------------------------------------
-- LAW 5: one provider event, one conversion. This is what makes a replayed
-- callback harmless.
-- ---------------------------------------------------------------------------
select has_index(
  'app', 'provider_conversions', 'uq_provider_conversions_event',
  'a unique index prevents one provider event producing two conversions'
);

select results_eq(
  $$
    select count(*) from pg_indexes
    where schemaname = 'app'
      and indexname = 'uq_provider_conversions_event'
      and indexdef like '%provider_id, provider_event_id%'
  $$,
  $$ values (1::bigint) $$,
  'conversion uniqueness is scoped per provider, not globally'
);

-- ---------------------------------------------------------------------------
-- LAW 4: raw evidence is retained and is append-only.
-- ---------------------------------------------------------------------------
select results_eq(
  $$
    select count(*) from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'app'
      and c.relname in ('provider_callbacks','provider_callback_results')
      and t.tgname in ('trg_provider_callbacks_immutable','trg_provider_callback_results_immutable')
  $$,
  $$ values (2::bigint) $$,
  'callback evidence and its outcome are both append-only'
);

select results_eq(
  $$
    select count(*) from pg_policies
    where schemaname = 'app'
      and tablename in ('provider_callbacks','provider_conversions','provider_participations')
  $$,
  $$ values (0::bigint) $$,
  'no permissive RLS policy exposes provider callbacks or conversions'
);

select results_eq(
  $$
    select count(*) from pg_tables
    where schemaname = 'app'
      and tablename in (
        'providers','provider_capabilities','provider_callbacks','provider_callback_results',
        'provider_conversions','provider_settlements','offers','surveys','provider_participations'
      )
      and rowsecurity is not true
  $$,
  $$ values (0::bigint) $$,
  'row level security is enabled on every provider table'
);

-- ---------------------------------------------------------------------------
-- Doc 08 FINANCIAL BOUNDARY: a callback cannot write the wallet directly. The
-- bridge is a function in app_private, not something a caller may invoke.
-- ---------------------------------------------------------------------------
select results_eq(
  $$
    select count(*) from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app_private'
      and p.proname in ('apply_conversion_reward','reverse_conversion')
      and (has_function_privilege('anon', p.oid, 'EXECUTE')
           or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  $$,
  $$ values (0::bigint) $$,
  'no browser-facing role can convert a provider event into a reward'
);

-- A tracking id is unique per provider, so one attribution id cannot be reused
-- across two participations (doc 13 TRACKING).
select has_index(
  'app', 'provider_participations', 'provider_participations_tracking_unique',
  'a tracking id is unique per provider'
);

select is(
  (select array_agg(e.enumlabel order by e.enumsortorder)::text
   from pg_enum e
   join pg_type t on t.oid = e.enumtypid
   join pg_namespace n on n.oid = t.typnamespace
   where n.nspname = 'app' and t.typname = 'provider_state'),
  '{CANDIDATE,APPLIED,APPROVED,INTEGRATION_TESTING,LIVE,SUSPENDED,RETIRED,REJECTED}',
  'provider lifecycle matches the doc 06 list, with REJECTED as a non-live outcome'
);

select results_eq(
  $$
    select count(*) from app.providers where code !~ '^[a-z0-9_]{2,64}$'
  $$,
  $$ values (0::bigint) $$,
  'every provider code is a safe slug suitable for use in a callback URL'
);

select * from finish();
rollback;