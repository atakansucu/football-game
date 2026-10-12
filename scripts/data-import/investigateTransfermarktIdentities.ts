import { writeFileSync } from "node:fs";
import { investigateExternalIdentities } from "./transfermarktPipeline";

async function main() {
  const csvDir = process.argv[2];
  const out = process.argv[3];
  if (!csvDir) {
    console.error(
      "Usage: investigateTransfermarktIdentities.ts <csvDir> [audit.json]",
    );
    process.exit(1);
  }
  const audit = await investigateExternalIdentities(csvDir);
  const json = JSON.stringify(audit, null, 2);
  if (out) writeFileSync(out, json);
  console.log(json);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
