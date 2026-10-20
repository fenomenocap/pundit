/** Research-only EPL 1X2 calibration; default off preserves production forecasts. */

export const ONE_X_TWO_TEMPERATURE_ENABLED = false;
export const ONE_X_TWO_TEMPERATURE = 1.286;

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
