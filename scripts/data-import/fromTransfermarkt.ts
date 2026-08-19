/**
 * Transforms the public Kaggle "Football Data from Transfermarkt"
 * (davidcariboo/player-scores) CSV export into the game's NormalizedDataset.
 *
 *   1. Download + unzip the dataset (no auth needed for this public set):
 *        curl -L -o tm.zip \
 *          "https://www.kaggle.com/api/v1/datasets/download/davidcariboo/player-scores"
 *        unzip tm.zip -d tmdata
 *   2. Transform:
 *        npx tsx scripts/data-import/fromTransfermarkt.ts ./tmdata ./dataset.json
 *   3. Import into Supabase:
 *        npx tsx scripts/data-import/importFootballData.ts ./dataset.json
 *
 * Football rules mapping:
 *   - Club appearances come from appearances.csv (>= 1 official appearance).
 *   - National-team representation uses players.csv `international_caps` (>= 1)
 *     together with `current_national_team_id`. Transfermarkt's per-player club
 *     appearance log does not include national-team caps, so this attributes a
 *     capped player to their (current) senior national team.
 *
 * Only players that can ever be a valid answer are kept:
 *   - capped internationals with >= 1 club appearance (National Team x Club), or
 *   - players with >= 2 distinct clubs (Club x Club).
 * One-club, never-capped players can never be an answer, so they are dropped.
 */
import {
  createReadStream,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createInterface } from "node:readline";
import path from "node:path";
import type { NormalizedDataset } from "./types";

const MIN_APPEARANCES = Number(process.env.MIN_APPEARANCES ?? "1");
// Optional cap on the number of players (most-capped / most-appearing first).
const MAX_PLAYERS = process.env.MAX_PLAYERS
  ? Number(process.env.MAX_PLAYERS)
  : Infinity;

/** Minimal RFC-4180-ish CSV line splitter (handles quoted commas + ""). */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function readCsv(file: string): { header: string[]; rows: string[][] } {
  const text = readFileSync(file, "utf8");
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  const header = splitCsvLine(lines[0]);
  const rows = lines.slice(1).map(splitCsvLine);
  return { header, rows };
}

function col(header: string[], name: string): number {
  const idx = header.indexOf(name);
  if (idx < 0) throw new Error(`Missing column "${name}" (have: ${header})`);
  return idx;
}

