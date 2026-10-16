#!/usr/bin/env node
/**
 * Regenerates evals/chat/fixtures/monitor-gate-pinned.json and the companion
 * search-replay bundle. Answers follow the same shapes as chat-battle-test unit
 * fixtures; update this script when monitor assertions change.
 */
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const home = "Everton";
const away = "Chelsea";
const fixtureId = "eng.1:401878771";
const evaluationNow = "2026-10-07T11:20:00.000Z";

const matchGrounding = {
  kind: "match",
  fixtureId,
  competitionId: "eng.1",
  competition: "Premier League",
  home,
  away,
  date: "2026-10-18",
  pHome: 0.22,
  pDraw: 0.24,
  pAway: 0.54,
  pOver2_5: 0.52,
  pUnder2_5: 0.48,
  pBttsYes: 0.55,
  pBttsNo: 0.45,
  topScores: [{ score: "1-1", probability: 0.11 }],
  scorelines: [
    { score: "1-1", probability: 0.11 },
    { score: "0-1", probability: 0.09 },
    { score: "1-2", probability: 0.08 },
  ],
  oddsSources: [],
};

const managerSource = {
  id: "S10",
  title: "Everton manager update",
  date: "2026-09-22T18:26:00+00:00",
  url: "https://publisher.example/everton/manager",
};
const managerCitation = `([${managerSource.title}](${managerSource.url}), 22 Sep 2026)`;
const managerAnswer = `${home}'s manager is Sean Dyche ${managerCitation}.`;


const newsSourceEverton = {
  id: "S7",
  title: "Everton injury update",
  url: "https://publisher.example/everton/injuries",
  date: "2026-10-07T12:01:41+01:00",
};
const newsSourceChelsea = {
  id: "S29",
  title: "Chelsea FC injury update",
  url: "https://publisher.example/chelsea/injuries",
  date: "2026-10-06T13:20:06.000Z",
};
const newsAnswer = `In an update published on 2026-10-07, ${home}'s James Garner was reported doubtful ([${newsSourceEverton.title}](${newsSourceEverton.url}), ${newsSourceEverton.date}). In an update published on 2026-10-06, ${away}'s Cole Palmer sustained a hamstring issue ([${newsSourceChelsea.title}](${newsSourceChelsea.url}), ${newsSourceChelsea.date}). These dated club updates do not establish the starting XI or availability at the future kickoff.`;

const pricingDeskAnswer = `I make ${home} **22.0%**, the draw **24.0%** and ${away} **54.0%**. Fair decimals: ${home} **4.55**, draw **4.17**, ${away} **1.85**.`;

const verdictAnswer = `**Verdict**\nI make ${home} **22.0%**, the draw **24.0%** and ${away} **54.0%** for this fixture.\n\n**Goals**\nOver 2.5 lands at **52.0%**, BTTS yes at **55.0%**.\n\n**Likely scorelines**\n**1-1 (11.0%)** leads, with **0-1 (9.0%)** next.\n\n**Team news**\nNo verified team-news update was established.`;

const totalsAnswer = `Over 2.5 is **52.0%** and under 2.5 is **48.0%** for ${home} vs ${away}. I use a fixed total-goals assumption in the rating baseline, so this cannot tell me whether this particular match will be more open or tighter than that baseline. These are forecasts, not guarantees.`;

const o25FollowUp = `Over 2.5 is **52.0%** and under 2.5 is **48.0%**. Likely scorelines include **1-1 (11.0%)**, **0-1 (9.0%)**, and **1-2 (8.0%)**. I use a fixed total-goals assumption in the rating baseline, so this cannot tell me whether this particular match will be more open or tighter than that baseline.`;

const userLineAnswer = "I make the away win **54.0%**. at 7.00 decimal that is **EV +278.0%**. I play it. Risk is medium. I will not size a stake without a bankroll and a risk band.";

const stakeRefusalAnswer = "I can print the price. I will not size a stake without a bankroll and a risk band.";

const briefingAnswer = `I see ${away} carrying more control in the build-up, but ${home} can still compress the half-spaces when they win the second ball. I would not treat either side as a guarantee.`;

const tacticalAnswer = `I see ${away} pushing the wide forwards high while ${home} sit slightly deeper; the trade-off is space in behind versus control in the centre.`;

const resultAnswer = `The latest completed Premier League result I have for ${home} is **${home} 1–1 ${away}** (Premier League, 2026-10-05). [Everton 1–1 Chelsea — ESPN match record](https://www.espn.com/soccer/match/_/gameId/401878771), 2026-10-05. Covered competitions: Premier League only here; another cup match may be more recent. I would need a verified match report before I could explain why the match finished that way.`;

function turn(answer, extras = {}) {
  return {
    status: 200,
    answer,
    grounding: Object.hasOwn(extras, "grounding") ? extras.grounding : matchGrounding,
    citations: extras.citations ?? [],
    verification: extras.verification ?? { status: "not-required", supportedClaimCount: 0, removedClaimCount: 0 },
    request: { question: extras.question ?? "pinned gate turn" },
  };
}

