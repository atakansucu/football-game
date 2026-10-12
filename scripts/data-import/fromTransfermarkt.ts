/**
 * Build a research NormalizedDataset from Kaggle's Transfermarkt export.
 *
 * Required CSVs:
 * players, clubs, national_teams, competitions, games, appearances,
 * game_lineups and game_events.
 *
 * This command only writes local JSON files. It never connects to Supabase.
 */
import { writeFileSync } from "node:fs";
import {
  buildTransfermarktDataset,
  computeDatasetMetrics,
} from "./transfermarktPipeline";

const MIN_APPEARANCES = Number(process.env.MIN_APPEARANCES ?? "1");
const MAX_PLAYERS = process.env.MAX_PLAYERS
  ? Number(process.env.MAX_PLAYERS)
  : Number.POSITIVE_INFINITY;

async function main() {
  const csvDir = process.argv[2];
  const out = process.argv[3] ?? "./dataset.transfermarkt.research.json";
  const statsOut = process.argv[4] ?? `${out}.stats.json`;
  if (!csvDir) {
    console.error(
      "Usage: fromTransfermarkt.ts <csvDir> [out.json] [stats.json]",
    );
    process.exit(1);
  }
  if (!Number.isFinite(MIN_APPEARANCES) || MIN_APPEARANCES < 1) {
    throw new Error(`Invalid MIN_APPEARANCES: ${MIN_APPEARANCES}`);
  }
  if (Number.isNaN(MAX_PLAYERS) || MAX_PLAYERS < 1) {
    throw new Error(`Invalid MAX_PLAYERS: ${MAX_PLAYERS}`);
  }

  const { dataset, stats } = await buildTransfermarktDataset(csvDir, {
    minAppearances: MIN_APPEARANCES,
    maxPlayers: MAX_PLAYERS,
  });
  const metrics = computeDatasetMetrics(dataset);
  writeFileSync(out, JSON.stringify(dataset));
  writeFileSync(
    statsOut,
    JSON.stringify({ generatedAt: new Date().toISOString(), stats, metrics }, null, 2),
  );
  console.log(
    `Wrote ${out}: ${dataset.players.length.toLocaleString()} players, ` +
      `${dataset.clubs.length} clubs, ${dataset.nationalTeams.length} national teams`,
  );
  console.log(`Validation stats: ${statsOut}`);
  console.log(JSON.stringify(metrics, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
