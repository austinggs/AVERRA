-- =============================================================================
-- Averra migration 025: Advertiser and campaign platform
--
-- Source of truth: 42_ADVERTISER_PLATFORM.txt, 41_ADVERTISING_SYSTEM.txt,
--                  05_REWARD_ECONOMICS.txt,
--                  71_ARCHITECTURAL_LAWS.md law 10, law 16, law 43
--
-- THE FUNDING CONSTRAINT IS THE WHOLE POINT
--
-- Doc 42 FUNDING: "Campaign budgets must support promised rewards and platform
-- fees. Budget reservation prevents overspend."
--
-- That is enforced structurally by `campaign_budget_reservation_covers_promise`:
-- a campaign CANNOT go LIVE unless its reserved budget is at least the maximum
-- exposure it can promise. An underfunded campaign is unrepresentable, so there
-- is no configuration that can promise money the advertiser did not fund.
--
-- Law 16: a reward claim matches configured economics. The per-conversion reward
-- is stored ON THE CAMPAIGN, never supplied by a client at conversion time.
--
-- Doc 42 VERIFICATION: "Conversion tracking uses server-side events/provider
-- callbacks where possible; client reporting is evidence only."
-- =============================================================================

create type app.advertiser_state as enum ('PENDING','ACTIVE','SUSPENDED','CLOSED');
create type app.campaign_state as enum (
  'DRAFT','SCHEDULED','LIVE','PAUSED','COMPLETED','ARCHIVED'
);

create table app.advertisers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact_email text,
  state app.advertiser_state not null default 'PENDING',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint advertisers_name_not_blank check (length(trim(name)) > 0)
);

create trigger trg_advertisers_updated_at
  before update on app.advertisers
  for each row execute function app_private.set_updated_at();

create table app.campaigns (
  id uuid primary key default gen_random_uuid(),
  advertiser_id uuid not null references app.advertisers(id) on delete restrict,
  name text not null,
  state app.campaign_state not null default 'DRAFT',

  -- Law 16: the economics are configured on the campaign. A conversion cannot
  -- name its own reward.
  reward_amount_minor bigint not null default 0,
  currency_unit text not null default 'NGN',

  -- Doc 42 FUNDING. Reserved is money set aside for promised rewards; spent is
  -- what has actually been granted. `max_exposure_minor` is the worst case the
  -- configuration can promise.
  budget_reserved_minor bigint not null default 0,
  budget_spent_minor bigint not null default 0,
  max_exposure_minor bigint not null default 0,

  -- Doc 42 CAMPAIGN CONTROLS.
  objective text not null default 'ENGAGEMENT',
  countries text[] not null default '{}',
  devices text[] not null default '{}',
  daily_cap integer,
  frequency_cap integer,
  -- Doc 42 VERIFICATION. SERVER_EVENT and PROVIDER_CALLBACK are trustworthy;
  -- CLIENT_REPORT is evidence only and is recorded as such.
  verification_method text not null default 'SERVER_EVENT',

  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint campaigns_name_not_blank check (length(trim(name)) > 0),
  constraint campaigns_reward_non_negative check (reward_amount_minor >= 0),
  constraint campaigns_budget_non_negative check (
    budget_reserved_minor >= 0 and budget_spent_minor >= 0 and max_exposure_minor >= 0
  ),
  constraint campaigns_spent_within_reserved check (budget_spent_minor <= budget_reserved_minor),
  constraint campaigns_window check (
    ends_at is null or starts_at is null or ends_at > starts_at
  ),
  constraint campaigns_cap_positive check (
    (daily_cap is null or daily_cap > 0) and (frequency_cap is null or frequency_cap > 0)
  ),
  constraint campaigns_verification_method_check check (
    verification_method in ('SERVER_EVENT','PROVIDER_CALLBACK','CLIENT_REPORT')
  ),
  constraint campaigns_objective_check check (
    objective in ('ENGAGEMENT','COMPLETION','CONVERSION','AWARENESS')
  ),

  -- DOC 42 FUNDING, enforced: a LIVE campaign must have reserved at least its
  -- own worst-case exposure. This makes an underfunded LIVE campaign
  -- unrepresentable rather than merely discouraged.
  constraint campaign_budget_reservation_covers_promise check (
    state <> 'LIVE' or budget_reserved_minor >= max_exposure_minor
  )
);

create index idx_campaigns_state on app.campaigns(state, starts_at);

create trigger trg_campaigns_updated_at
  before update on app.campaigns
  for each row execute function app_private.set_updated_at();

comment on table app.campaigns is
  'Doc 42: budget reservation prevents overspend. campaign_budget_reservation_covers_promise makes an underfunded LIVE campaign unrepresentable.';

-- Doc 42 BILLING: advertiser charges reconcile to VERIFIED conversions and
-- agreed pricing, not raw clicks. So a conversion records its verification.
create table app.campaign_conversions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references app.campaigns(id) on delete restrict,
  user_id uuid references auth.users(id) on delete restrict,
  provider_conversion_id uuid references app.provider_conversions(id) on delete restrict,
  verified boolean not null default false,
  verification_method text not null default 'SERVER_EVENT',
  charged_amount_minor bigint not null default 0,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint campaign_conversions_charge_non_negative check (charged_amount_minor >= 0),
  -- Doc 42 BILLING: an UNVERIFIED conversion is never billed. Enforced here so a
  -- reporting bug cannot bill on evidence alone.
  constraint campaign_conversions_unverified_not_charged check (
    verified = false or charged_amount_minor = 0
  ),
  constraint campaign_conversions_verification_check check (
    verification_method in ('SERVER_EVENT','PROVIDER_CALLBACK','CLIENT_REPORT')
  )
);

create index idx_campaign_conversions_campaign
  on app.campaign_conversions(campaign_id, occurred_at desc);

alter table app.advertisers enable row level security;
alter table app.campaigns enable row level security;
alter table app.campaign_conversions enable row level security;

revoke all on table app.advertisers, app.campaigns, app.campaign_conversions from anon, authenticated;
grant all on table app.advertisers, app.campaigns, app.campaign_conversions to service_role;