import fs from "node:fs";
import path from "node:path";
import { DEFAULT_BOOTSTRAP_DRAWS } from "../src/services/paired-bootstrap";
import {
  PRODUCTION_OFFICIAL_N_TARGET,
  assertCalibrationOutputNotInDataDir,
  calibrateChampion,
  calibrationResearchDir,
  writeChampionCalibrationArtifacts,
} from "../src/services/champion-calibration";

/**
 * Offline champion calibration. Default ledger is the local club-season
 * artifact (in-repo seed, or PUNDIT_DATA_DIR if set). Production evidence is
 * Railway PUNDIT_DATA_DIR=/data — this script never writes there.
 *
 * Usage:
 *   pnpm --filter @sports-predict/api calibrate:champion -- [ledgerPath]
 */
function resolveUserPath(input: string, mustExist: boolean): string {
  const candidates = [
    path.resolve(input),
    path.resolve(__dirname, "..", input),
    path.resolve(__dirname, "../../..", input),
  ];
  if (mustExist) {
    return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0];
  }
  return candidates.find((candidate) => (
    fs.existsSync(candidate) || fs.existsSync(path.dirname(candidate))
  )) ?? candidates[0];
}

function parseArgs(argv: string[]): { ledgerPath?: string; outDir: string; bootstrapDraws: number } {
  let ledgerPath: string | undefined;
  let outDir = calibrationResearchDir();
  let bootstrapDraws = DEFAULT_BOOTSTRAP_DRAWS;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--out-dir") {
      outDir = resolveUserPath(argv[++index] ?? outDir, false);
    } else if (arg === "--bootstrap") {
      bootstrapDraws = Number(argv[++index]);
    } else if (arg === "--help" || arg === "-h") {
      console.log(
        "calibrate-champion [ledgerPath] [--out-dir dir] [--bootstrap n]\n"
          + `Default ledger: packages/api/data/evaluation/club-season.json (or $PUNDIT_DATA_DIR).\n`
          + `Production target: n=${PRODUCTION_OFFICIAL_N_TARGET} official rows at PUNDIT_DATA_DIR=/data.\n`
          + "Does not write dixon-coles.ts or /data."
      );
      process.exit(0);
    } else if (arg === "--") {
      continue;
    } else if (!arg.startsWith("-") && !ledgerPath) {
      ledgerPath = resolveUserPath(arg, true);
    }
  }
  return { ledgerPath, outDir, bootstrapDraws };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  assertCalibrationOutputNotInDataDir(args.outDir);
  const report = calibrateChampion({
    ledgerPath: args.ledgerPath,
    bootstrapDraws: args.bootstrapDraws,
    allowSampleFallback: args.ledgerPath === undefined,
  });
  const paths = writeChampionCalibrationArtifacts(report, args.outDir);
  if (report.ledger.usedDocumentedSample) {
    console.log(
      `In-repo/local ledger had 0 official sealed fixtures. Fitted the documented sample.\n`
        + `Production n=${PRODUCTION_OFFICIAL_N_TARGET} is the real target (PUNDIT_DATA_DIR=/data on Railway).`
    );
  }
  console.log(JSON.stringify({
    ledgerPath: report.ledger.path,
    usedDocumentedSample: report.ledger.usedDocumentedSample,
    officialWithResultN: report.ledger.officialWithResultN,
    premierLeagueN: report.ledger.premierLeagueN,
    uclQualN: report.ledger.uclQualN,
    productionOfficialNTarget: PRODUCTION_OFFICIAL_N_TARGET,
    shippedConstants: report.shippedConstants,
    fittedConstants: report.fitted.constants,
    recommendProductionChange: report.decision.recommendProductionChange,
    changedShippedConstants: false,
    rebuiltGoldenCutover: false,
    artifacts: paths,
  }, null, 2));
}

if (require.main === module) main();
