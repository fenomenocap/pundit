import { test, expect, type Page } from "@playwright/test";

async function routeDeskSlate(page: Page) {
  const fixtures = [
    { fixtureId: 901, home: "Arsenal", away: "Chelsea", pHome: 0.5, pDraw: 0.25, pAway: 0.25 },
  ];
  await page.route("**/api/model/active", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ fixtures: fixtures.map((fixture) => ({
      competitionId: "eng.1",
      utcDate: "2099-09-20T19:00:00.000Z",
      homeElo: 1900,
      awayElo: 1800,
      pOver2_5: 0.52,
      pBttsYes: 0.5,
      oddsSources: [],
      ...fixture,
    })) }),
  }));
  await page.route("**/api/matches/active", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ fixtures: fixtures.map((fixture) => ({
      id: fixture.fixtureId,
      competitionId: "eng.1",
      homeTeam: fixture.home,
      awayTeam: fixture.away,
      utcDate: "2099-09-20T19:00:00.000Z",
      status: "SCHEDULED",
    })) }),
  }));
}

test.describe("take=v2 opt-in header", () => {
  test("desk client sends x-pundit-take with ?take=v2", async ({ page }) => {
    await routeDeskSlate(page);
    let askHeaders: Record<string, string> = {};
    await page.route("**/api/ask", async (route) => {
      askHeaders = route.request().headers();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ answer: "Header check ok.", grounding: null }),
      });
    });
    await page.goto("/?take=v2");
    await page.getByRole("textbox", { name: "Ask a question" }).fill("Who wins?");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByText("Header check ok.", { exact: true })).toBeVisible();
    expect(askHeaders["x-pundit-take"]).toBe("v2");
  });

  test("desk client omits header without take=v2", async ({ page }) => {
    await routeDeskSlate(page);
    let askHeaders: Record<string, string> = {};
    await page.route("**/api/ask", async (route) => {
      askHeaders = route.request().headers();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ answer: "No header.", grounding: null }),
      });
    });
    await page.goto("/");
    await page.getByRole("textbox", { name: "Ask a question" }).fill("Who wins?");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByText("No header.", { exact: true })).toBeVisible();
    expect(askHeaders["x-pundit-take"]).toBeUndefined();
  });

  test("invalid take query is ignored", async ({ page }) => {
    await routeDeskSlate(page);
    let askHeaders: Record<string, string> = {};
    await page.route("**/api/ask", async (route) => {
      askHeaders = route.request().headers();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ answer: "Ignored.", grounding: null }),
      });
    });
    await page.goto("/?take=banana");
    await page.getByRole("textbox", { name: "Ask a question" }).fill("Who wins?");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByText("Ignored.", { exact: true })).toBeVisible();
    expect(askHeaders["x-pundit-take"]).toBeUndefined();
  });

  test("legacy SSE client sends x-pundit-take with ?take=v2", async ({ page }) => {
    await routeDeskSlate(page);
    let askHeaders: Record<string, string> = {};
    await page.route("**/api/ask", async (route) => {
      askHeaders = route.request().headers();
      const body = route.request().postDataJSON() as { stream?: boolean };
      expect(body.stream).toBe(true);
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: "event: grounding\ndata: {\"grounding\":null}\n\nevent: delta\ndata: {\"text\":\"Stream ok.\"}\n\nevent: done\ndata: {\"answer\":\"Stream ok.\",\"grounding\":null,\"verification\":{\"status\":\"not-required\",\"supportedClaimCount\":0,\"removedClaimCount\":0}}\n\n",
      });
    });
    await page.goto("/legacy?take=v2");
    await page.getByPlaceholder("Ask about a match or the Premier League table").fill("Who wins Arsenal v Chelsea?");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByText("Stream ok.", { exact: true })).toBeVisible();
    expect(askHeaders["x-pundit-take"]).toBe("v2");
  });

  test("desk client sends x-pundit-take legacy with ?take=legacy and keeps it", async ({ page }) => {
    await routeDeskSlate(page);
    const seen: string[] = [];
    await page.route("**/api/ask", async (route) => {
      seen.push(route.request().headers()["x-pundit-take"] ?? "");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ answer: "Legacy header.", grounding: null }),
      });
    });
    await page.goto("/?take=legacy");
    await page.getByRole("textbox", { name: "Ask a question" }).fill("Who wins?");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByText("Legacy header.", { exact: true })).toBeVisible();
    await page.goto("/");
    await page.getByRole("textbox", { name: "Ask a question" }).fill("And the draw?");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByText("Legacy header.", { exact: true })).toBeVisible();
    expect(seen).toEqual(["legacy", "legacy"]);
  });

  test("legacy SSE client sends x-pundit-take legacy with ?take=legacy", async ({ page }) => {
    await routeDeskSlate(page);
    let askHeaders: Record<string, string> = {};
    await page.route("**/api/ask", async (route) => {
      askHeaders = route.request().headers();
      const body = route.request().postDataJSON() as { stream?: boolean };
      expect(body.stream).toBe(true);
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: "event: grounding\ndata: {\"grounding\":null}\n\nevent: delta\ndata: {\"text\":\"Legacy stream.\"}\n\nevent: done\ndata: {\"answer\":\"Legacy stream.\",\"grounding\":null,\"verification\":{\"status\":\"not-required\",\"supportedClaimCount\":0,\"removedClaimCount\":0}}\n\n",
      });
    });
    await page.goto("/legacy?take=legacy");
    await page.getByPlaceholder("Ask about a match or the Premier League table").fill("Who wins Arsenal v Chelsea?");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByText("Legacy stream.", { exact: true })).toBeVisible();
    expect(askHeaders["x-pundit-take"]).toBe("legacy");
  });
});
