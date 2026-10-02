const { Client } = require("pg");

async function main() {
  const c = new Client({ connectionString: process.env.PGURL, connectionTimeoutMillis: 25000 });
  await c.connect();

  console.log("== 1. Which app game_* constraint references reward_sources?");
  const g = await c.query(`
    select t.relname as tbl, c.conname, pg_get_constraintdef(c.oid) as def
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'app'
      and t.relname like 'game_%'
      and pg_get_constraintdef(c.oid) ~ 'reward_sources'
    order by 1,2`);
  g.rows.forEach((x) => console.log("  " + x.tbl + "  " + x.conname + "\n      " + x.def));

  console.log("\n== 1b. All app relations matching game_% (to see the whole population):");
  const g2 = await c.query(`
    select c.relname, c.relkind
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname='app' and c.relname like 'game_%' order by 1`);
  console.log("  " + g2.rows.map((x) => x.relname + "(" + x.relkind + ")").join(" "));

  console.log("\n== 1c. Any app table at all with a reward_sources FK:");
  const g3 = await c.query(`
    select t.relname as tbl, c.conname, pg_get_constraintdef(c.oid) as def
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'app' and pg_get_constraintdef(c.oid) ~ 'reward_sources' order by 1`);
  g3.rows.forEach((x) => console.log("  " + x.tbl + "  " + x.conname + "  " + x.def));

  console.log("\n== 2. notification_category enum labels:");
  const n2 = await c.query(`
    select e.enumlabel, e.enumsortorder
    from pg_enum e join pg_type t on t.oid = e.enumtypid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname='app' and t.typname='notification_category' order by e.enumsortorder`);
  console.log("  count=" + n2.rows.length);
  console.log("  " + n2.rows.map((x) => x.enumlabel).join(", "));
  console.log("  array literal: {" + n2.rows.map((x) => x.enumlabel).join(",") + "}");

  console.log("\n== 3. withdraw split_exact / gross_positive constraint definitions:");
  const w = await c.query(`
    select c.conname, pg_get_constraintdef(c.oid) def
    from pg_constraint c join pg_class t on t.oid=c.conrelid
    join pg_namespace n on n.oid=t.relnamespace
    where n.nspname='app' and t.relname='withdrawal_requests'
      and c.conname in ('withdrawal_requests_split_exact','withdrawal_requests_gross_positive')
    order by 1`);
  w.rows.forEach((x) => console.log("  " + x.conname + "  =>  " + x.def));

  await c.end();
}
main().catch((e) => console.log("FATAL " + e.message));