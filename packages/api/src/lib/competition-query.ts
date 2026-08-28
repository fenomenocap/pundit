import { AppError } from "../middleware";

/**
 * Parse the optional competition filter shared by matches and model routes.
 * A filter is either absent/blank or one scalar string. Repeated and nested
 * query values are malformed rather than an instruction to return all data.
 */
export function parseOptionalCompetition(raw: unknown): string | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "string") {
    throw new AppError(400, "The competition filter is invalid.");
  }
  const value = raw.trim();
  return value || undefined;
}