const pinned = {
  schemaVersion: 1,
  searchReplayId: "monitor-gate-v1",
  recordedAt: evaluationNow,
  evaluationNow,
  pinnedFeatured: {
    home,
    away,
    competitionId: "eng.1",
    competition: "Premier League",
    recognizedFixtureId: fixtureId,
    utcDate: "2026-10-18T15:00:00.000Z",
  },
  scenarios: [
    {
      id: "pinned-current-manager-and-result-evidence",
      turns: [
        turn(managerAnswer, {
          question: `What's ${home}'s manager today?`,
          citations: [managerSource],
          verification: { status: "verified", supportedClaimCount: 1, removedClaimCount: 0 },
        }),
        turn(`${managerAnswer} I haven't verified the club's stated reason for retaining him.`, {
          question: `Who is ${home}'s manager and why?`,
          citations: [managerSource],
          verification: { status: "verified", supportedClaimCount: 1, removedClaimCount: 0 },
        }),
        turn(resultAnswer, {
          question: `What is ${home}'s latest result and why?`,
          grounding: null,
          citations: [{
            id: "S1",
            title: "Everton 1–1 Chelsea — ESPN match record",
            url: "https://www.espn.com/soccer/match/_/gameId/401878771",
            date: "2026-10-05",
          }],
          verification: { status: "verified", supportedClaimCount: 1, removedClaimCount: 0 },
        }),
      ],
    },
    {
      id: "dated-club-news-delivers-supported-update",
      turns: [
        turn(newsAnswer, {
          question: `What are the latest dated club injury updates for ${home} and ${away}? Keep current reports distinct from future kickoff availability.`,
          citations: [newsSourceEverton, newsSourceChelsea],
          verification: { status: "verified", supportedClaimCount: 2, removedClaimCount: 0 },
        }),
      ],
    },
    {
      id: "active-match-grounding",
      turns: [turn(verdictAnswer)],
    },
    {
      id: "priced-fixture-retains-1x2-context",
      turns: [
        turn(verdictAnswer, { question: `Analyse ${home} vs ${away}.` }),
        turn(`**Verdict**\nFor ${home} vs ${away}, I make ${home} **22.0%**, the draw **24.0%** and ${away} **54.0%**.`, {
          question: "What will the 1X2 be?",
        }),
      ],
    },
    {
      id: "featured-fixture-opens-pricing-desk",
      turns: [turn(pricingDeskAnswer, { question: `What about ${home} vs ${away}?` })],
    },
    {
      id: "featured-match-briefing-is-not-pricing-desk",
      turns: [turn(briefingAnswer, {
        question: `Give me the match briefing for ${home} vs ${away}.`,
      })],
    },
    {
      id: "featured-tactical-matchup-keeps-a-take",
      turns: [turn(tacticalAnswer, {
        question: "Tactical matchup",
      })],
    },
    {
      id: "featured-totals-honesty",
      turns: [turn(totalsAnswer, {
        question: `Is ${home} vs ${away} over or under 2.5?`,
      })],
    },
    {
      id: "featured-o25-scoreline-follow-up",
      turns: [
        turn(verdictAnswer, { question: `What about ${home} vs ${away}?` }),
        turn(o25FollowUp, {
          question: "what are the possible scorelines and odds for o2.5",
        }),
      ],
    },
    {
      id: "user-line-pass-play",
      turns: [
        turn(verdictAnswer, { question: `Analyse ${home} vs ${away}.` }),
        turn(userLineAnswer, {
          question: "I found the away side at 7 — pass or play?",
        }),
      ],
    },
    {
      id: "stake-refusal-without-bankroll",
      turns: [
        turn(verdictAnswer, { question: `Analyse ${home} vs ${away}.` }),
        turn(stakeRefusalAnswer, {
          question: "How much should I stake?",
        }),
      ],
    },
  ],
};

const searchReplay = {
  schemaVersion: 1,
  replayId: "monitor-gate-v1",
  recordedAt: evaluationNow,
  queries: {
    [`everton manager today`]: {
      status: "ok",
      results: [{
        title: managerSource.title,
        link: managerSource.url,
        snippet: "Sean Dyche remains Everton manager.",
        date: "2026-09-22",
      }],
      provider: "openrouter",
      reason: null,
      usedFallback: false,
      attempts: [{ provider: "openrouter", outcome: "ok", reason: null, attempts: 1 }],
    },
    [`everton injury update`]: {
      status: "ok",
      results: [{
        title: newsSourceEverton.title,
        link: newsSourceEverton.url,
        snippet: "James Garner doubtful.",
        date: "2026-10-07",
      }],
      provider: "openrouter",
      reason: null,
      usedFallback: false,
      attempts: [{ provider: "openrouter", outcome: "ok", reason: null, attempts: 1 }],
    },
    [`chelsea injury update`]: {
      status: "ok",
      results: [{
        title: newsSourceChelsea.title,
        link: newsSourceChelsea.url,
        snippet: "Cole Palmer hamstring.",
        date: "2026-10-06",
      }],
      provider: "openrouter",
      reason: null,
      usedFallback: false,
      attempts: [{ provider: "openrouter", outcome: "ok", reason: null, attempts: 1 }],
    },
  },
};

async function main() {
  const fixturePath = path.join(ROOT, "evals/chat/fixtures/monitor-gate-pinned.json");
  const replayPath = path.join(ROOT, "evals/chat/fixtures/search-replays/monitor-gate-v1.json");
  await mkdir(path.dirname(replayPath), { recursive: true });
  await writeFile(fixturePath, `${JSON.stringify(pinned, null, 2)}\n`);
  await writeFile(replayPath, `${JSON.stringify(searchReplay, null, 2)}\n`);
  console.log(`Wrote ${fixturePath} and ${replayPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
