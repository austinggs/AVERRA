const { Client } = require("pg");

async function main() {
  const c = new Client({ connectionString: process.env.PGURL, connectionTimeoutMillis: 25000 });
  await c.connect();

  const fks = await c.query(`
    select t.relname as tbl, a.attname as col, pg_get_constraintdef(con.oid) as def
    from pg_constraint con
    join pg_class t on t.oid = con.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    join unnest(con.conkey) k(attnum) on true
    join pg_attribute a on a.attrelid = t.oid and a.attnum = k.attnum
    where con.contype='f' and n.nspname='app'
      and t.relname in ('game_players','withdrawal_requests','task_definitions','payout_destinations')
    order by 1,2`);
  console.log("== FKs ==");
  fks.rows.forEach((r) => console.log("  " + r.tbl + "." + r.col + "  " + r.def));

  const u = await c.query("select count(*)::int as n from auth.users");
  console.log("\n== auth.users rows: " + u.rows[0].n);

  console.log("\n== can we insert an auth.users row from this role? ==");
  await c.query("begin");
  try {
    const ins = await c.query(`
      insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, created_at, updated_at
      )
      values (
        '00000000-0000-0000-0000-000000000000', gen_random_uuid(),
        'authenticated', 'authenticated', 'pgtap-fixture@example.invalid',
        '', now(), now(), now()
      )
      returning id, email`);
    console.log("  INSERT OK -> " + JSON.stringify(ins.rows[0]));

    const d = await c.query(`
      insert into app.payout_destinations (user_id, method, account_identifier)
      select id, 'MINIPAY_MANUAL', 'fixture' from auth.users where email = 'pgtap-fixture@example.invalid'
      returning id`);
    console.log("  payout_destinations INSERT OK -> " + JSON.stringify(d.rows[0]));

    const w = await c.query(`
      insert into app.withdrawal_requests (
        user_id, method, status, destination_id, unit,
        gross_amount_minor, fee_amount_minor, net_amount_minor
      )
      select u.id, 'MINIPAY_MANUAL', 'REQUESTED', d.id, 'NGN', 1000, 150, 900
      from auth.users u join app.payout_destinations d on d.user_id = u.id
      where u.email = 'pgtap-fixture@example.invalid'
      returning id`);
    console.log("  withdrawal INSERT unexpectedly SUCCEEDED -> " + JSON.stringify(w.rows[0]));
  } catch (e) {
    console.log("  ERROR: " + e.code + " " + e.message);
  } finally {
    await c.query("rollback").catch(() => {});
  }

  await c.end();
}
main().catch((e) => console.log("FATAL " + e.message));