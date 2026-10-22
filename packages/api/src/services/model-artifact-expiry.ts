/** Shared expiry arithmetic for hard-expiring model pins (calibration, ClubElo). */
export const MODEL_PIN_ALERT_DAYS = 7;
const DAY = 86_400_000;

export interface ModelPin { id: string; issuedAt: string; maxAgeMs: number }
export interface ModelPinExpiry { id: string; issuedAt: string; expiresAt: string; daysLeft: number; alert: boolean }

export function modelPinExpiry(pin: ModelPin, now: Date, alertDays = MODEL_PIN_ALERT_DAYS): ModelPinExpiry {
  const issued = Date.parse(pin.issuedAt);
  if (!Number.isFinite(issued) || !Number.isFinite(pin.maxAgeMs) || pin.maxAgeMs <= 0) {
    throw new Error(`Invalid model pin timestamp or max age: ${pin.id}`);
  }
  const expires = issued + pin.maxAgeMs;
  const daysLeft = Math.floor(((expires - now.getTime()) / DAY) * 10) / 10;
  return { id: pin.id, issuedAt: new Date(issued).toISOString(), expiresAt: new Date(expires).toISOString(),
    daysLeft, alert: expires - now.getTime() <= alertDays * DAY };
}

export function modelArtifactExpiryReport(pins: readonly ModelPin[], now: Date, alertDays = MODEL_PIN_ALERT_DAYS) {
  const expiries = pins.map((pin) => modelPinExpiry(pin, now, alertDays));
  return { checkedAt: now.toISOString(), alertDays, alert: expiries.some((p) => p.alert), pins: expiries };
}
