/**
 * Imports a NormalizedDataset (see ./types.ts) into Supabase using the service
 * role key, then rebuilds the precomputed answer tables. Only rows with >= 1
 * official appearance are inserted, so eligibility never depends on raw transfer
 * history.
 *
 * Usage:
 *   npx tsx scripts/data-import/importFootballData.ts path/to/dataset.json
 *
 * Env: NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY
 *
 * Idempotent: clears existing football/answer data first, then bulk-inserts in
 * batches. Player FK rows are aligned to the ids returned by each insert batch
 * (PostgREST preserves input order), so duplicate player names are handled
 * correctly without relying on name lookups.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createServiceRoleClient } from "../../src/lib/supabase/serverClient";
import { normalizePlayerName } from "../../src/lib/football/normalize";
import type { NormalizedDataset } from "./types";

/**
 * Load .env.local and let the FILE win over any stale shell exports. Without
 * this, a lingering NEXT_PUBLIC_SUPABASE_URL / SUPABASE_URL in the shell can
 * silently redirect the import to a different Supabase project than the app
 * actually uses. We overwrite unconditionally and drop a stray SUPABASE_URL.
 */
function loadEnvLocal() {
  const file = path.resolve(process.cwd(), ".env.local");
  if (!existsSync(file)) return;
  let sawSupabaseUrl = false;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const key = m[1];
    const val = m[2].replace(/^["']|["']$/g, "").trim();
    process.env[key] = val;
    if (key === "SUPABASE_URL") sawSupabaseUrl = true;
  }
  if (!sawSupabaseUrl) delete process.env.SUPABASE_URL;
}
loadEnvLocal();

const PLAYER_BATCH = 500;
const FK_BATCH = 2000;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Delete every row of a table in small batches. A single unfiltered delete on
 * `players` cascades to aliases, national-team links, club history and the
 * precomputed answers; on hosted Postgres that easily exceeds the per-statement
 * timeout and fails *silently* if the error is ignored — leaving stale rows that
 * become duplicates on the next import. Batching keeps each statement small and
 * surfaces any error.
 */
async function clearTable(
  supabase: ReturnType<typeof createServiceRoleClient>,
  table: string,
): Promise<number> {
  let removed = 0;
  for (;;) {
    const { data, error } = await supabase
      .from(table)
      .select("id")
      .limit(500);
    if (error) throw new Error(`clear ${table} (select): ${error.message}`);
    if (!data || data.length === 0) break;
    const ids = data.map((r) => (r as { id: string }).id);
    const { error: delErr } = await supabase.from(table).delete().in("id", ids);
    if (delErr) throw new Error(`clear ${table} (delete): ${delErr.message}`);
    removed += ids.length;
  }
  return removed;
}

/**
 * Returns a name -> id map for the given lookup table. Existing rows are reused
 * (they are referenced by `rounds`, so we must not recreate them), and any names
 * not yet present are inserted. Avoids relying on a unique constraint.
 */
async function mapOrInsertByName(
  supabase: ReturnType<typeof createServiceRoleClient>,
  table: "clubs" | "national_teams",
  names: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  // Page through all existing rows (tables are small: hundreds of rows).
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from(table)
      .select("id, name")
      .range(from, from + 999);
    if (error) throw new Error(`${table} select: ${error.message}`);
    for (const row of data ?? []) map.set(row.name, row.id);
    if (!data || data.length < 1000) break;
  }
  const missing = [...new Set(names)].filter((n) => !map.has(n));
  for (const batch of chunk(missing, FK_BATCH)) {
    const { data, error } = await supabase
      .from(table)
      .insert(
        batch.map((name) => ({
          name,
          normalized_name: normalizePlayerName(name),
        })),
      )
      .select("id, name");
    if (error) throw new Error(`${table} insert: ${error.message}`);
    for (const row of data ?? []) map.set(row.name, row.id);
  }
  return map;
}

/**
 * Remove gameplay rows that reference `players` via a non-cascading FK, so the
 * player table can be cleared. `submissions.player_id` blocks player deletes,
 * and `rounds.winner_submission_id` in turn references submissions (a cycle), so
 * we null that link first. This only drops test-game answer history; rooms,
 * matches and rounds are preserved.
 */
