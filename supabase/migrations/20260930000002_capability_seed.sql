-- =============================================================================
-- Averra migration 002: Capability and role seed
--
-- Source of truth: 43_ADMIN_PLATFORM.txt (CANONICAL CAPABILITY MATRIX),
--                  87_ADMIN_PORTAL_EXPANDED.md, 56_FINANCIAL_CONTROLS.txt,
--                  docs/adr/0002-capability-and-role-model.md
--
-- Capabilities are the authorization primitive. Roles are named bundles. The
-- codes below are the ones server guards, RLS and the admin UI must reference.
-- Seed data lives in a migration (not a script) so configuration is versioned
-- and reproducible, as doc 81 requires.
-- =============================================================================

insert into app.admin_capabilities (code, description) values
  ('deposit.view',              'View deposit requests, evidence and verification results'),
  ('deposit.verify',            'Verify on-chain evidence and prepare a deposit review case'),
  ('deposit.approve',           'Confirm, reject or route a deposit to NEEDS_REVIEW'),
  ('deposit.reconcile',         'Reconcile deposits against chain evidence and ledger records'),

  ('withdrawal.view',           'View withdrawal requests and their state'),
  ('withdrawal.review',         'Perform the risk and eligibility review of a withdrawal'),
  ('withdrawal.approve',        'Approve or reject a withdrawal request'),
  ('withdrawal.settle',         'Record settlement of a withdrawal payment operation'),
  ('withdrawal.reconcile',      'Reconcile withdrawal settlement against ledger and bank records'),

  ('payout.execute',            'Perform an approved manual payout and record evidence'),
  ('payout.destination.verify', 'Verify a MiniPay payout destination for operational control'),

  ('ledger.adjust.request',     'Request an administrative ledger adjustment'),
  ('ledger.adjust.approve',     'Approve an administrative ledger adjustment (never self-approval)'),
  ('fee.config.write',          'Change the Platform Service and Maintenance Fee configuration'),

  ('user.view',                 'View user records and activity'),
  ('user.restrict',             'Restrict a user account or feature access'),
  ('account.status.write',      'Change account status'),

  ('fraud.review',              'Review fraud and risk signals'),
  ('fraud.decide',              'Issue a fraud decision (hold, reject, restrict, suspend)'),

  ('support.view',              'Read support tickets and linked context'),
  ('support.reply',             'Write a human-authored support reply'),
  ('support.assign',            'Assign or reassign a support ticket'),
  ('support.close',             'Close or reopen a support ticket'),
  ('support.escalate',          'Escalate a support case to an internal team'),

  ('review.moderate',           'Moderate public reviews, comments and media'),
  ('review.verified.write',     'Set or clear the Verified Experience indicator'),

  ('game.content.write',        'Configure game content and balance parameters'),
  ('game.leaderboard.moderate', 'Moderate leaderboards (exclude or freeze entries)'),
  ('game.player.correct',       'Apply an audited compensating correction to game state'),

  ('provider.config.write',     'Configure provider status and economics'),
  ('provider.reconcile',        'Reconcile provider conversions and settlements'),
  ('provider.secret.read',      'View or rotate provider credentials'),

  ('advertiser.manage',         'Manage advertiser accounts and campaigns'),
  ('campaign.approve',          'Approve campaign content and budgets'),

  ('analytics.view',            'View operational analytics'),
  ('analytics.financial.view',  'View financial analytics and liability reporting'),

  ('audit.view',                'Read the audit log'),
  ('audit.export',              'Export audit records'),

  ('admin.role.assign',         'Grant or revoke an administrative role'),
  ('admin.session.revoke',      'Revoke an administrative session'),

  ('system.config.write',       'Change platform configuration'),
  ('system.killswitch.write',   'Operate a subsystem kill switch')
on conflict (code) do nothing;

