function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

export function pointsClearWording(gap: number): string | null {
  if (!Number.isFinite(gap) || gap <= 0) return null;
  if (gap === 1) return "one clear";
  if (gap === 2) return "two clear";
  if (gap === 3) return "three clear";
  return `${gap} clear`;
}

export function fixtureTableGapSentence(
  homeShort: string,
  homePos: number,
  homePts: number,
  awayShort: string,
  awayPos: number,
  awayPts: number,
): string | null {
  if (homePts === awayPts) {
    return `${homeShort} and ${awayShort} are level on ${homePts} points (${ordinal(homePos)} and ${ordinal(awayPos)}).`;
  }
  const homeAhead = homePts > awayPts;
  const gap = Math.abs(homePts - awayPts);
  const clear = pointsClearWording(gap);
  if (!clear) return null;
  if (homeAhead) {
    return `${homeShort} sit ${ordinal(homePos)} on ${homePts} points, ${clear} of ${ordinal(awayPos)}-placed ${awayShort} on ${awayPts}.`;
  }
  return `${awayShort} sit ${ordinal(awayPos)} on ${awayPts} points, ${clear} of ${ordinal(homePos)}-placed ${homeShort} on ${homePts}.`;
}

/** Drop dossier/table copy that states a wrong points gap. */
export function claimHasInvalidPointsGap(claim: string): boolean {
  const m = claim.match(
    /(\d+)\s+clear of\s+(?:\d+(?:st|nd|rd|th)[-\s]?placed\s+)?\w[^.]*?\bon\s+(\d+)\s+points/i,
  );
  if (!m) return false;
  const statedGap = Number(m[1]);
  const trailingPts = Number(m[2]);
  const lead = claim.match(/\bon\s+(\d+)\s+points/i);
  if (!lead) return false;
  const leaderPts = Number(lead[1]);
  const actualGap = leaderPts - trailingPts;
  return statedGap !== actualGap;
}
