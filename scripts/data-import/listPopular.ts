import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createServiceRoleClient } from "../../src/lib/supabase/serverClient";

function loadEnvLocal() {
  const file = path.resolve(process.cwd(), ".env.local");
  if (!existsSync(file)) return;
  let sawSupabaseUrl = false;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
    if (m[1] === "SUPABASE_URL") sawSupabaseUrl = true;
  }
  if (!sawSupabaseUrl) delete process.env.SUPABASE_URL;
}
loadEnvLocal();

type Row = { name: string; prominence: number; popularity_rank: number };

// Fame tiers by rank (matches create_round in migration 0012).
const CLUB_EASY = 30;
const CLUB_MEDIUM = 60;
const NAT_EASY = 21;
const NAT_MEDIUM = 42;

function tier(rank: number, easy: number, medium: number): string {
  if (rank >= 1 && rank <= easy) return "EASY";
  if (rank <= medium) return "MEDIUM";
  return "HARD";
}

function printTiered(title: string, rows: Row[], easy: number, medium: number) {
  console.log(`\n${title}`);
  let lastTier = "";
  for (const r of rows) {
    const t = tier(r.popularity_rank, easy, medium);
    if (t !== lastTier) {
      console.log(`\n  --- ${t} (rank ${describe(t, easy, medium)}) ---`);
      lastTier = t;
    }
    console.log(
      `  ${String(r.popularity_rank).padStart(3)}. ${r.name} (${r.prominence})`,
    );
  }
}

function describe(t: string, easy: number, medium: number): string {
  if (t === "EASY") return `1–${easy}`;
  if (t === "MEDIUM") return `${easy + 1}–${medium}`;
  return `${medium + 1}+`;
}

async function main() {
  const db = createServiceRoleClient();

  // Show through the medium boundary; hard = everything else.
  const clubs = await db
    .from("clubs")
    .select("name, prominence, popularity_rank")
    .lte("popularity_rank", CLUB_MEDIUM)
    .gt("popularity_rank", 0)
    .order("popularity_rank", { ascending: true });
  if (clubs.error) throw new Error(`clubs: ${clubs.error.message}`);

  const nats = await db
    .from("national_teams")
    .select("name, prominence, popularity_rank")
    .lte("popularity_rank", NAT_MEDIUM)
    .gt("popularity_rank", 0)
    .order("popularity_rank", { ascending: true });
  if (nats.error) throw new Error(`national_teams: ${nats.error.message}`);

  printTiered(
    "NATIONAL TEAMS — easy 1–21, medium 22–42, hard 43+",
    (nats.data ?? []) as Row[],
    NAT_EASY,
    NAT_MEDIUM,
  );
  printTiered(
    "CLUBS — easy 1–30, medium 31–60, hard 61+",
    (clubs.data ?? []) as Row[],
    CLUB_EASY,
    CLUB_MEDIUM,
  );
}

main();