insert into app.admin_roles (code, name, description, is_legacy_alias) values
  ('SUPER_ADMIN',            'Super Admin',            'All capabilities, subject to dual-control invariants', false),
  ('FINANCE_ADMIN',          'Finance Admin',          'Financial oversight, reconciliation and fee configuration', false),
  ('PAYMENT_OPERATOR',       'Payment Operator',       'Prepares and executes payment operations. Never approves.', false),
  ('PAYMENT_APPROVER',       'Payment Approver',       'Approves withdrawal payments', false),
  ('DEPOSIT_REVIEWER',       'Deposit Reviewer',       'Triage and verification of deposits', false),
  ('DEPOSIT_APPROVER',       'Deposit Approver',       'Confirms or rejects deposits', false),
  ('RECONCILIATION_OPERATOR','Reconciliation Operator','Reconciles external settlement against internal records', false),
  ('FRAUD_REVIEWER',         'Fraud Reviewer',         'Risk review and fraud decisions', false),
  ('SUPPORT_AGENT',          'Support Agent',          'Human support replies and ticket handling', false),
  ('SUPPORT_MANAGER',        'Support Manager',        'Support queue management and escalation', false),
  ('CONTENT_MODERATOR',      'Content Moderator',      'Human moderation of public content', false),
  ('GAME_ADMIN',             'Game Admin',             'Game content and leaderboard administration', false),
  ('PROVIDER_MANAGER',       'Provider Manager',       'Provider configuration and reconciliation', false),
  ('ADVERTISER_MANAGER',     'Advertiser Manager',     'Advertiser and campaign administration', false),
  ('ANALYST',                'Analyst',                'Read-only analytics access', false),
  ('AUDITOR',                'Auditor',                'Read-only audit access', false),
  ('SUPPORT_VIEWER',         'Support Viewer',         'Legacy alias: read-only subset of SUPPORT_AGENT', true)
on conflict (code) do nothing;

-- SUPER_ADMIN holds every capability. Dual-control invariants still apply.
insert into app.admin_role_capabilities (role_code, capability_code)
select 'SUPER_ADMIN', code from app.admin_capabilities
on conflict do nothing;

with mapping(role_code, capabilities) as (
  values
    ('FINANCE_ADMIN', array[
      'fee.config.write','analytics.view','analytics.financial.view',
      'deposit.view','deposit.reconcile','withdrawal.view','withdrawal.reconcile',
      'ledger.adjust.request','audit.view']),
    ('PAYMENT_OPERATOR', array[
      'deposit.view','deposit.verify','payout.execute','withdrawal.view','withdrawal.settle']),
    ('PAYMENT_APPROVER', array[
      'withdrawal.view','withdrawal.approve']),
    ('DEPOSIT_REVIEWER', array[
      'deposit.view','deposit.verify']),
    ('DEPOSIT_APPROVER', array[
      'deposit.view','deposit.approve']),
    ('RECONCILIATION_OPERATOR', array[
      'deposit.reconcile','withdrawal.reconcile','audit.view']),
    ('FRAUD_REVIEWER', array[
      'fraud.review','fraud.decide','withdrawal.review','user.view']),
    ('SUPPORT_AGENT', array[
      'support.view','support.reply','support.close','user.view']),
    ('SUPPORT_MANAGER', array[
      'support.view','support.reply','support.assign','support.close','support.escalate','user.view']),
    ('SUPPORT_VIEWER', array[
      'support.view']),
    ('CONTENT_MODERATOR', array[
      'review.moderate','review.verified.write','user.view']),
    ('GAME_ADMIN', array[
      'game.content.write','game.leaderboard.moderate','game.player.correct','audit.view']),
    ('PROVIDER_MANAGER', array[
      'provider.config.write','provider.reconcile','provider.secret.read','analytics.view']),
    ('ADVERTISER_MANAGER', array[
      'advertiser.manage','campaign.approve','analytics.view']),
    ('ANALYST', array[
      'analytics.view']),
    ('AUDITOR', array[
      'audit.view','audit.export'])
)
insert into app.admin_role_capabilities (role_code, capability_code)
select m.role_code, cap
from mapping m
cross join lateral unnest(m.capabilities) as cap
where exists (select 1 from app.admin_roles r where r.code = m.role_code)
  and exists (select 1 from app.admin_capabilities c where c.code = cap)
on conflict do nothing;

-- A role_code must never be silently granted a capability that does not exist.
-- The lateral join above plus these FKs make an orphan mapping impossible.
