import { test, expect } from "@playwright/test";

test.describe("smoke", () => {
  test("homepage", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Pundit" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Ask a question" })).toBeVisible();
    await expect(page.getByText("Analysis only — not betting advice")).toBeVisible();
  });

  test("fixtures", async ({ page }) => {
    await page.goto("/fixtures");
    await expect(page.getByRole("heading", { name: "Fixtures" })).toBeVisible();
    await expect(page.getByRole("button", { name: "All" })).toBeVisible();
    await expect(page.locator("span.truncate", { hasText: "Arsenal" }).first()).toBeVisible();
  });

  test("fixtures stay chronological and expose canonical capability", async ({ page }) => {
    await page.goto("/fixtures");
    const rows = page.getByTestId("fixture-row");
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toHaveAttribute("data-fixture-id", "eng.1-3");
    await expect(rows.nth(1)).toHaveAttribute("data-fixture-id", "eng.1-1");
    await expect(rows.nth(2)).toHaveAttribute("data-fixture-id", "uefa.champions_qual-2");
    await expect(rows.nth(1).getByText("Forecast ready", { exact: true })).toBeVisible();
    await expect(rows.nth(1).getByText("My forecast", { exact: true })).toBeVisible();
    await expect(rows.nth(1).getByText("Polymarket", { exact: false })).toBeVisible();
    await expect(rows.nth(1).getByText("68.0%", { exact: true })).toBeVisible();
    const forecastTable = rows.nth(1).getByRole("table", { name: /forecast and market probabilities/i });
    await expect(forecastTable.getByRole("columnheader", { name: "Home" })).toBeVisible();
    await expect(forecastTable.getByRole("columnheader", { name: "Draw" })).toBeVisible();
    await expect(forecastTable.getByRole("columnheader", { name: "Away" })).toBeVisible();
    await expect(forecastTable.locator("time")).toBeVisible();
    await expect(rows.nth(2).getByText("Required forecast input missing", { exact: true })).toBeVisible();
  });

  test("model", async ({ page }) => {
    await page.goto("/model");
    await expect(page.getByRole("heading", { name: "Club season model" })).toBeVisible();
    const table = page.locator("table");
    const emptyState = page.getByText("No upcoming fixtures in the next 14 days");
    await expect(table.or(emptyState)).toBeVisible({ timeout: 15_000 });
  });

  test("model labels live and full-time instead of Upcoming", async ({ page }) => {
    await page.goto("/model");
    const chelsea = page.locator("tr").filter({ hasText: "Chelsea · Tottenham Hotspur" });
    await expect(chelsea).toBeVisible();
    await expect(chelsea.getByTestId("model-fixture-status")).toHaveText(/Live/);
    await expect(chelsea.getByTestId("model-fixture-status")).not.toHaveText(/Upcoming/);

    const united = page.locator("tr").filter({ hasText: "Manchester United · Hull City" });
    await expect(united).toBeVisible();
    await expect(united.getByTestId("model-fixture-status")).toHaveText(/Full time/);
    await expect(united.getByTestId("model-fixture-status")).not.toHaveText(/Upcoming/);

    const arsenal = page.locator("tr").filter({ hasText: "Arsenal · Coventry City" });
    await expect(arsenal.getByTestId("model-fixture-status")).toHaveText(/Upcoming/);
  });

  test("model expanded row shows cached market comparison", async ({ page }) => {
    await page.goto("/model");
    const arsenal = page.locator("tr").filter({ hasText: "Arsenal · Coventry City" });
    await expect(arsenal).toBeVisible();
    await arsenal.getByRole("button", { name: "Expand details" }).click();
    await expect(page.getByTestId("totals-honesty")).toHaveText(
      "Totals sit near 50% because every match uses the same 2.70 expected goals."
    );
    await expect(page.getByText("Markets", { exact: true })).toBeVisible();
    await expect(page.getByText("Polymarket", { exact: true })).toBeVisible();
    await expect(page.locator('[title*="T"]').filter({ hasText: /./ }).first()).toBeVisible();
    await expect(page.getByText("68.0%")).toBeVisible();
    await expect(page.getByText("Stake", { exact: true })).toHaveCount(0);
  });

  for (const viewport of [
    { name: "desktop", width: 1280, height: 900 },
    { name: "mobile", width: 390, height: 844 },
  ]) {
    test(`desk chat sends a pinned take on ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const requests: Array<Record<string, unknown>> = [];
      await page.route("**/api/ask", async (route) => {
        requests.push(route.request().postDataJSON());
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            answer: "The model leans Arsenal. Home 72, draw 18, away 10.",
            grounding: { kind: "match", home: "Arsenal", away: "Coventry City" },
            presentation: { responseMode: "match-preview", fixtureCard: "expanded" },
          }),
        });
      });
      await page.goto("/");
      const input = page.getByRole("textbox", { name: "Ask a question" });
      await input.fill("Preview Arsenal vs Coventry City");
      await page.getByRole("button", { name: "Send" }).click();
      await expect(page.getByText("The model leans Arsenal. Home 72, draw 18, away 10.")).toBeVisible();
      expect(requests[0].voice).toBe("desk");
      expect(requests[0].stream).toBe(false);
    });
  }

  test("fixture and model Ask links retain their rendered fixture identity", async ({ page }) => {
    await page.goto("/fixtures");
    const fixtureCard = page.getByText("Riga FC", { exact: true }).first()
      .locator("xpath=ancestor::div[contains(@class, 'relative')][1]");
    const fixturesAsk = fixtureCard.getByRole("link", { name: "Ask about this match" });
    await expect(fixturesAsk).toBeVisible();
    const fixturesHref = await fixturesAsk.getAttribute("href");
    expect(new URL(fixturesHref!, "http://127.0.0.1:3000").searchParams.get("q"))
      .toBe("Riga FC vs Ararat-Armenia");
    expect(new URL(fixturesHref!, "http://127.0.0.1:3000").searchParams.get("fixture"))
      .toBe("espn:uefa.champions_qual:2");

    await page.goto("/model");
    const secondLeg = page.locator("tr").filter({ hasText: "Viking · Dinamo Zagreb" });
    const modelAsk = secondLeg.getByRole("link", { name: "Ask" });
    await expect(modelAsk).toBeVisible();
    const modelHref = await modelAsk.getAttribute("href");
    expect(new URL(modelHref!, "http://127.0.0.1:3000").searchParams.get("q"))
      .toBe("Viking vs Dinamo Zagreb");
    expect(new URL(modelHref!, "http://127.0.0.1:3000").searchParams.get("fixture"))
      .toBe("espn:uefa.champions_qual:4");
  });

  test("club-season evaluation", async ({ page }) => {
    await page.goto("/evaluation/club-season");
    await expect(page.getByRole("heading", { name: "Club season calibration" })).toBeVisible();
    // The page header repeats each label in an eyebrow line and a status badge,
    // so a substring match is ambiguous under strict mode. The badge is the
    // assertion this test intends.
    await expect(page.getByText("Rolling snapshots", { exact: true })).toBeVisible();
    const metrics = page.getByText("Brier score (1X2)");
    const disclaimer = page.getByText("Pre-kickoff probabilities captured");
    const zeroSample = page.getByText("No finished forecasts yet", { exact: false });
    await expect(metrics.or(disclaimer).or(zeroSample)).toBeVisible({ timeout: 15_000 });
  });

  test("wc-2026 evaluation", async ({ page }) => {
    await page.goto("/evaluation/wc-2026");
    await expect(page.getByRole("heading", { name: "World Cup 2026 backtest" })).toBeVisible();
    await expect(page.getByText("Frozen evaluation", { exact: true })).toBeVisible();
    await expect(page.getByText("Reconstructed pre-kickoff", { exact: true })).toBeVisible();
  });

  // The server's 400 copy is normally replaced with generic "try rephrasing"
  // text, so a better message alone never reached the user. MULTIPLE_FIXTURES
  // is the exception: it names the real fixtures the question contained, and
  // this asserts that whole path end to end.
  test("multi-matchup question shows the fixtures the server named", async ({ page }) => {
    await page.route("**/api/ask", (route) => route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({
        error: "I can analyse one match at a time — did you mean Arsenal vs Liverpool, or Chelsea vs Manchester City?",
        code: "MULTIPLE_FIXTURES",
      }),
    }));

    await page.goto("/legacy");
    await page.getByRole("textbox", { name: "Ask a question" })
      .fill("Compare Arsenal vs Liverpool and Chelsea vs Manchester City");
    await page.getByRole("button", { name: "Send" }).click();

    // Next.js renders its own empty route-announcer alert, so scope to the
    // chat's error bubble rather than every alert on the page.
    await expect(page.getByRole("alert").first()).toContainText(
      "did you mean Arsenal vs Liverpool, or Chelsea vs Manchester City?"
    );
  });

  test("search citation is clickable and provenance-bound after authoritative done", async ({ page }) => {
    const url = "https://example.com/club-update";
    const answer = `Player is available ([Club update](${url}), 2026-08-12).`;
    const sse = [
      `event: grounding\ndata: ${JSON.stringify({ grounding: null })}`,
      `event: delta\ndata: ${JSON.stringify({ text: answer })}`,
      `event: done\ndata: ${JSON.stringify({
        answer,
        grounding: null,
        citations: [{ id: "S1", title: "Club update", url, date: "2026-08-12" }],
      })}`,
      "",
    ].join("\n\n");
    await page.route("**/api/ask", (route) => route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: sse,
    }));

    await page.goto("/legacy");
    await page.getByRole("textbox", { name: "Ask a question" }).fill("Latest availability news?");
    await page.getByRole("button", { name: "Send" }).click();
    const citation = page.getByRole("link", { name: "Club update" });
    await expect(citation).toHaveAttribute("href", url);
    await expect(citation).toHaveAttribute("target", "_blank");
    await expect(citation).toHaveAttribute("rel", /noopener noreferrer nofollow/);
    await expect(page.getByText("[[S1]]")).not.toBeVisible();
  });

  test("recognized outside-coverage fixture keeps typed context across a table detour", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "share", {
        configurable: true,
        value: async (data: { url?: string }) => {
          (window as Window & { __sharedUrl?: string }).__sharedUrl = data.url;
        },
      });
    });
    const fixture = {
      fixtureId: "espn:club.friendly:991",
      primarySource: "espn",
      primarySourceFixtureId: "991",
      homeTeam: { id: "arsenal", name: "Arsenal" },
      awayTeam: { id: "liverpool", name: "Liverpool" },
      kickoff: "2026-08-18T19:00:00.000Z",
      venue: "National Stadium",
      neutralVenue: true,
      competition: { id: "club.friendly", name: "Club Friendly", category: "club-friendly" },
      status: "scheduled",
      recognition: "authoritative",
    };
    const received: Array<Record<string, unknown>> = [];
    let turn = 0;
    await page.route("**/api/ask", async (route) => {
      received.push(route.request().postDataJSON());
      const grounding = turn === 1
        ? {
            kind: "competition",
            competitionId: "eng.1",
            competition: "Premier League",
            updatedAt: "2026-08-13T00:00:00.000Z",
            standings: [],
          }
        : {
            kind: "fixture",
            fixture,
            capability: { status: "outside-coverage", reason: "friendly-policy-disabled" },
          };
      const answer = turn === 1 ? "Here is the table." : "No Pundit probabilities are available.";
      turn += 1;
      const sse = [
        `event: grounding\ndata: ${JSON.stringify({ grounding })}`,
        `event: delta\ndata: ${JSON.stringify({ text: answer })}`,
        `event: done\ndata: ${JSON.stringify({ answer, grounding })}`,
        "",
      ].join("\n\n");
      await route.fulfill({ status: 200, contentType: "text/event-stream", body: sse });
    });

    await page.goto("/legacy");
    const input = page.getByRole("textbox", { name: "Ask a question" });
    await input.fill("Arsenal vs Liverpool friendly");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(/Club Friendly · Outside forecast coverage · friendly policy/i)).toBeVisible();
    await expect(page.getByText("Following: Arsenal vs Liverpool").first()).toBeVisible();

    await input.fill("How does the Premier League table look?");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(/Premier League · ESPN table/i)).toBeVisible();

    await input.fill("What about that match?");
    await page.getByRole("button", { name: "Send" }).click();
    await expect.poll(() => received.length).toBe(3);
    expect(received[1].fixtureContext).toEqual({ fixtureId: fixture.fixtureId });
    expect(received[2].fixtureContext).toEqual({ fixtureId: fixture.fixtureId });

    await expect(page.getByRole("button", { name: "Share" })).toHaveCount(3);
    await page.getByRole("button", { name: "Share" }).last().click();
    await expect.poll(() => page.evaluate(
      () => (window as Window & { __sharedUrl?: string }).__sharedUrl
    )).toBeTruthy();
    const sharedUrl = await page.evaluate(
      () => (window as Window & { __sharedUrl?: string }).__sharedUrl
    );
    const sharedUrlParams = new URL(sharedUrl!).searchParams;
    expect(sharedUrlParams.get("q")).toBe("What about that match?");
    expect(sharedUrlParams.get("fixture")).toBe(fixture.fixtureId);
  });

  // A suggestion chip is the product's default entry point, and its label
  // ("X vs Y · UCL · Tue") reads the same for both legs of a two-legged tie.
  // The click has to carry the identity of the fixture it rendered, or the API
  // is left guessing which leg was meant -- which is how every default chip
  // ended up on the ungrounded discovery-candidate path.
  test("suggestion chip sends the fixture identity it was rendered from", async ({ page }) => {
    const received: Array<Record<string, unknown>> = [];
    await page.route("**/api/ask", async (route) => {
      received.push(route.request().postDataJSON());
      const answer = "Here is the read.";
      const sse = [
        `event: grounding\ndata: ${JSON.stringify({ grounding: null })}`,
        `event: delta\ndata: ${JSON.stringify({ text: answer })}`,
        `event: done\ndata: ${JSON.stringify({ answer, grounding: null })}`,
        "",
      ].join("\n\n");
      await route.fulfill({ status: 200, contentType: "text/event-stream", body: sse });
    });

    await page.goto("/legacy");
    const chip = page.getByRole("button", { name: /Dinamo Zagreb vs Viking ·/ });
    await expect(chip).toBeVisible();
    await chip.click();

    await expect.poll(() => received.length).toBe(1);
    expect(received[0].fixtureContext).toEqual({ fixtureId: "espn:uefa.champions_qual:3" });
    expect(received[0].question).toContain("Dinamo Zagreb vs Viking");
    expect(received[0]).not.toHaveProperty("userLine");
  });

  test("empty-state pull chip sends structured userLine on a priced fixture", async ({ page }) => {
    const received: Array<Record<string, unknown>> = [];
    await page.route("**/api/ask", async (route) => {
      received.push(route.request().postDataJSON());
      const answer = "On Coventry City at 7.00 I pass.";
      const sse = [
        `event: grounding\ndata: ${JSON.stringify({ grounding: null })}`,
        `event: delta\ndata: ${JSON.stringify({ text: answer })}`,
        `event: done\ndata: ${JSON.stringify({ answer, grounding: null })}`,
        "",
      ].join("\n\n");
      await route.fulfill({ status: 200, contentType: "text/event-stream", body: sse });
    });

    await page.goto("/legacy");
    const chip = page.getByRole("button", { name: "Pass or play · Arsenal vs Coventry City" });
    await expect(chip).toBeVisible();
    await expect(chip).toHaveAttribute("data-has-user-line", "true");
    await chip.click();

    await expect.poll(() => received.length).toBe(1);
    expect(received[0].question).toBe("Pass or play · Arsenal vs Coventry City");
    expect(received[0].fixtureContext).toEqual({ fixtureId: "espn:eng.1:1" });
    expect(received[0].userLine).toEqual({ outcome: "away", decimalOdds: 7 });
  });

  test("each featured match has a desk chip that writes userLine", async ({ page }) => {
    const received: Array<Record<string, unknown>> = [];
    await page.route("**/api/ask", async (route) => {
      received.push(route.request().postDataJSON());
      const answer = "Here is the desk.";
      const sse = [
        `event: grounding\ndata: ${JSON.stringify({ grounding: null })}`,
        `event: delta\ndata: ${JSON.stringify({ text: answer })}`,
        `event: done\ndata: ${JSON.stringify({ answer, grounding: null })}`,
        "",
      ].join("\n\n");
      await route.fulfill({ status: 200, contentType: "text/event-stream", body: sse });
    });

    await page.goto("/legacy");
    const passChip = page.getByRole("button", { name: "Pass or play · Arsenal vs Coventry City" });
    const priceChip = page.getByRole("button", { name: "Price this · Liverpool vs Brighton & Hove Albion" });
    const dinamoDesk = page.getByRole("button", { name: "Pass or play · Dinamo Zagreb vs Viking" });
    await expect(passChip).toBeVisible();
    await expect(priceChip).toBeVisible();
    await expect(dinamoDesk).toBeVisible();
    await expect(page.locator('[data-testid="suggestion-chip"][data-has-user-line="true"]')).toHaveCount(3);

    await priceChip.click();
    await expect.poll(() => received.length).toBe(1);
    expect(received[0].question).toBe("Price this · Liverpool vs Brighton & Hove Albion");
    expect(received[0].fixtureContext).toEqual({ fixtureId: "espn:eng.1:2" });
    expect(received[0].userLine).toEqual({ outcome: "away", decimalOdds: 7 });
  });

  test("first paint stays loading and does not flash ready fallback chips", async ({ page }) => {
    await page.addInitScript(() => {
      (window as Window & { __PUNDIT_E2E_FIXTURE_STATE__?: string }).__PUNDIT_E2E_FIXTURE_STATE__ = "loading";
    });
    await page.goto("/legacy");
    await expect(page.getByTestId("chat-status")).toHaveText(/Loading match model/i);
    await expect(page.getByTestId("chat-status")).not.toHaveText(/active fixtures live/i);
    await expect(page.getByRole("button", { name: "What does the current Premier League table show?" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Who is favourite for the Premier League title?" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /high defensive line/ })).toHaveCount(0);
    await expect(page.getByTestId("suggestion-chip")).toHaveCount(0);
  });

  test("suggestion chips omit in-play and finished matches", async ({ page }) => {
    await page.goto("/legacy");
    await expect(page.getByRole("button", { name: /Arsenal vs Coventry City ·/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Chelsea vs Tottenham/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Manchester United vs Hull/ })).toHaveCount(0);
  });

  test("shared question URL sends its opaque fixture identity and keeps q-only links compatible", async ({ page }) => {
    const received: Array<Record<string, unknown>> = [];
    await page.route("**/api/ask", async (route) => {
      received.push(route.request().postDataJSON());
      const answer = "Here is the read.";
      const sse = [
        `event: grounding\ndata: ${JSON.stringify({ grounding: null })}`,
        `event: delta\ndata: ${JSON.stringify({ text: answer })}`,
        `event: done\ndata: ${JSON.stringify({ answer, grounding: null })}`,
        "",
      ].join("\n\n");
      await route.fulfill({ status: 200, contentType: "text/event-stream", body: sse });
    });

    await page.goto("/?q=Viking%20vs%20Dinamo%20Zagreb&fixture=espn%3Auefa.champions_qual%3A4");
    await expect.poll(() => received.length).toBe(1);
    expect(received[0].fixtureContext).toEqual({
      fixtureId: "espn:uefa.champions_qual:4",
    });
    expect(received[0].question).toBe("Viking vs Dinamo Zagreb");

    await page.goto("/?q=What%20does%20the%20table%20show%3F");
    await expect.poll(() => received.length).toBe(2);
    expect(received[1]).not.toHaveProperty("fixtureContext");
  });

  test("Stop restores the prompt and does not show a server error", async ({ page }) => {
    await page.route("**/api/ask", async () => {
      await new Promise(() => undefined);
    });

    await page.goto("/legacy");
    const input = page.getByRole("textbox", { name: "Ask a question" });
    await input.fill("What does the current Premier League table show?");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByRole("button", { name: "Stop generating" })).toBeVisible();
    await page.getByRole("button", { name: "Stop generating" }).click();
    await expect(input).toHaveValue("What does the current Premier League table show?");
    await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
    await expect(page.locator('[aria-relevant="additions text"]').getByRole("alert")).toHaveCount(0);
  });

  test("primary nav", async ({ page }) => {
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    await expect(nav.getByRole("link", { name: "Desk" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Fixtures" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Model" })).toBeVisible();
    await expect(nav.getByText("WC Backtest")).not.toBeVisible();
  });

  test("match card prints server EV% only when pricing.evPct exists", async ({ page }) => {
    const grounding = {
      kind: "match",
      fixtureId: "espn:eng.1:1",
      competitionId: "eng.1",
      competition: "Premier League",
      homeFieldAdvantage: true,
      date: "2026-09-01",
      stage: "match",
      home: "Arsenal",
      away: "Coventry City",
      pHome: 0.72,
      pDraw: 0.18,
      pAway: 0.10,
      pOver2_5: 0.55,
      pUnder2_5: 0.45,
      pBttsYes: 0.48,
      pBttsNo: 0.52,
      topScores: [{ score: "2-0", probability: 0.14 }],
      scorelines: [{ score: "2-0", probability: 0.14 }],
      stakePHome: null,
      stakePDraw: null,
      stakePAway: null,
      oddsSources: [{
        source: "polymarket",
        observedAt: "2026-08-30T06:00:00.000Z",
        pHome: 0.68,
        pDraw: 0.20,
        pAway: 0.12,
      }],
      pricing: {
        fixtureId: "espn:eng.1:1",
        home: "Arsenal",
        away: "Coventry City",
        kickoff: "2026-09-01",
        modelVersion: "clubelo@1:test",
        pricedAt: "2026-08-30T06:00:00.000Z",
        model: {
          home: { p: 0.72, fairOdds: 1 / 0.72 },
          draw: { p: 0.18, fairOdds: 1 / 0.18 },
          away: { p: 0.10, fairOdds: 10 },
        },
        markets: [{
          source: "polymarket",
          observedAt: "2026-08-30T06:00:00.000Z",
          edgeBand: "fat-and-fragile",
          legs: {
            home: {
              outcome: "home", modelP: 0.72, fairOdds: 1 / 0.72,
              decimalOdds: 7, impliedP: 1 / 7, evPct: 0.72 * 7 - 1,
            },
            draw: {
              outcome: "draw", modelP: 0.18, fairOdds: 1 / 0.18,
              decimalOdds: null, impliedP: null, evPct: null,
            },
            away: {
              outcome: "away", modelP: 0.10, fairOdds: 10,
              decimalOdds: null, impliedP: null, evPct: null,
            },
          },
        }],
        userLine: null,
        stakeFrac: null,
      },
    };
    const answer = "I make Arsenal the favourite; the printed EV is server-owned.";
    await page.route("**/api/ask", async (route) => {
      const sse = [
        `event: grounding\ndata: ${JSON.stringify({ grounding })}`,
        `event: delta\ndata: ${JSON.stringify({ text: answer })}`,
        `event: done\ndata: ${JSON.stringify({
          answer,
          grounding,
          presentation: { responseMode: "match-preview", fixtureCard: "expanded" },
        })}`,
        "",
      ].join("\n\n");
      await route.fulfill({ status: 200, contentType: "text/event-stream", body: sse });
    });

    await page.goto("/legacy");
    await page.getByRole("textbox", { name: "Ask a question" }).fill("Preview Arsenal vs Coventry City");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByTestId("match-fixture-card")).toBeVisible();
    const ev = page.getByTestId("market-ev-polymarket");
    await expect(ev).toBeVisible();
    await expect(ev).toContainText("fat-and-fragile");
    await expect(ev).toContainText("14.3%");
    await expect(ev).toContainText("+404.0%");
  });

  test("New Chat clears Following and strips a shared question URL", async ({ page }) => {
    const grounding = {
      kind: "match",
      fixtureId: "espn:eng.1:1",
      competitionId: "eng.1",
      competition: "Premier League",
      homeFieldAdvantage: true,
      date: "2026-09-01",
      stage: "match",
      home: "Arsenal",
      away: "Coventry City",
      pHome: 0.72,
      pDraw: 0.18,
      pAway: 0.10,
      pOver2_5: 0.55,
      pUnder2_5: 0.45,
      pBttsYes: 0.48,
      pBttsNo: 0.52,
      topScores: [{ score: "2-0", probability: 0.14 }],
      scorelines: [{ score: "2-0", probability: 0.14 }],
      stakePHome: null,
      stakePDraw: null,
      stakePAway: null,
      oddsSources: [],
    };
    const answer = "I make Arsenal the favourite.";
    await page.route("**/api/ask", async (route) => {
      const sse = [
        `event: grounding\ndata: ${JSON.stringify({ grounding })}`,
        `event: delta\ndata: ${JSON.stringify({ text: answer })}`,
        `event: done\ndata: ${JSON.stringify({
          answer,
          grounding,
          presentation: { responseMode: "match-preview", fixtureCard: "expanded" },
        })}`,
        "",
      ].join("\n\n");
      await route.fulfill({ status: 200, contentType: "text/event-stream", body: sse });
    });

    await page.goto("/?q=Preview%20Arsenal%20vs%20Coventry%20City&fixture=espn%3Aeng.1%3A1");
    await expect(page.getByText("Following: Arsenal vs Coventry City").first()).toBeVisible();
    await page.getByRole("button", { name: "New Chat" }).click();
    await expect(page.getByRole("heading", { name: "Football analysis, grounded." })).toBeVisible();
    await expect(page.getByText("Following:")).toHaveCount(0);
    await expect.poll(() => new URL(page.url()).search).toBe("");
  });

  test("partial model coverage does not claim every fixture is ready", async ({ page }) => {
    await page.addInitScript(() => {
      (window as Window & { __PUNDIT_E2E_FIXTURE_STATE__?: string }).__PUNDIT_E2E_FIXTURE_STATE__ = "partial";
    });
    await page.goto("/legacy");
    await expect(page.getByTestId("chat-status")).toHaveText(
      /Match forecasts ready for some fixtures/i
    );
    await expect(page.getByTestId("chat-status")).not.toHaveText(/active fixtures live/i);
    await expect(page.getByRole("button", { name: /Arsenal vs Coventry City ·/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Dinamo Zagreb vs Viking/ })).toHaveCount(0);
  });

  test("unpriced window keeps table chips and does not offer 503 match suggestions", async ({ page }) => {
    await page.addInitScript(() => {
      (window as Window & { __PUNDIT_E2E_FIXTURE_STATE__?: string }).__PUNDIT_E2E_FIXTURE_STATE__ = "unpriced";
    });
    await page.goto("/legacy");
    await expect(page.getByTestId("chat-status")).toHaveText(
      /Match model is catching up/i
    );
    await expect(page.getByRole("button", { name: "What does the current Premier League table show?" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Dinamo Zagreb vs Viking/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Arsenal vs Coventry City/ })).toHaveCount(0);
  });

  test("unavailable fixture list does not read as ready", async ({ page }) => {
    await page.addInitScript(() => {
      (window as Window & { __PUNDIT_E2E_FIXTURE_STATE__?: string }).__PUNDIT_E2E_FIXTURE_STATE__ = "unavailable";
    });
    await page.goto("/legacy");
    await expect(page.getByTestId("chat-status")).toHaveText(
      /Model not ready/i
    );
    await expect(page.getByRole("button", { name: /Dinamo Zagreb vs Viking/ })).toHaveCount(0);
  });
});
