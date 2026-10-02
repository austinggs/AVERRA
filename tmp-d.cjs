const { Client } = require("pg");
async function main(){
  const c=new Client({connectionString:process.env.PGURL, connectionTimeoutMillis:25000});await c.connect();
  const q="select p.oid::regprocedure::text sig, pg_get_functiondef(p.oid) def from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname=$1 and p.proname in ($2,$3) order by 1";
  const r=await c.query(q,["extensions","_throws_ok","throws_ok"]);
  for(const row of r.rows){
    const def=row.def;
    console.log("===== "+row.sig+" =====");
    const i=def.indexOf("expected");
    console.log(def.length>3200?def.slice(0,1500)+"\n   ...[snip]...\n"+def.slice(-1500):def);
    console.log();
  }
  await c.end();
}
main().catch(e=>console.log("FATAL "+e.message));