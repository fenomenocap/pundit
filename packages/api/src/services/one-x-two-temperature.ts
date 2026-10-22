/**
 * EPL 1X2 temperature scaling (T = 1.286), behind a flag that defaults OFF.
 *
 * Enabled only when the process environment sets
 * ONE_X_TWO_TEMPERATURE_ENABLED=true exactly. Any other value, or no value,
 * keeps production forecasts unchanged. Turning it on needs the owner's approval;
 * evidence: model/calibration-2026-10-22/report.json.
 *
 * When enabled, the tempered 1X2 becomes the anchoring target for the score
 * grid, so xG, O/U, BTTS and scorelines stay coherent with the published 1X2.
 */

export const ONE_X_TWO_TEMPERATURE_FLAG = "ONE_X_TWO_TEMPERATURE_ENABLED";
/** Default when the flag is unset. Production ships OFF. */
export const ONE_X_TWO_TEMPERATURE_ENABLED = false;
export const ONE_X_TWO_TEMPERATURE = 1.286;

export function oneXTwoTemperatureEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  const raw = env[ONE_X_TWO_TEMPERATURE_FLAG];
  return raw === undefined ? ONE_X_TWO_TEMPERATURE_ENABLED : raw === "true";
}

export function scaleOneXTwoProbabilities(
  probabilities: readonly [number, number, number],
  temperature: number,
): [number, number, number] {
  if (temperature <= 0 || !Number.isFinite(temperature)) {
    throw new Error("1X2 temperature must be a positive finite number.");
  }
  const floor = 1e-15;
  const logits = probabilities.map((probability) => Math.log(Math.max(probability, floor)));
  const scaled = logits.map((logit) => Math.exp(logit / temperature));
  const sum = scaled[0] + scaled[1] + scaled[2];
  return [scaled[0] / sum, scaled[1] / sum, scaled[2] / sum];
}
