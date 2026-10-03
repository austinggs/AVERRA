-- =============================================================================
-- Averra migration 050: Referral qualification engine (V1)
--
-- Spec: 39_REFERRAL_SYSTEM.txt (QUALIFICATION, REWARD HANDLING, ANTI-ABUSE),
--       the V1 referral proposal, 71_ARCHITECTURAL_LAWS.md laws 6, 8, 10 and 56.
--
-- WHAT THIS CLOSES
--
-- `attribute_referral`, `qualify_referral` and `reward_referral` all existed and
-- none was ever called, so every referral sat at ATTRIBUTED forever. This wires
-- qualification to the platform's own transaction records, which is what the brief
-- demanded: "use AVERRA's existing transaction/payment system as the source of
-- truth. Do not create a separate client-controlled qualifying activity mechanism."
--
-- THE FORMULA, VERBATIM FROM THE V1 PROPOSAL
--
--   eligible qualification amount
--     = confirmed deposits + eligible perk purchases - withdrawals
--
-- Written as a SIGNED contribution ledger rather than a running counter, for one
-- reason: the brief also requires that a refunded or reversed transaction not keep
-- counting, and that a duplicate event not count twice. An append-only ledger with
-- one row per source event answers both, where a bare counter answers neither.
--
-- DUPLICATE EVENTS CANNOT DOUBLE COUNT
--
--   constraint unique (source_type, source_id)
--
-- A retried deposit confirmation, a replayed outbox event, or a transaction that
-- somehow fires the trigger twice, is refused by the constraint rather than by a
-- conditional in application code. The guarantee is structural.
--
-- DECLARED IS NOT VERIFIED
--
-- Deposits contribute `verified_amount_minor`, NEVER `declared_amount_minor`. A
-- user who declares ₦500,000 and sends ₦1,000 contributes ₦1,000. Counting the
-- declared figure would make the whole scheme a self-asserted form.
--
-- WITHDRAWALS DEDUCT
--
-- The architecture already prevents the deposit-then-withdraw harvest: only
-- EARNED_REWARD is withdrawable (migration 007) and User Funding Balance is not.
-- The deduction is implemented because the brief asks for it, and because a user
-- withdrawing money out of the platform is a conservative signal that they are not
-- the customer this programme is looking for. Cost control, not a security boundary.
--
-- LAW 10 - NO REWARD WITHOUT A FUNDING SOURCE
--
-- This migration creates NO `reward_sources` row and no budget. `grant_reward`
-- refuses to pay without a live funded source, which is correct and is why
-- `reward_referral` has never succeeded. Seeding one means committing real money,
-- which is a funding decision for the owner. Qualification is therefore automatic;
-- the reward step stays an explicit action until a budget exists.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- referral_qualifying_events: the signed contribution ledger
-- -----------------------------------------------------------------------------
create table app.referral_qualifying_events (
  id uuid primary key default gen_random_uuid(),
  referral_id uuid not null references app.referrals(id) on delete cascade,

  source_type text not null,
  -- The originating record: a deposit_requests id, a funding_spend_events id, or a
  -- withdrawal_requests id. Opaque here on purpose - these are four different
  -- tables and a polymorphic reference cannot be a foreign key.
  source_id uuid not null,

  -- SIGNED. Positive credits the referral, negative deducts.
  amount_minor bigint not null,
  unit text not null,
  created_at timestamptz not null default now(),

  -- THE DUPLICATE-EVENT GUARD. One source record contributes at most once, ever.
  constraint referral_qualifying_events_unique_source unique (source_type, source_id),
  constraint referral_qualifying_events_source_check check (
    source_type in ('DEPOSIT_CONFIRMED','PERK_PURCHASE','WITHDRAWAL_DEDUCTION')
  ),
  constraint referral_qualifying_events_amount_nonzero check (amount_minor <> 0)
);

comment on table app.referral_qualifying_events is
  'Signed contributions toward referral qualification (doc 39). Append-only. The unique (source_type, source_id) is what makes a replayed event harmless.';

-- The net, maintained so the threshold check is one indexed read rather than an
-- aggregate over the whole ledger.
alter table app.referrals add column qualified_value_minor bigint not null default 0;

create index idx_referral_qualifying_events_referral
  on app.referral_qualifying_events(referral_id);

alter table app.referral_qualifying_events enable row level security;
revoke all on table app.referral_qualifying_events from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- The V1 economics, as configuration
-- -----------------------------------------------------------------------------
-- Seeded here rather than in a later migration so the defaults and the engine that
-- reads them land together. ₦5,000 and ₦500 in kobo.
insert into app.system_config (key, value, description) values
  ('qualification_threshold_minor', '500000',
   'Cumulative eligible transaction value, in minor units, at which a referral qualifies. Doc 39 QUALIFICATION.'),
  ('referral_reward_minor', '50000',
   'Fixed referral reward in minor units. A fixed amount, not a percentage of the referred user''s activity.'),
  ('referral_qualifying_unit', 'NGN',
   'Unit the threshold and reward are denominated in. Amounts in another unit are ignored rather than converted.')
