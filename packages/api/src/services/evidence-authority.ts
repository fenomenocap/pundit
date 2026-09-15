export type EvidenceTier = "official" | "analytics" | "news" | "other";

export type EvidenceAuthority = "official" | "reputable" | "other";

export const OFFICIAL_EVIDENCE_DOMAINS = [
  "premierleague.com",
  "uefa.com",
  "fifa.com",
  "thefa.com",
  "englandfootball.com",
  // Supported-club first-party domains. Unknown hosts deliberately remain
  // `other`; a search result does not become reputable merely by existing.
  "arsenal.com",
  "avfc.co.uk",
  "afcb.co.uk",
  "brentfordfc.com",
  "brightonandhovealbion.com",
  "burnleyfootballclub.com",
  "chelseafc.com",
  "cpfc.co.uk",
  "evertonfc.com",
  "fulhamfc.com",
  "leedsunited.com",
  "liverpoolfc.com",
  "mancity.com",
  "manutd.com",
  "newcastleunited.com",
  "nottinghamforest.co.uk",
  "safc.com",
  "tottenhamhotspur.com",
  "whufc.com",
  "wolves.co.uk",
] as const;

export const ANALYTICS_EVIDENCE_DOMAINS = [
  "fbref.com",
  "theanalyst.com",
  "whoscored.com",
  "fotmob.com",
  "sofascore.com",
  "transfermarkt.com",
  "transfermarkt.co.uk",
  "transfermarkt.us",
  "footystats.org",
  "statbunker.com",
  "oddschecker.com",
  "oddsportal.com",
  "flashscore.com",
] as const;

// Verification can only run against pages it is allowed to fetch, and this
// list was seven wire services and broadcasters. Football team news is broken
// by beat reporters and the specialist press, so a search that returned
// exactly the right report -- six Hull players ruled out, dated -- retrieved
// zero pages, verified zero claims, and answered "no verified team-news update
// was established". These are publishers with mastheads and corrections
// policies, not an open door: an unknown host is still `other` and still
// unfetched.
export const REPUTABLE_EVIDENCE_DOMAINS = [
  // Wires and broadcasters.
  "espn.com", "espn.co.uk", "bbc.com", "bbc.co.uk", "reuters.com", "apnews.com",
  "theathletic.com", "skysports.com", "talksport.com", "cbssports.com", "nbcsports.com",
  // National press that breaks and follows team news.
  "theguardian.com", "telegraph.co.uk", "independent.co.uk", "standard.co.uk",
  "thetimes.co.uk", "mirror.co.uk", "nytimes.com",
  // Football specialists.
  "goal.com", "90min.com", "football365.com", "sportsmole.co.uk", "fourfourtwo.com",
  "premierinjuries.com", "physioroom.com",
  // Local beats, which carry a club's lineup news first.
  "football.london", "manchestereveningnews.co.uk", "liverpoolecho.co.uk",
  "birminghammail.co.uk", "chroniclelive.co.uk", "hulldailymail.co.uk",
] as const;

function evidenceHostname(rawUrl: string): string | null {
  try {
    return new URL(rawUrl).hostname.toLocaleLowerCase();
  } catch {
    return null;
  }
}

function hostnameMatchesDomain(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function matchesDomainList(hostname: string, domains: readonly string[]): boolean {
  return domains.some((domain) => hostnameMatchesDomain(hostname, domain));
}

export function evidenceTier(rawUrl: string): EvidenceTier {
  const hostname = evidenceHostname(rawUrl);
  if (!hostname) return "other";
  if (matchesDomainList(hostname, OFFICIAL_EVIDENCE_DOMAINS)) return "official";
  if (matchesDomainList(hostname, ANALYTICS_EVIDENCE_DOMAINS)) return "analytics";
  if (matchesDomainList(hostname, REPUTABLE_EVIDENCE_DOMAINS)) return "news";
  return "other";
}

/** Backward-compatible authority: official stays official; analytics and news map to reputable. */
export function evidenceAuthority(rawUrl: string): EvidenceAuthority {
  const tier = evidenceTier(rawUrl);
  if (tier === "official") return "official";
  if (tier === "analytics" || tier === "news") return "reputable";
  return "other";
}
