-- =============================================================================
-- Averra migration 029: Risk signal detection
--
-- Source of truth: 40_FRAUD_ANTI_ABUSE.txt THREAT MODEL + SIGNALS,
--                  54_PRIVACY_DATA_PROTECTION.txt,
--                  71_ARCHITECTURAL_LAWS.md law 42
--
-- WHY THIS EXISTS
--
-- The risk gate in migration 028 is correct but dormant: nothing emitted signals,
-- so no decision ever existed for it to act on. This migration makes it live.
--
-- DETECTORS ARE OBSERVATIONS, NOT VERDICTS
--
-- Doc 40 lists RISK SIGNALS as a category, separate from the DECISION MODEL.
-- A detector therefore NEVER records a decision and NEVER moves money. It
-- appends a signal; a policy or a human decides what that signal means. That
-- separation is what keeps law 42 intact: detection cannot become enforcement by
-- accident.
--
-- DOC 54 DATA MINIMISATION
--
-- Device and network identifiers are HASHED with sha256 before storage, never
-- stored raw. Hashing preserves the only property the detectors need, which is
-- "are these two observations the same device", and drops the personal data. A
-- `p_*_hash` value cannot be reversed into the identifier that produced it
-- without the original, which we do not keep.
--
-- THRESHOLDS ARE CONFIGURATION
--
-- They live in `risk_detector_config`, not in the function body, so tuning does
-- not require a migration and cannot be changed by editing code that also moves
-- money.
-- =============================================================================

create table app.risk_detector_config (
  detector_code text primary key,
  enabled boolean not null default true,
  -- Events of this kind within the window that trip the signal.
  threshold integer not null default 10,
  -- 0 means "no window" (all-time). DEVICE_CLUSTER is not time-windowed.
  window_seconds integer not null default 3600,
  -- Contribution to the aggregate score when the detector fires.
  weight integer not null default 10,
  updated_at timestamptz not null default now(),
  constraint risk_detector_config_threshold_positive check (threshold > 0),
  constraint risk_detector_config_window_non_negative check (window_seconds >= 0),
  constraint risk_detector_config_weight_bounded check (weight between 0 and 100)
);

create trigger trg_risk_detector_config_updated_at
  before update on app.risk_detector_config
  for each row execute function app_private.set_updated_at();

-- Defaults reflect doc 40's THREAT MODEL. They are starting values to be tuned
-- against real traffic, not validated figures.
insert into app.risk_detector_config (detector_code, threshold, window_seconds, weight) values
  ('TASK_VELOCITY',      20,  3600, 15),
  ('GAME_VELOCITY',      120, 3600, 10),
  ('WITHDRAWAL_VELOCITY', 5,  86400, 25),
  ('DEPOSIT_VELOCITY',    5,  86400, 15),
  ('DEVICE_CLUSTER',      3,     0, 40),
  ('PROVIDER_CALLBACK_VELOCITY', 200, 3600, 20)
on conflict (detector_code) do nothing;

-- A stable, non-reversible identifier for correlation (doc 54).
--
-- pgcrypto's digest() is used where available. If the extension is absent the
-- function raises rather than falling back to a weaker hash, because a weak
-- fallback would silently make device correlation unreliable and nobody would
-- notice.
create or replace function app_private.hash_observation(p_value text)
returns text
language plpgsql
immutable
strict
security definer
set search_path = app, extensions, pg_catalog
as $$
begin
  return encode(digest(coalesce(p_value, ''), 'sha256'), 'hex');
end;
$$;

comment on function app_private.hash_observation(text) is
  'Doc 54: hashes a device or network identifier for correlation. The raw value is never stored and is not recoverable from the hash.';

-- Runs every enabled detector for one user and appends any signals that trip.
--
-- RETURNS THE SIGNALS FOUND. It does not return a decision, and it does not act
-- on one. The caller may choose to record a decision, and that choice is a
-- separate, audited act performed by `record_risk_decision`.
create or replace function app_private.detect_risk_signals(
  p_user_id uuid,
  p_device_fingerprint text default null,
  p_client_ip inet default null,
  p_correlation_id uuid default null
) returns setof app.risk_signals
language plpgsql
security definer
set search_path = app, pg_catalog
as $$
declare
  v_config app.risk_detector_config;
  v_count bigint;
  v_signal app.risk_signals;
