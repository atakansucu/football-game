import { readFileSync } from "node:fs";
import type { NormalizedDataset } from "./types";
import { computeDatasetMetrics } from "./transfermarktPipeline";

function main() {
  const file = process.argv[2];
  const baselineFile = process.argv[3];
  if (!file) {
    console.error(
      "Usage: validateTransfermarktDataset.ts <normalized-dataset.json> [baseline.json]",
    );
    process.exit(1);
  }
  const dataset = JSON.parse(readFileSync(file, "utf8")) as NormalizedDataset;
  const errors: string[] = [];
  const clubNames = new Set(dataset.clubs.map((club) => club.name));
  const nationalTeamNames = new Set(
    dataset.nationalTeams.map((team) => team.name),
  );

  dataset.players.forEach((player, index) => {
    const prefix = `players[${index}] (${player.name})`;
    if (!player.name.trim()) errors.push(`${prefix}: empty name`);
    if (player.clubs.some((club) => club.appearances < 1)) {
      errors.push(`${prefix}: club relation below one official appearance`);
    }
    if (player.clubs.some((club) => !clubNames.has(club.name))) {
      errors.push(`${prefix}: club missing from dataset.clubs`);
    }
    if (player.nationalTeams.some((team) => !nationalTeamNames.has(team))) {
      errors.push(`${prefix}: national team missing from dataset.nationalTeams`);
    }
    const clubClubEligible = new Set(player.clubs.map((club) => club.name)).size >= 2;
    const nationalClubEligible =
      player.clubs.length >= 1 && player.nationalTeams.length >= 1;
    if (!clubClubEligible && !nationalClubEligible) {
      errors.push(`${prefix}: cannot answer either game mode`);
    }
  });

  if (errors.length > 0) {
    console.error(errors.slice(0, 100).join("\n"));
    console.error(`Validation failed with ${errors.length} errors`);
    process.exit(1);
  }

  const metrics = computeDatasetMetrics(dataset);
  if (baselineFile) {
    const baseline = JSON.parse(readFileSync(baselineFile, "utf8")) as {
      metrics: Partial<typeof metrics>;
    };
    for (const [key, expected] of Object.entries(baseline.metrics)) {
      const actual = metrics[key as keyof typeof metrics];
      if (actual !== expected) {
        errors.push(`baseline ${key}: expected ${expected}, received ${actual}`);
      }
    }
  }
  if (errors.length > 0) {
    console.error(errors.join("\n"));
    process.exit(1);
  }
  console.log(JSON.stringify({ status: "ok", metrics }, null, 2));
}

main();
