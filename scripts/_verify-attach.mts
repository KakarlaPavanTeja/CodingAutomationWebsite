import path from "node:path";
import { config as loadEnv } from "dotenv";
import postgres from "postgres";
loadEnv({ path: path.join("/Users/kakarlapavanteja/Content/CodingAutomationWebsite", ".env.local"), quiet: true });
const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
console.log("--- loose search: elevator / palindrome / compaction / depot / settlement / sealed ---");
for (const t of ["elevator", "palindrom", "compaction", "depot", "settlement", "sealed", "cylinder", "pallet"]) {
  const rows = await sql`select name, difficulty, score, status, created_at from problems
    where name ilike ${"%" + t + "%"} and deleted_at is null order by created_at desc limit 4`;
  console.log(`  ${t.padEnd(12)} -> ${rows.length ? rows.map(r => `"${r.name}" (${r.difficulty ?? "null"}, ${r.score})`).join("; ") : "nothing"}`);
}
console.log("\n--- the two NULL-difficulty rows ---");
const rows = await sql`select id, name, difficulty, score, question_type, languages, storage_path is not null as st
  from problems where name in ('Patch Replay Orderings','Orbital Decay Watch') and deleted_at is null`;
for (const r of rows) console.log(`  ${String(r.name).padEnd(24)} id=${r.id} diff=${r.difficulty ?? "NULL"} score=${r.score} type=${r.question_type} langs=${JSON.stringify(r.languages)} storage=${r.st}`);
await sql.end();
