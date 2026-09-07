import Anthropic from "@anthropic-ai/sdk";
import type { ConversationTurn, Grounding } from "./ask";
import { managerForClub, stripUnlistedManagers } from "./pl-managers";

const DESK_SYSTEM = `You are Pundit, a football analyst covering the 2026/27 Premier League. Voice: sharp broadcast pundit — Carragher after a freeze-frame, not a hedge-fund memo. Short. Specific. Numbered when listing. No emoji. No slang pile-up. No hedging fluff. Put a number on it.

You are not a bookmaker and you do not take stakes. Never invite a bet. Never say "back this", "place this", "the ticket", or "clear the play price". Never discuss staking, parlays, or how to beat a sportsbook. Never print EV%. Never say fat-and-fragile. Never ask the user for a decimal line.

Frame: analysis and a model view. "Pass or play" means: is the lean real, and is the board fat or thin versus Polymarket. Lead with the football, then the 1X2. Say "the model leans X" — not "play X".

Ground every take in the attached match card. If a fact is not in the card, say you don't have it. Do not invent injuries, lineups, or scores.

Managers: only name a coach if they appear on the DUGOUT line of the card. The 2026/27 dugouts turned over — Amorim is not at United, Guardiola is not at City, Slot is not at Liverpool. Do not recite last season's coaches. If DUGOUT is missing, talk about the side, not the person in the technical area.

1X2 and BTTS on the card come from the live ClubElo Dixon–Coles engine — treat them as sealed. Totals sit near 50% on the engine because every match uses the same 2.70 expected goals — do not treat Over 2.5 as a real view unless the card labels a desk reconstruction. Polymarket is a comparison market, not a player ranking.

If asked who scores: do not cite undated betting-site quotes as a Pundit ranking. If the card has no player heat, say you don't have a player model and name the side more likely to score from xG / BTTS / modal score.

2–6 tight paragraphs, or a short numbered take. First line should earn the rest.`;

function pct(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(0)}%`;
}

function dugoutLine(g: Grounding): string {
  const home = managerForClub(g.home);
  const away = managerForClub(g.away);
  if (!home && !away) {
    return "DUGOUT: not on this card. Do not name a manager or coach.";
  }
  const bits = [
    home ? `${g.home}: ${home.manager}` : `${g.home}: manager unknown — do not guess`,
    away ? `${g.away}: ${away.manager}` : `${g.away}: manager unknown — do not guess`,
  ];
  return `DUGOUT (2026/27): ${bits.join(" · ")}.`;
}

export function card(g: Grounding) {
  const poly = g.oddsSources?.find((s) => s.source === "polymarket");
  const top = g.topScores?.slice(0, 3).map((s) => `${s.score} ${(s.probability * 100).toFixed(0)}%`).join(", ");
  const div = g.marketDivergence?.[0];
  return [
    `FOCUS: ${g.home} vs ${g.away}. ${g.competition}. ${g.date}. HFA ${g.homeFieldAdvantage ? "on" : "off"}.`,
    dugoutLine(g),
    `Model 1X2 ${pct(g.pHome)} / ${pct(g.pDraw)} / ${pct(g.pAway)}.`,
    `Engine O2.5 ${pct(g.pOver2_5)} · U2.5 ${pct(g.pUnder2_5)} · BTTS ${pct(g.pBttsYes)}.`,
    top ? `Top scores: ${top}.` : "",
    poly
      ? `Polymarket implied 1X2 ${pct(poly.pHome)} / ${pct(poly.pDraw)} / ${pct(poly.pAway)}.`
      : "No Polymarket line on the card.",
    div
      ? `Largest gap vs ${div.source}: ${div.largest.label} model ${div.largest.modelPercent}% vs market ${div.largest.marketPercent}% (${div.largest.gapPoints > 0 ? "+" : ""}${div.largest.gapPoints} pts).`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function hint(question: string) {
  const q = question.toLowerCase();
  if (/\bpass or play\b|\bprice this\b|\bev\b|\bfair (?:price|odds)\b/.test(q)) {
    return "HINT: Model-view question. Football first, then 1X2. Do not ask for a decimal. Do not print EV%.";
  }
  if (/\bwho scores\b|\bscorer\b|\banytime\b|\bfirst goal\b/.test(q)) {
    return "HINT: No player model on this card. Do not cite betting-site quotes. Use xG, BTTS, modal score, and which side is more likely to score.";
  }
  if (/\bmanager\b|\bcoach\b|\btactic/.test(q)) {
    return "HINT: Use only the DUGOUT line. Do not name last season's coaches.";
  }
  return "";
}

function allowedManagers(g: Grounding): string[] {
  return [managerForClub(g.home)?.manager, managerForClub(g.away)?.manager].filter(
    (n): n is string => Boolean(n),
  );
}

function inferenceKey() {
  return process.env.MINIMAX_INFERENCE_API_KEY || process.env.MINIMAX_API_KEY;
}

function inferenceBase() {
  return process.env.MINIMAX_INFERENCE_BASE_URL
    ?? process.env.MINIMAX_BASE_URL
    ?? "https://api.minimax.io/anthropic";
}

export async function writeDeskProse(
  question: string,
  grounding: Grounding,
  history: ConversationTurn[],
  signal?: AbortSignal
): Promise<string | null> {
  const apiKey = inferenceKey();
  if (!apiKey) return null;
  const client = new Anthropic({ apiKey, baseURL: inferenceBase(), maxRetries: 0 });
  const model = process.env.MINIMAX_MODEL ?? "MiniMax-M3";
  const convo: Anthropic.MessageParam[] = [
    ...history.slice(-8).map((t) => ({
      role: t.role,
      content: t.content.slice(0, 1200),
    })),
    {
      role: "user",
      content: [card(grounding), hint(question), `Question: ${question}`].filter(Boolean).join("\n\n"),
    },
  ];
  try {
    const msg = await client.messages.create(
      {
        model,
        max_tokens: 700,
        temperature: 0.45,
        system: DESK_SYSTEM,
        messages: convo,
      },
      { timeout: 45_000, signal }
    );
    const text = msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    if (!text) return null;
    return stripUnlistedManagers(text, allowedManagers(grounding)) || text;
  } catch {
    return null;
  }
}
