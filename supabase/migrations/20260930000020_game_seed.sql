-- =============================================================================
-- Averra migration 020: Mining Game seed configuration
--
-- Source of truth: 20_MACHINES, 21_RESOURCES, 22_ENERGY, 24_UPGRADES
--
-- EVERYTHING SEEDED HERE IS INACTIVE BY DEFAULT. Doc 07 and doc 08 require
-- commercial and compliance approval before a provider goes live; the same
-- discipline applies to game economy configuration. Game balance is a
-- commercial decision, so nothing is presented as active until it is set.
--
-- The one exception is `ore_basic`, which must exist for `perform_game_action`
-- COLLECT to resolve a resource. It is a definition only: it has a virtual value
-- inside the game economy and no funding source, so it cannot pay anything
-- (law 26, doc 21 VALUATION).
-- =============================================================================

-- Resources. Categories are data-driven per doc 21.
insert into app.game_resources (code, name, category, base_value, is_active) values
  ('ore_basic',   'Basic Ore',   'RAW_ORE',   1.000000, true),
  ('ore_refined', 'Refined Ore', 'PROCESSED', 3.500000, false),
  ('fuel_cell',   'Fuel Cell',   'FUEL',      0.500000, false),
  ('event_token', 'Event Token', 'EVENT',     0.000000, false)
on conflict (code) do nothing;

-- Machine types. Energy cost and production interval are configuration, not
-- constants in a function (doc 22 CONSUMPTION, doc 20 PRODUCTION).
insert into app.game_machine_types (
  code, name, energy_cost, production_interval_seconds, base_output_minor, max_level, unlock_level, is_active
) values
  ('ore_basic',  'Basic Extractor',  1, 60,  10, 10, 1, true),
  ('ore_medium', 'Medium Extractor', 2, 45,  40, 10, 5, false),
  ('ore_large',  'Large Extractor',  4, 30, 150, 10, 10, false)
on conflict (code) do nothing;

-- Upgrades. Doc 24 requires requirements, cost, duration and prerequisites to be
-- data-driven; none of it is hardcoded.
insert into app.game_upgrades (
  code, name, target_type, from_level, to_level, energy_cost, duration_seconds, prerequisite_code, modifier, is_active
) values
  (
    'extractor_tuning_1', 'Extractor Tuning I', 'MACHINE',
    1, 2, 2, 300, null,
    '{"outputMultiplier": 1.25}'::jsonb, true
  ),
  (
    'extractor_tuning_2', 'Extractor Tuning II', 'MACHINE',
    2, 3, 4, 600, 'extractor_tuning_1',
    '{"outputMultiplier": 1.5}'::jsonb, false
  )
on conflict (code) do nothing;

-- No player rows are seeded. A game player is created on first authenticated
-- entry to the game, so no state exists for a user who has never played.
comment on table app.game_upgrades is
  'Data-driven upgrade definitions (doc 24). Seeded inactive pending commercial approval of game economy balance.';