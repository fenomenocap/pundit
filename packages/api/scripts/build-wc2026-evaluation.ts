import fs from "node:fs";
import path from "node:path";
import { buildWc2026EvaluationArtifact } from "../src/services/wc-evaluation-build";

async function main(): Promise<void> {
  const artifact = await buildWc2026EvaluationArtifact();
  const outputPath = path.join(__dirname, "../data/evaluation/wc-2026.json");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  console.log(
    `[WC Evaluation] Wrote ${artifact.fixtures.length} fixtures to ${outputPath}`
  );
  console.log(
    `[WC Evaluation] Brier ${artifact.metrics.brierScore}, `
    + `log-loss ${artifact.metrics.logLoss}, `
    + `accuracy ${(artifact.metrics.winnerAccuracy * 100).toFixed(1)}%`
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
