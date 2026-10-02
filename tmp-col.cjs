const { Client } = require("pg");

const FORMS = {
  "A no-cast literal": `
    select results_eq(
      $$ select array_agg(e.enumlabel order by e.enumsortorder)::text
         from pg_enum e join pg_type t on t.oid = e.enumtypid
         join pg_namespace n on n.oid = t.typnamespace
         where n.nspname='app' and t.typname='risk_decision' $$,
      $$ values ('{ALLOW,HOLD,REVIEW,REJECT,RESTRICT,SUSPEND,TERMINATE}') $$,
      'form A'
    )`,
  "B collate C both sides": `
    select results_eq(
      $$ select array_agg(e.enumlabel order by e.enumsortorder)::text collate "C"
         from pg_enum e join pg_type t on t.oid = e.enumtypid
         join pg_namespace n on n.oid = t.typnamespace
         where n.nspname='app' and t.typname='risk_decision' $$,
      $$ values ('{ALLOW,HOLD,REVIEW,REJECT,RESTRICT,SUSPEND,TERMINATE}'::text collate "C") $$,
      'form B'
    )`,
  "C name[] array both sides": `
    select results_eq(
      $$ select array_agg(e.enumlabel order by e.enumsortorder)
         from pg_enum e join pg_type t on t.oid = e.enumtypid
         join pg_namespace n on n.oid = t.typnamespace
         where n.nspname='app' and t.typname='risk_decision' $$,
      $$ values ('{ALLOW,HOLD,REVIEW,REJECT,RESTRICT,SUSPEND,TERMINATE}'::name[]) $$,
      'form C'
    )`,
  "D CONTROL current form (::text both)": `
    select results_eq(
      $$ select array_agg(e.enumlabel order by e.enumsortorder)::text
         from pg_enum e join pg_type t on t.oid = e.enumtypid
         join pg_namespace n on n.oid = t.typnamespace
         where n.nspname='app' and t.typname='risk_decision' $$,
      $$ values ('{ALLOW,HOLD,REVIEW,REJECT,RESTRICT,SUSPEND,TERMINATE}'::text) $$,
      'form D'
    )`,
};

async function main() {
  for (const [name, body] of Object.entries(FORMS)) {
    const c = new Client({ connectionString: process.env.PGURL, connectionTimeoutMillis: 25000 });
    await c.connect();
    try {
      await c.query("begin");
      await c.query("select plan(1)");
      const r = await c.query(body);
      const line = r.rows.map((x) => JSON.stringify(x)).join(" | ");
      console.log(name.padEnd(38) + " =>  " + line);
    } catch (e) {
      console.log(name.padEnd(38) + " =>  ERROR: " + e.message);
    } finally {
      await c.query("rollback").catch(() => {});
      await c.end().catch(() => {});
    }
  }
}
main().catch((e) => console.log("FATAL " + e.message));