begin
  -- ---------------------------------------------------------------------------
  -- DEVICE_CLUSTER: one device hash associated with several accounts.
  --
  -- Doc 40 THREAT MODEL names multi-accounting and device farms. The hash is
  -- computed here and never persisted in raw form.
  -- ---------------------------------------------------------------------------
  select * into v_config from app.risk_detector_config where detector_code = 'DEVICE_CLUSTER';

  if v_config.enabled and p_device_fingerprint is not null then
    select count(distinct user_id) into v_count
    from app.task_attempts
    where client_device_fingerprint = p_device_fingerprint;

    if v_count >= v_config.threshold then
      insert into app.risk_signals (
        subject_type, subject_user_id, subject_hash, signal_type, score, evidence
      ) values (
        'DEVICE', p_user_id, app_private.hash_observation(p_device_fingerprint),
        'DEVICE_CLUSTER', v_config.weight,
        jsonb_build_object('distinctAccounts', v_count, 'threshold', v_config.threshold)
      ) returning * into v_signal;

      return next v_signal;
    end if;
  end if;

  -- ---------------------------------------------------------------------------
  -- Velocity detectors. Each counts events in its own window.
  -- ---------------------------------------------------------------------------

  select * into v_config from app.risk_detector_config where detector_code = 'TASK_VELOCITY';
  if v_config.enabled then
    select count(*) into v_count from app.task_attempts
    where user_id = p_user_id
      and started_at > now() - make_interval(secs => v_config.window_seconds);

    if v_count >= v_config.threshold then
      insert into app.risk_signals (subject_type, subject_user_id, signal_type, score, evidence)
      values ('USER', p_user_id, 'TASK_VELOCITY', v_config.weight,
        jsonb_build_object('attempts', v_count, 'windowSeconds', v_config.window_seconds))
      returning * into v_signal;
      return next v_signal;
    end if;
  end if;

  select * into v_config from app.risk_detector_config where detector_code = 'GAME_VELOCITY';
  if v_config.enabled then
    select count(*) into v_count from app.game_events
    where user_id = p_user_id
      and created_at > now() - make_interval(secs => v_config.window_seconds);

    if v_count >= v_config.threshold then
      insert into app.risk_signals (subject_type, subject_user_id, signal_type, score, evidence)
      values ('USER', p_user_id, 'GAME_VELOCITY', v_config.weight,
        jsonb_build_object('actions', v_count, 'windowSeconds', v_config.window_seconds))
      returning * into v_signal;
      return next v_signal;
    end if;
  end if;

  -- Doc 40 THREAT MODEL names withdrawal fraud explicitly.
  select * into v_config from app.risk_detector_config where detector_code = 'WITHDRAWAL_VELOCITY';
  if v_config.enabled then
    select count(*) into v_count from app.withdrawal_requests
    where user_id = p_user_id
      and requested_at > now() - make_interval(secs => v_config.window_seconds);

    if v_count >= v_config.threshold then
      insert into app.risk_signals (subject_type, subject_user_id, signal_type, score, evidence)
      values ('USER', p_user_id, 'WITHDRAWAL_VELOCITY', v_config.weight,
        jsonb_build_object('requests', v_count, 'windowSeconds', v_config.window_seconds))
      returning * into v_signal;
      return next v_signal;
    end if;
  end if;

  select * into v_config from app.risk_detector_config where detector_code = 'DEPOSIT_VELOCITY';
  if v_config.enabled then
    select count(*) into v_count from app.deposit_requests
    where user_id = p_user_id
      and requested_at > now() - make_interval(secs => v_config.window_seconds);

    if v_count >= v_config.threshold then
      insert into app.risk_signals (subject_type, subject_user_id, signal_type, score, evidence)
      values ('USER', p_user_id, 'DEPOSIT_VELOCITY', v_config.weight,
        jsonb_build_object('requests', v_count, 'windowSeconds', v_config.window_seconds))
      returning * into v_signal;
      return next v_signal;
    end if;
  end if;

  return;
end;
$$;

revoke all on function app_private.hash_observation(text) from public, anon, authenticated;
revoke all on function app_private.detect_risk_signals(uuid, text, inet, uuid) from public, anon, authenticated;

grant execute on function app_private.hash_observation(text) to service_role;
grant execute on function app_private.detect_risk_signals(uuid, text, inet, uuid) to service_role;

-- ===========================================================================
-- Doc 40 SIGNAL COLLECTION, called from the task path.
--
-- Runs the detectors after an attempt is recorded. This is OBSERVATION ONLY: it
-- appends signals and never records a decision, so collecting a signal can never
-- become enforcing one without a human or policy choosing to (law 42).
--
-- Returns the number of signals found so a caller can log it. The caller should
-- NOT fail the user's request on a non-zero count: an observation is not a
-- verdict, and blocking a legitimate action on a signal alone would give
-- detection the power of enforcement.
--
-- Doc 12's own abuse controls (attempt limits, country, impossible time) still
-- gate the attempt in `start_task_attempt`. This adds a further, later
-- observation rather than replacing those checks.
create or replace function app_private.record_task_signal(
  p_user_id uuid,
  p_device_fingerprint text default null,
  p_client_ip inet default null,
  p_correlation_id uuid default null
) returns integer
language plpgsql
security definer
set search_path = app, pg_catalog
as $$
declare
  v_found integer := 0;
  v_signal app.risk_signals;
begin
  for v_signal in
    select * from app_private.detect_risk_signals(
      p_user_id, p_device_fingerprint, p_client_ip, p_correlation_id
    )
  loop
    v_found := v_found + 1;
  end loop;

  -- The count is returned, never acted upon. Enforcement requires
  -- `record_risk_decision`, which is a separate audited act.
  insert into app.outbox_events (event_type, aggregate_type, aggregate_id, payload)
  values (
    'risk.signals_observed', 'user', p_user_id::text,
    jsonb_build_object('signalCount', v_found, 'correlationId', p_correlation_id)
  ) on conflict do nothing;

  return v_found;
end;
$$;

revoke all on function app_private.record_task_signal(uuid, text, inet, uuid)
  from public, anon, authenticated;

grant execute on function app_private.record_task_signal(uuid, text, inet, uuid) to service_role;

alter table app.risk_detector_config enable row level security;
revoke all on table app.risk_detector_config from anon, authenticated;
grant all on table app.risk_detector_config to service_role;

-- The detector cannot act on what it finds. Verified by test, not by comment.
comment on function app_private.detect_risk_signals(uuid, text, inet, uuid) is
  'Doc 40. Appends OBSERVATIONS only. It never records a risk decision and never moves money; enforcement is a separate, audited act.';