on conflict (key) do nothing;

-- `maximum_rewards_per_referrer` is deliberately NOT seeded. Absent means unlimited,
-- and an absent key already reads as the caller''s default. Seeding a cap nobody has
-- decided on would be inventing a fraud-control policy.

-- -----------------------------------------------------------------------------
-- system_config_bigint: a typed reader, so a threshold is never parsed twice
-- -----------------------------------------------------------------------------
-- Text config parsed in two places drifts. This is the only reader for a minor-unit
-- amount, and it refuses nonsense rather than returning 0, because a threshold of 0
-- would qualify every referral immediately.
create or replace function app_private.system_config_bigint(
  p_key text,
  p_default bigint default 0
)
returns bigint
language plpgsql
stable
security definer
set search_path = app, pg_catalog
as $$
declare
  v_value text;
  v_parsed bigint;
begin
  select c.value into v_value from app.system_config c where c.key = p_key;

  if v_value is null or btrim(v_value) = '' then
    return p_default;
  end if;

  begin
    v_parsed := btrim(v_value)::bigint;
  exception when others then
    -- A malformed threshold is a configuration error, not a zero threshold.
    raise exception 'system_config_bigint: % is not an integer', p_key
      using errcode = 'check_violation';
  end;

  return v_parsed;
end;
$$;

revoke all on function app_private.system_config_bigint(text, bigint) from public, anon, authenticated;
grant execute on function app_private.system_config_bigint(text, bigint) to service_role;

-- Sibling of system_config_bool, for a plain text value. One reader per type, so a
-- config key is never interpreted two different ways in two different places.
create or replace function app_private.system_config_value(
  p_key text,
  p_default text default null
)
returns text
language plpgsql
stable
security definer
set search_path = app, pg_catalog
as $$
declare
  v_value text;
begin
  select c.value into v_value from app.system_config c where c.key = p_key;

  if v_value is null or btrim(v_value) = '' then
    return p_default;
  end if;

  return btrim(v_value);
end;
$$;

revoke all on function app_private.system_config_value(text, text) from public, anon, authenticated;
grant execute on function app_private.system_config_value(text, text) to service_role;

-- -----------------------------------------------------------------------------
-- record_referral_qualifying_event: the ONE writer, called by all three triggers
-- -----------------------------------------------------------------------------
-- A single code path is the point. Three triggers each carrying their own copy of
-- the threshold logic is how they diverge, and a referral that qualifies for a
-- deposit but not for a perk purchase would be unexplainable to a user.
create or replace function app_private.record_referral_qualifying_event(
  p_user_id uuid,
  p_source_type text,
  p_source_id uuid,
  p_amount_minor bigint,
  p_unit text
)
returns app.referrals
language plpgsql
security definer
set search_path = app, pg_catalog
as $$
declare
  v_referral app.referrals;
  v_unit text;
  v_threshold bigint;
  v_net bigint;
begin
  -- Most users have no referral at all. That is the common case, not an error, and
  -- it must not cost a write or an exception on every deposit.
  if p_amount_minor is null or p_amount_minor = 0 then
    return null;
  end if;

  select r.* into v_referral
  from app.referrals r
  where r.referee_user_id = p_user_id
    and r.status in ('ATTRIBUTED','QUALIFIED')
  order by r.created_at
  limit 1;

  if not found then
    return null;
  end if;

  v_unit := app_private.system_config_value('referral_qualifying_unit', p_unit);

  -- Units are never converted. A threshold in NGN is not met by an amount in USD,
  -- and silently converting would be inventing an exchange rate.
  if p_unit is distinct from v_unit then
    return v_referral;
  end if;

  insert into app.referral_qualifying_events (
    referral_id, source_type, source_id, amount_minor, unit
  ) values (
    v_referral.id, p_source_type, p_source_id, p_amount_minor, p_unit
  )
  on conflict (source_type, source_id) do nothing;

  -- Recomputed from the ledger rather than incremented, so a replayed event and a
  -- manual repair cannot drift the running total away from the truth.
  select coalesce(sum(e.amount_minor), 0)::bigint into v_net
  from app.referral_qualifying_events e
  where e.referral_id = v_referral.id;

  update app.referrals set qualified_value_minor = v_net where id = v_referral.id;
  v_referral.qualified_value_minor := v_net;

  v_threshold := app_private.system_config_bigint('qualification_threshold_minor', 0);

  -- Doc 39: reward requires configured qualifying behaviour and CANNOT be triggered
  -- by account creation. Reaching the threshold here is what makes it earnable.
  if v_referral.status = 'ATTRIBUTED' and v_threshold > 0 and v_net >= v_threshold then
    return app_private.qualify_referral(
      v_referral.id,
      p_source_id,
      v_net,
      null
    );
  end if;

  return v_referral;
