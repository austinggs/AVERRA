const { Client } = require("pg");

// The exact insert from supabase/tests/tasks.sql test 5.
const INS =
  "insert into app.task_definitions (code, title, state, verification_mechanism, " +
  "reward_amount_minor, reward_unit, funding_source_id) " +
  "select 'bad_task', 'Pays with no verification', 'DRAFT', 'NONE', 1000, 'NGN', null";

const C = "task_definitions_paying_task_needs_verification";
const FULL =
  'new row for relation "task_definitions" violates check constraint "' + C + '"';

async function main() {
  const c = new Client({ connectionString: process.env.PGURL, connectionTimeoutMillis: 25000 });
  await c.connect();
  await c.query("set search_path to extensions, public, pg_catalog");

  const t = async (label, errcode, errmsg) => {
    try {
      const r = await c.query("select throws_ok($1,$2,$3,$4) as t", [INS, errcode, errmsg, "desc"]);
      console.log("  " + label.padEnd(38) + "=>  " + String(r.rows[0].t).split("\n")[0]);
    } catch (e) {
      console.log("  " + label.padEnd(38) + "=>  ERR " + e.message.split("\n")[0]);
    }
  };

  await c.query("begin");
  await c.query("select plan(5)");
  await t("A errcode only (errmsg NULL)", "23514", null);
  await t("B errcode + FULL exact message", "23514", FULL);
  await t("C errcode + constraint name only", "23514", C);
  await t("D errcode + regex wrapper", "23514", ".*" + C + ".*");
  await t("E wrong errcode + full message", "23505", FULL);
  await c.query("rollback").catch(() => {});
  await c.end();
}
main().catch((e) => console.log("FATAL " + e.message));