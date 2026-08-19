import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createServiceRoleClient } from "../../src/lib/supabase/serverClient";

// Proves each difficulty tier has playable combos under the NEW rules, where a
// combo must satisfy BOTH its fame caps and its common-player-count threshold:
//   national team: easy<=21  medium<=42            club: easy<=30  medium<=60
//   common players: easy>=5   medium>=3   hard>=1
// Random mode only ever picks pairs from the answer tables, so any match has the
// required number of shared players. Run AFTER applying migration 0012.

function loadEnvLocal() {
  const file = path.resolve(process.cwd(), ".env.local");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  }
  delete process.env.SUPABASE_URL;
}
loadEnvLocal();

type Db = ReturnType<typeof createServiceRoleClient>;

async function idsByRank(db: Db, table: "clubs" | "national_teams", maxRank: number) {
  const { data, error } = await db
    .from(table)
    .select("id")
    .lte("popularity_rank", maxRank)
    .gt("popularity_rank", 0);
  if (error) throw new Error(`${table} ids: ${error.message}`);
  return (data ?? []).map((r) => (r as { id: string }).id);
}

// Fetch answer rows within a tier and count shared players per (a,b) combo.
async function comboCounts(
  db: Db,
  table: "country_club_answers" | "club_club_answers",
  colA: string,
  colB: string,
  aIds: string[],
  bIds: string[],
): Promise<number[]> {
  const counts = new Map<string, number>();
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await db
      .from(table)
      .select(`${colA}, ${colB}`)
      .in(colA, aIds)
      .in(colB, bIds)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    const rows = (data ?? []) as Record<string, string>[];
    for (const r of rows) {
      const key = `${r[colA]}|${r[colB]}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    if (rows.length < pageSize) break;
  }
  return [...counts.values()];
}

const atLeast = (arr: number[], n: number) => arr.filter((c) => c >= n).length;

async function main() {
  const db = createServiceRoleClient();

  const natEasy = await idsByRank(db, "national_teams", 21);
  const natMed = await idsByRank(db, "national_teams", 42);
  const clubEasy = await idsByRank(db, "clubs", 30);
  const clubMed = await idsByRank(db, "clubs", 60);

  const ncEasy = await comboCounts(
    db, "country_club_answers", "national_team_id", "club_id", natEasy, clubEasy,
  );
  const ncMed = await comboCounts(
    db, "country_club_answers", "national_team_id", "club_id", natMed, clubMed,
  );
  const ccEasy = await comboCounts(
    db, "club_club_answers", "club_1_id", "club_2_id", clubEasy, clubEasy,
  );
  const ccMed = await comboCounts(
    db, "club_club_answers", "club_1_id", "club_2_id", clubMed, clubMed,
  );

  const ok = (n: number) => (n > 0 ? "OK" : "EMPTY ⚠");

  console.log("Playable combos meeting BOTH fame caps AND the count threshold\n");
  console.log("NATIONAL × CLUB");
  console.log(`  easy   (fame + >=5 players): ${atLeast(ncEasy, 5)} combos  ${ok(atLeast(ncEasy, 5))}`);
  console.log(`  medium (fame + >=3 players): ${atLeast(ncMed, 3)} combos  ${ok(atLeast(ncMed, 3))}`);
  console.log("\nCLUB × CLUB");
  console.log(`  easy   (fame + >=5 players): ${atLeast(ccEasy, 5)} combos  ${ok(atLeast(ccEasy, 5))}`);
  console.log(`  medium (fame + >=3 players): ${atLeast(ccMed, 3)} combos  ${ok(atLeast(ccMed, 3))}`);
  console.log("\nhard = any playable pair (>=1 shared player, no fame cap).");
}

main();