async function clearSubmissions(
  supabase: ReturnType<typeof createServiceRoleClient>,
): Promise<number> {
  const { error: upErr } = await supabase
    .from("rounds")
    .update({ winner_submission_id: null })
    .not("winner_submission_id", "is", null);
  if (upErr) throw new Error(`null winner_submission_id: ${upErr.message}`);
  return clearTable(supabase, "submissions");
}

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: importFootballData.ts <dataset.json>");
    process.exit(1);
  }

  const dataset = JSON.parse(readFileSync(file, "utf8")) as NormalizedDataset;
  const supabase = createServiceRoleClient();

  // ---- Drop gameplay submissions that reference players (test history) -----
  console.log("Clearing gameplay submissions...");
  const delS = await clearSubmissions(supabase);
  console.log(`Cleared ${delS} submissions`);

  // ---- Reset players only (batched; cascades to their FK rows + answers) ---
  // Clubs and national teams are referenced by existing `rounds`, so we cannot
  // delete them without wiping game history. They are not duplicated, so we
  // reuse them by name and only rebuild the player graph on top.
  console.log("Clearing existing players...");
  const delP = await clearTable(supabase, "players");
  console.log(`Cleared ${delP} players`);

  // ---- Clubs: reuse existing rows by name, insert only missing ------------
  const clubId = await mapOrInsertByName(
    supabase,
    "clubs",
    dataset.clubs.map((c) => c.name),
  );
  console.log(`Mapped ${clubId.size} clubs`);

  // ---- National teams: same reuse-by-name strategy ------------------------
  const ntId = await mapOrInsertByName(
    supabase,
    "national_teams",
    dataset.nationalTeams.map((n) => n.name),
  );
  console.log(`Mapped ${ntId.size} national teams`);

  // ---- Players + FK rows --------------------------------------------------
  const aliasRows: { player_id: string; alias: string; normalized_alias: string }[] =
    [];
  const ntRows: { player_id: string; national_team_id: string }[] = [];
  const clubHistRows: {
    player_id: string;
    club_id: string;
    appearances: number;
  }[] = [];

  let inserted = 0;
  for (const batch of chunk(dataset.players, PLAYER_BATCH)) {
    const { data, error } = await supabase
      .from("players")
      .insert(
        batch.map((p) => ({
          name: p.name,
          normalized_name: normalizePlayerName(p.name),
        })),
      )
      .select("id");
    if (error) throw new Error(`players: ${error.message}`);
    const ids = (data ?? []).map((r) => r.id);
    if (ids.length !== batch.length) {
      throw new Error(
        `player batch id mismatch (${ids.length} != ${batch.length})`,
      );
    }

    batch.forEach((p, i) => {
      const pid = ids[i];
      for (const a of p.aliases ?? []) {
        aliasRows.push({
          player_id: pid,
          alias: a,
          normalized_alias: normalizePlayerName(a),
        });
      }
      for (const n of p.nationalTeams) {
        const id = ntId.get(n);
        if (id) ntRows.push({ player_id: pid, national_team_id: id });
      }
      for (const c of p.clubs) {
        const id = clubId.get(c.name);
        if (id && c.appearances >= 1) {
          clubHistRows.push({
            player_id: pid,
            club_id: id,
            appearances: c.appearances,
          });
        }
      }
    });

    inserted += batch.length;
    if (inserted % 2500 === 0 || inserted === dataset.players.length) {
      console.log(`  ...${inserted}/${dataset.players.length} players`);
    }
  }

  // ---- Bulk insert FK rows ------------------------------------------------
  for (const b of chunk(aliasRows, FK_BATCH)) {
    const { error } = await supabase.from("player_aliases").insert(b);
    if (error) throw new Error(`aliases: ${error.message}`);
  }
  for (const b of chunk(ntRows, FK_BATCH)) {
    const { error } = await supabase.from("player_national_teams").insert(b);
    if (error) throw new Error(`national teams: ${error.message}`);
  }
  for (const b of chunk(clubHistRows, FK_BATCH)) {
    const { error } = await supabase.from("player_club_history").insert(b);
    if (error) throw new Error(`club history: ${error.message}`);
  }
  console.log(
    `Inserted ${aliasRows.length} aliases, ${ntRows.length} nt links, ` +
      `${clubHistRows.length} club appearances`,
  );

  console.log("Rebuilding precomputed answers...");
  const { data: rebuilt, error: rebuildErr } =
    await supabase.rpc("rebuild_answers");
  if (rebuildErr) throw new Error(`rebuild_answers: ${rebuildErr.message}`);
  console.log("Import complete:", rebuilt);

  // Self-check against the SAME project the app reads.
  const { count } = await supabase
    .from("clubs")
    .select("id", { count: "exact", head: true });
  console.log(`Verify: target project now has ${count} clubs`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
