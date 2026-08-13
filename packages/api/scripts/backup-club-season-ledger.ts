import fs from "node:fs";
import path from "node:path";

const configured = process.env.PUNDIT_DATA_DIR?.trim();
if (!configured) {
  throw new Error("PUNDIT_DATA_DIR must identify the mounted production data directory.");
}

const source = path.join(configured, "evaluation", "club-season.json");
if (!fs.existsSync(source)) {
  throw new Error(`No club-season ledger exists at ${source}.`);
}

const stamp = new Date().toISOString().replaceAll(":", "-");
const target = `${source}.backup-${stamp}`;
fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
const sourceBytes = fs.readFileSync(source);
const targetBytes = fs.readFileSync(target);
if (!sourceBytes.equals(targetBytes)) {
  throw new Error(`Backup byte verification failed: ${target}`);
}
console.log(target);
