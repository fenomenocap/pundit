/** Offline paired comparison of fixed held-out losses, resampled by UTC week. */
export const DEFAULT_BOOTSTRAP_DRAWS = 2000;
export const MIN_BOOTSTRAP_DRAWS = 1000;
export const MIN_BOOTSTRAP_BLOCKS = 5;

export function utcWeekStart(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) throw new Error(`Invalid evaluation date ${iso}`);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  return date.toISOString();
}

export interface PairedLoss {
  block: string;
  champion: number;
  challenger: number;
}

export interface PairedBootstrap {
  method: "paired-utc-week-heldout";
  draws: number;
  seed: number;
  n: number;
  blockCount: number;
  meanDelta: number;
  p10: number;
  p50: number;
  p90: number;
}

export function pairedBootstrap(
  rows: readonly PairedLoss[],
  draws = DEFAULT_BOOTSTRAP_DRAWS,
  seed = 20260915
): PairedBootstrap | null {
  if (!Number.isSafeInteger(draws) || draws < 0 || draws > 100000) {
    throw new Error("Bootstrap draws must be an integer between 0 and 100000.");
  }
  if (draws === 0 || rows.length === 0) return null;
  const blocks = new Map<string, { n: number; delta: number }>();
  for (const row of rows) {
    if (!Number.isFinite(row.champion) || !Number.isFinite(row.challenger)) {
      throw new Error("Cannot bootstrap non-finite losses.");
    }
    const block = blocks.get(row.block) ?? { n: 0, delta: 0 };
    block.n += 1;
    block.delta += row.challenger - row.champion;
    blocks.set(row.block, block);
  }
  const values = [...blocks.values()];
  let state = seed >>> 0;
  const deltas: number[] = [];
  for (let draw = 0; draw < draws; draw += 1) {
    let n = 0;
    let delta = 0;
    for (let index = 0; index < values.length; index += 1) {
      state = (Math.imul(1664525, state) + 1013904223) >>> 0;
      const block = values[Math.floor(state / 0x100000000 * values.length)];
      n += block.n;
      delta += block.delta;
    }
    deltas.push(delta / n);
  }
  deltas.sort((a, b) => a - b);
  const quantile = (p: number) => deltas[Math.floor(p * (deltas.length - 1))];
  return {
    method: "paired-utc-week-heldout", draws, seed, n: rows.length, blockCount: values.length,
    meanDelta: values.reduce((sum, block) => sum + block.delta, 0) / rows.length,
    p10: quantile(0.1), p50: quantile(0.5), p90: quantile(0.9),
  };
}
