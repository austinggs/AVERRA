-- =============================================================================
-- pgTAP: deposit credit invariants
--
-- Spec: 38_PAYMENT_OPERATIONS.txt, 84_USER_FUNDING_DEPOSIT_SYSTEM.md,
--       71_ARCHITECTURAL_LAWS.md laws 41/42/44/47/48/49/51/53/55
-- =============================================================================

begin;

select plan(10);

select has_function(
  'app_private', 'confirm_deposit',
  'an admin confirmation command exists; verification alone cannot credit'
);

select has_function(
  'app_private', 'record_deposit_verification',
  'an independent verification command exists'
);

-- ---------------------------------------------------------------------------
-- No browser-facing role may verify, confirm or reject a deposit.
-- ---------------------------------------------------------------------------
select results_eq(
  $$
    select count(*) from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app_private'
      and p.proname in (
        'confirm_deposit','reject_deposit','record_deposit_verification',
        'create_deposit_request'
      )
      and has_function_privilege('anon', p.oid, 'EXECUTE')
  $$,
  $$ values (0::bigint) $$,
  'the anon role cannot execute any deposit command function'
);

select results_eq(
  $$
    select count(*) from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app_private'
      and p.proname in (
        'confirm_deposit','reject_deposit','record_deposit_verification',
        'create_deposit_request'
      )
      and has_function_privilege('authenticated', p.oid, 'EXECUTE')
  $$,
  $$ values (0::bigint) $$,
  'the authenticated role cannot execute any deposit command function'
);

-- ---------------------------------------------------------------------------
-- Law 51: the same transfer EVENT can be claimed at most once.
-- ---------------------------------------------------------------------------
select has_index(
  'app', 'deposit_requests', 'uq_deposit_transfer_event',
  'a unique index prevents the same transfer event being claimed twice'
);

-- ---------------------------------------------------------------------------
-- Law 48: activation requires a verified contract address, and native CELO is
-- never present as a supported asset.
-- ---------------------------------------------------------------------------
-- pgTAP's throws_ok compares the expected message with SQLERRM by EXACT equality,
-- not as a pattern, so the expectation is the whole message PostgreSQL raises.
-- The constraint name inside it is what proves WHICH rule fired: errcode 23514
-- alone would also be satisfied by any other check constraint on this table.
select throws_ok(
  $$
    insert into app.deposit_token_configs (chain_id, symbol, contract_address, decimals, is_active)
    values (42220, 'CELO', '0x0000000000000000000000000000000000000000', 18, true)
  $$,
  '23514',
  'new row for relation "deposit_token_configs" violates check constraint "deposit_token_configs_active_requires_verification"',
  'a token cannot be activated without verification metadata'
);

select results_eq(
  $$
    select count(*) from app.deposit_token_configs
    where upper(symbol) = 'CELO'
  $$,
  $$ values (0::bigint) $$,
  'native CELO is never configured as a supported deposit asset'
);

select results_eq(
  $$
    select count(*) from app.deposit_token_configs where is_active
  $$,
  $$ values (0::bigint) $$,
  'no token is active out of the box; USDm and USAT stay inactive until RPC-verified'
);

select results_eq(
  $$
    select count(*) from app.deposit_token_configs
    where symbol in ('USDT','USDC','USDm','USAT') and chain_id = 42220
  $$,
  $$ values (4::bigint) $$,
  'all four planning candidates are seeded on Celo, none of them active'
);

select results_eq(
  $$
    select count(*) from app.deposit_token_configs
    where contract_address is not null
  $$,
  $$ values (0::bigint) $$,
  'no contract address is invented; every address stays null until supplied and verified'
);

select * from finish();
rollback;