end;
$$;

revoke all on function app_private.record_referral_qualifying_event(uuid, text, uuid, bigint, text) from public, anon, authenticated;
grant execute on function app_private.record_referral_qualifying_event(uuid, text, uuid, bigint, text) to service_role;

-- -----------------------------------------------------------------------------
-- The three source triggers
-- -----------------------------------------------------------------------------
-- Each is AFTER UPDATE/INSERT and guarded by a WHEN clause, so it fires on the
-- transition into the successful state and NOT on every subsequent update. A
-- deposit that is re-verified twice must not contribute twice.

-- 1. DEPOSIT_CONFIRMED.
--
-- Counts `verified_amount_minor`, NEVER `declared_amount_minor`: a user who declares
-- ₦500,000 and sends ₦1,000 contributes ₦1,000. There is no `verified_unit` column on
-- `deposit_requests` - the unit recorded is the declared one, and the verified amount
-- is measured in it.
create or replace function app_private.on_deposit_qualifies_referral()
returns trigger
language plpgsql
security definer
set search_path = search_path, public, pg_temp
as $$
begin
  perform app_private.record_referral_qualifying_event(
    new.user_id,
    'DEPOSIT_CONFIRMED',
    new.id,
    -- NULL when a deposit is confirmed with nothing verified contributes nothing
    -- rather than a zero row.
    coalesce(new.verified_amount_minor, 0),
    new.declared_unit
  );

  return new;
end;
$$;

revoke all on function app_private.on_deposit_qualifies_referral() from public, anon, authenticated;

drop trigger if exists trg_deposit_qualifies_referral on app.deposit_requests;

create trigger trg_deposit_qualifies_referral
  after update on app.deposit_requests
  for each row
  when (new.status = 'CONFIRMED' and old.status is distinct from 'CONFIRMED')
  execute function app_private.on_deposit_qualifies_referral();

-- 2. PERK_PURCHASE. A `funding_spend_events` row only exists when money actually
--    moved, so no status guard is needed - the row IS the successful event.
create or replace function app_private.on_perk_purchase_qualifies_referral()
returns trigger
language plpgsql
security definer
set search_path = search_path, public, pg_temp
as $$
begin
  if new.purpose = 'PERK_PURCHASE' then
    perform app_private.record_referral_qualifying_event(
      new.user_id,
      'PERK_PURCHASE',
      new.id,
      new.amount_minor,
      new.unit
    );
  end if;

  return new;
end;
$$;

revoke all on function app_private.on_perk_purchase_qualifies_referral() from public, anon, authenticated;

drop trigger if exists trg_perk_purchase_qualifies_referral on app.funding_spend_events;

create trigger trg_perk_purchase_qualifies_referral
  after insert on app.funding_spend_events
  for each row execute function app_private.on_perk_purchase_qualifies_referral();

-- 3. WITHDRAWAL_DEDUCTION. NEGATIVE. `COMPLETED` is the terminal success state;
--    FAILED and REJECTED never reach it and contribute nothing.
--
-- `net_amount_minor` and not `gross_amount_minor`: the 15% fee is money Averra
-- retained rather than money the user took out, so deducting gross would
-- over-penalise the referred user.
--
-- The explanation lives here rather than inside the argument list on purpose. A
-- comment containing a comma, placed between arguments, defeats any checker that
-- splits a call on commas - which is exactly what `check:migrations` did, reporting
-- this call as eight arguments when it has five.
create or replace function app_private.on_withdrawal_reduces_referral()
returns trigger
language plpgsql
security definer
set search_path = search_path, public, pg_temp
as $$
begin
  perform app_private.record_referral_qualifying_event(
    new.user_id,
    'WITHDRAWAL_DEDUCTION',
    new.id,
    (0 - new.net_amount_minor),
    new.unit
  );

  return new;
end;
$$;

revoke all on function app_private.on_withdrawal_reduces_referral() from public, anon, authenticated;

drop trigger if exists trg_withdrawal_reduces_referral on app.withdrawal_requests;

create trigger trg_withdrawal_reduces_referral
  after update on app.withdrawal_requests
  for each row
  when (new.status = 'COMPLETED' and old.status is distinct from 'COMPLETED')
  execute function app_private.on_withdrawal_reduces_referral();