async function main() {
  const dir = process.argv[2];
  const out = process.argv[3] ?? "./dataset.json";
  if (!dir) {
    console.error(
      "Usage: fromTransfermarkt.ts <csvDir> [out.json]  (csvDir contains players.csv, clubs.csv, appearances.csv, national_teams.csv)",
    );
    process.exit(1);
  }

  // ---- clubs: id -> name (dedup by name) ----------------------------------
  const clubs = readCsv(path.join(dir, "clubs.csv"));
  const cIdCol = col(clubs.header, "club_id");
  const cNameCol = col(clubs.header, "name");
  const clubIdToName = new Map<string, string>();
  const clubNames = new Set<string>();
  for (const r of clubs.rows) {
    const id = r[cIdCol];
    const name = r[cNameCol]?.trim();
    if (!id || !name) continue;
    clubIdToName.set(id, name);
    clubNames.add(name);
  }

  // ---- national teams: id -> name, and citizenship country -> name --------
  const nts = readCsv(path.join(dir, "national_teams.csv"));
  const nIdCol = col(nts.header, "national_team_id");
  const nNameCol = col(nts.header, "name");
  const nCountryCol = col(nts.header, "country_name");
  const ntIdToName = new Map<string, string>();
  const ntByCountry = new Map<string, string>();
  for (const r of nts.rows) {
    const id = r[nIdCol];
    const name = r[nNameCol]?.trim();
    const country = r[nCountryCol]?.trim();
    if (id && name) ntIdToName.set(id, name);
    if (country && name) ntByCountry.set(country, name);
  }

  // ---- players: id -> {name, caps, ntId, lastName} ------------------------
  const players = readCsv(path.join(dir, "players.csv"));
  const pIdCol = col(players.header, "player_id");
  const pNameCol = col(players.header, "name");
  const pLastCol = col(players.header, "last_name");
  const pCapsCol = col(players.header, "international_caps");
  const pNtCol = col(players.header, "current_national_team_id");
  const pCitizenCol = col(players.header, "country_of_citizenship");

  interface P {
    name: string;
    lastName: string;
    caps: number;
    ntName: string | null;
    clubs: Map<string, number>; // clubName -> appearances
  }
  const byId = new Map<string, P>();
  for (const r of players.rows) {
    const id = r[pIdCol];
    const name = r[pNameCol]?.trim();
    if (!id || !name) continue;
    const caps = Number(r[pCapsCol] || "0") || 0;
    const ntId = r[pNtCol]?.trim();
    const citizen = r[pCitizenCol]?.trim();
    // Prefer the explicit current national team; otherwise derive it from
    // citizenship but only for players who actually have >= 1 senior cap.
    let ntName: string | null = null;
    if (ntId && ntIdToName.has(ntId)) {
      ntName = ntIdToName.get(ntId)!;
    } else if (caps >= 1 && citizen && ntByCountry.has(citizen)) {
      ntName = ntByCountry.get(citizen)!;
    }
    byId.set(id, {
      name,
      lastName: r[pLastCol]?.trim() ?? "",
      caps,
      ntName,
      clubs: new Map(),
    });
  }

  // ---- appearances: stream 1.9M rows, tally club appearances --------------
  const appPath = path.join(dir, "appearances.csv");
  const rl = createInterface({
    input: createReadStream(appPath, "utf8"),
    crlfDelay: Infinity,
  });
  let appHeader: string[] | null = null;
  let aPlayerCol = -1;
  let aClubCol = -1;
  let seen = 0;
  for await (const line of rl) {
    if (!appHeader) {
      appHeader = splitCsvLine(line);
      aPlayerCol = col(appHeader, "player_id");
      aClubCol = col(appHeader, "player_club_id");
      continue;
    }
    if (!line) continue;
    // Fast path: appearances rows have no quoted commas in the columns we read.
    const parts = line.split(",");
    const pid = parts[aPlayerCol];
    const cid = parts[aClubCol];
    if (!pid || !cid) continue;
    const p = byId.get(pid);
    const clubName = clubIdToName.get(cid);
    if (!p || !clubName) continue;
    p.clubs.set(clubName, (p.clubs.get(clubName) ?? 0) + 1);
    seen++;
  }
  console.log(`Scanned ${seen.toLocaleString()} appearance rows`);

  // ---- build NormalizedDataset --------------------------------------------
  interface Kept {
    name: string;
    aliases?: string[];
    nationalTeams: string[];
    clubs: { name: string; appearances: number }[];
    score: number;
  }
  const kept: Kept[] = [];
  const usedClubs = new Set<string>();
  const usedNts = new Set<string>();

  for (const p of byId.values()) {
    const clubHist = [...p.clubs.entries()]
      .filter(([, apps]) => apps >= MIN_APPEARANCES)
      .map(([name, appearances]) => ({ name, appearances }));

    const hasNt = !!p.ntName && clubHist.length >= 1;
    const hasPair = clubHist.length >= 2;
    if (!hasNt && !hasPair) continue;

    const nationalTeams = p.ntName ? [p.ntName] : [];
    const aliases =
      p.lastName && p.lastName.length >= 3 && p.lastName !== p.name
        ? [p.lastName]
        : undefined;

    kept.push({
      name: p.name,
      aliases,
      nationalTeams,
      clubs: clubHist,
      score: p.caps + clubHist.reduce((s, c) => s + c.appearances, 0),
    });
  }

  // Optional cap: keep the most relevant players first.
  kept.sort((a, b) => b.score - a.score);
  const finalPlayers = Number.isFinite(MAX_PLAYERS)
    ? kept.slice(0, MAX_PLAYERS)
    : kept;

  for (const p of finalPlayers) {
    for (const c of p.clubs) usedClubs.add(c.name);
    for (const n of p.nationalTeams) usedNts.add(n);
  }

  const dataset: NormalizedDataset = {
    clubs: [...usedClubs].sort().map((name) => ({ name })),
    nationalTeams: [...usedNts].sort().map((name) => ({ name })),
    players: finalPlayers.map((p) => ({
      name: p.name,
      aliases: p.aliases,
      nationalTeams: p.nationalTeams,
      clubs: p.clubs,
    })),
  };

  writeFileSync(out, JSON.stringify(dataset));
  console.log(
    `Wrote ${out}: ${dataset.players.length.toLocaleString()} players, ` +
      `${dataset.clubs.length} clubs, ${dataset.nationalTeams.length} national teams`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
