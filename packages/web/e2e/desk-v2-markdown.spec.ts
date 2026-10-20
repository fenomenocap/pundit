import { test, expect, type Page } from "@playwright/test";

/** Representative v2 take answer (1X2 table + newline footer). */
export const V2_TAKE_ANSWER_FIXTURE = `Spurs v Coventry — Spurs at 59.9%.

I expect a tight match with chances at both ends.

| Outcome | Ours | Kalshi | Poly | Best |
| --- | --- | --- | --- | --- |
| Home | 59.9% | 62% | 61% | 61% |
| Draw | 24.4% | 22% | 23% | 23% |
| Away | 15.7% | 16% | 16% | 16% |

Model unknown (priced 18 Oct 17:30 SGT).
Kalshi as of 18 Oct 12:00 SGT.
Polymarket as of 18 Oct 12:00 SGT.`;

async function routeDeskSlate(page: Page) {
  await page.route("**/api/model/active", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ fixtures: [{
      fixtureId: 901,
      competitionId: "eng.1",
      utcDate: "2099-09-20T19:00:00.000Z",
      home: "Arsenal",
      away: "Chelsea",
      homeElo: 1900,
      awayElo: 1800,
      pHome: 0.5,
      pDraw: 0.25,
      pAway: 0.25,
      pOver2_5: 0.52,
      pBttsYes: 0.5,
      oddsSources: [],
    }] }),
  }));
  await page.route("**/api/matches/active", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ fixtures: [{
      id: 901,
      competitionId: "eng.1",
      homeTeam: "Arsenal",
      awayTeam: "Chelsea",
      utcDate: "2099-09-20T19:00:00.000Z",
      status: "SCHEDULED",
    }] }),
  }));
}

test.describe("desk v2 take markdown rendering", () => {
  test("?take=v2 renders GFM table and split footer lines", async ({ page }, testInfo) => {
    await routeDeskSlate(page);
    await page.route("**/api/ask", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ answer: V2_TAKE_ANSWER_FIXTURE, grounding: null }),
    }));
    await page.goto("/?take=v2");
    await page.getByRole("textbox", { name: "Ask a question" }).fill("Who wins?");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    const bubble = page.getByTestId("desk-pundit-bubble");
    await expect(bubble.getByTestId("desk-take-v2-markdown")).toBeVisible();
    const table = bubble.locator("table");
    await expect(table).toBeVisible();
    await expect(table.locator("tr")).toHaveCount(4);
    const footerParas = bubble.locator("[data-testid=desk-take-v2-markdown] p").filter({ hasText: /Model unknown|Kalshi as of|Polymarket as of/ });
    await expect(footerParas).toHaveCount(3);
    await expect(bubble.getByText("| Outcome | Ours |", { exact: false })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("desk-v2-markdown-table.png"), fullPage: false });
  });

  test("without opt-in keeps plain pipe text (no table element)", async ({ page }) => {
    await routeDeskSlate(page);
    await page.route("**/api/ask", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ answer: V2_TAKE_ANSWER_FIXTURE, grounding: null }),
    }));
    await page.goto("/");
    await page.getByRole("textbox", { name: "Ask a question" }).fill("Who wins?");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    const bubble = page.getByTestId("desk-pundit-bubble");
    await expect(bubble.getByTestId("desk-take-v2-markdown")).toHaveCount(0);
    await expect(bubble.locator("table")).toHaveCount(0);
    await expect(bubble.getByText("| Outcome | Ours | Kalshi | Poly | Best |", { exact: false })).toBeVisible();
  });
});
