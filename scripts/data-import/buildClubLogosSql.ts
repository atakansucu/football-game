/**
 * Generates supabase/migrations/0014_club_logos.sql: adds a logo_url column to
 * public.clubs and fills it with the REAL Transfermarkt crest for each club,
 * matched by name from tmdata/clubs.csv (club_id -> wappen image).
 *
 *   npx tsx scripts/data-import/buildClubLogosSql.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

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
        } else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

const root = process.cwd();
const csv = readFileSync(path.join(root, "tmdata/clubs.csv"), "utf8");
const lines = csv.split(/\r?\n/).filter((l) => l.length > 0);
const header = splitCsvLine(lines[0]);
const idCol = header.indexOf("club_id");
const nameCol = header.indexOf("name");
const seasonCol = header.indexOf("last_season");

// name -> { id, season } keeping the most recent (current crest) per name.
const byName = new Map<string, { id: string; season: number }>();
for (const line of lines.slice(1)) {
  const r = splitCsvLine(line);
  const id = r[idCol]?.trim();
  const name = r[nameCol]?.trim();
  if (!id || !name) continue;
  const season = Number(r[seasonCol] || "0") || 0;
  const prev = byName.get(name);
  if (!prev || season > prev.season) byName.set(name, { id, season });
}

const values = [...byName.entries()]
  .sort((a, b) => a[0].localeCompare(b[0]))
  .map(([name, { id }]) => {
    const esc = name.replace(/'/g, "''");
    const url = `https://tmssl.akamaized.net/images/wappen/head/${id}.png`;
    return `  ('${esc}', '${url}')`;
  })
  .join(",\n");

const sql = `-- ============================================================================
-- 0014 — Real club crests (Transfermarkt "wappen" images), matched by name.
-- Adds clubs.logo_url and fills it from the source dataset's club_id. National
-- teams keep their flag emoji (rendered client-side), so only clubs need this.
-- Idempotent: safe to re-run.
-- ============================================================================

alter table public.clubs add column if not exists logo_url text;

update public.clubs c set logo_url = m.url
from (values
${values}
) as m(name, url)
where c.name = m.name;
`;

const outPath = path.join(root, "supabase/migrations/0014_club_logos.sql");
writeFileSync(outPath, sql);
console.log(
  `Wrote ${outPath}: ${byName.size} club crest mappings`,
);
