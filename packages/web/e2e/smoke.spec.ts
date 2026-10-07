import { test, expect, type Page } from "@playwright/test";
import type { ModelFixtureResponse } from "../src/lib/api";
import type { ModelRowLambdas } from "../src/desk/lib/grid";

test.describe("QA regressions", () => {
  test("calibrated EPL goals use server means, disclosure and joint paper scores", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => { Math.random = () => 0.95; });
    const row = precisionBoundaryRow();
    const hash = "b".repeat(64);
    row.goalCalibration = { methodId: "outcome-anchored-shrunk-goals-v2", artifactSha256: hash,
      artifactId: `outcome-anchored-shrunk-goals-v2:${hash}` };
    row.forecastInputs!.goalCalibrationArtifactSha256 = hash;
    row.forecastProvenance!.goalCalibrationArtifactSha256 = hash;
    row.expectedHomeGoals = 1.15; row.expectedAwayGoals = 0.8;
    row.scoreGrid = [[0.1, 0.1, 0.05], [0.2, 0.1, 0.05], [0.1, 0.2, 0.1]];
    row.pHome = 0.5; row.pDraw = 0.3; row.pAway = 0.2;
    row.pOver2_5 = 0.35; row.pBttsYes = 0.45;
    await routePrecisionDeskSlate(page, row);
    const disclosure = "I estimate goals from historical scoring patterns and team ratings; these are forecasts, not guarantees.";
    await page.route("**/api/ask", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      answer: `Over 2.5 is 35.0%; under 2.5 is 65.0%. ${disclosure}`,
      grounding: { ...deskMatchGrounding("espn:eng.1:901", "Arsenal", "Chelsea"), goalCalibration: row.goalCalibration,
        pHome: 0.5, pDraw: 0.3, pAway: 0.2, pOver2_5: 0.35, pUnder2_5: 0.65, pBttsYes: 0.45, pBttsNo: 0.55 },
      presentation: { responseMode: "totals", fixtureCard: "expanded" },
    }) }));
    await page.goto("/");
    await page.locator('li [data-testid="desk-slate-fixture"][data-fixture-id="espn:eng.1:901"]').click();
    await expect(page.locator("aside").getByText("1.15–0.80", { exact: true })).toBeVisible();
    await expect(page.locator("aside").getByText(disclosure, { exact: true })).toBeVisible();
    await expect(page.locator("aside")).toContainText("Paper scores sample the joint forecast distribution.");
    await page.locator("aside").getByRole("button", { name: "Project score", exact: true }).click();
    await expect(page.locator("aside").getByText("2–2", { exact: true })).toBeVisible();
    const input = page.getByRole("textbox", { name: "Ask a question" });
    await input.fill("What about over 2.5?");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByTestId("desk-totals-honesty")).toHaveText(disclosure);
    await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Paper" }).click();
    await expect(page.getByText("xG 1.15–0.80", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Select Arsenal vs Chelsea", exact: true })).toBeVisible();
  });

  for (const exact of [true, false]) {
    test(`desk and paper xG use ${exact ? "exact forecast inputs" : "legacy rounded inputs"} at the rounding boundary`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      const row = precisionBoundaryRow();
      if (!exact) delete row.forecastInputs;
      await routePrecisionDeskSlate(page, row);
      await page.goto("/");
      await expect(page.getByText("Live model", { exact: true })).toBeVisible();
      await page.locator('li [data-testid="desk-slate-fixture"][data-fixture-id="espn:eng.1:901"]').click();
      const xg = exact ? "1.88–0.82" : "1.87–0.83";
      await expect(page.locator("aside").getByText(xg, { exact: true })).toBeVisible();
      await expect(page.locator("aside")).toContainText(`xG ${xg}.`);
      await expect(page.locator("aside")).toContainText("1X2 50/25/25.");
      await expect(page.locator("aside")).toContainText("BTTS 50 · O2.5 52");
      await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Paper" }).click();
      await expect(page.getByText(`xG ${xg}`, { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Select Arsenal vs Chelsea", exact: true })).toBeVisible();
    });
  }

  test("desk and paper retain an exact neutral-venue home advantage of zero", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const row = precisionBoundaryRow();
    row.forecastInputs!.homeAdvantageElo = 0;
    row.forecastProvenance!.homeAdvantageElo = 0;
    await routePrecisionDeskSlate(page, row);
    await page.goto("/");
    await expect(page.getByText("Live model", { exact: true })).toBeVisible();
    await page.locator('li [data-testid="desk-slate-fixture"][data-fixture-id="espn:eng.1:901"]').click();
    await expect(page.locator("aside").getByText("1.73–0.97", { exact: true })).toBeVisible();
    await expect(page.locator("aside")).toContainText("1X2 50/25/25.");
    await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Paper" }).click();
    await expect(page.getByText("xG 1.73–0.97", { exact: true })).toBeVisible();
  });

  const corruptedInputs: Array<[string, (row: ReturnType<typeof precisionBoundaryRow>) => void]> = [
    ["fixture identity", (row) => { row.forecastInputs!.fixtureId = 902; }],
    ["team identity", (row) => { row.forecastInputs!.home = "Liverpool"; }],
    ["kickoff", (row) => { row.forecastInputs!.utcDate = "2099-09-21T19:00:00.000Z"; }],
    ["display Elo", (row) => { row.forecastInputs!.homeStrength = 1901; }],
    ["nonfinite strength", (row) => { row.forecastInputs!.awayStrength = NaN; }],
    ["home advantage", (row) => { row.forecastInputs!.homeAdvantageElo = 0; }],
    ["artifact identity", (row) => { row.forecastInputs!.ratingArtifactId = "another-artifact"; }],
    ["artifact hash", (row) => { row.forecastInputs!.ratingArtifactSha256 = "0".repeat(64); }],
    ["rating snapshot", (row) => { row.forecastInputs!.ratingSnapshotAt = null; }],
    ["missing provenance", (row) => { delete row.forecastProvenance; }],
    ["invalid config", (row) => { row.forecastProvenance!.config!.eloScale = 0; }],
    ["null block", (row) => { Object.assign(row, { forecastInputs: null }); }],
  ];
  for (const [label, corrupt] of corruptedInputs) {
    test(`desk rejects present forecast inputs with ${label}`, async ({ page }) => {
      const row = precisionBoundaryRow();
      corrupt(row);
      await routePrecisionDeskSlate(page, row);
      await page.goto("/");
      // Explicit mock mode can recover only to its labelled static slate.
      await expect(page.getByText("Mock model", { exact: true })).toBeVisible();
      await expect(page.locator('[data-fixture-id="espn:eng.1:901"]')).toHaveCount(0);
      await expect(page.getByText("1.88–0.82", { exact: true })).toHaveCount(0);
      await expect(page.getByText("Live model", { exact: true })).toHaveCount(0);
    });
  }

  for (const width of [390, 1440]) {
    test(`general explainer chips leave an unpriced pin for one turn and preserve its return at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await routeTwoFixtureDeskSlate(page);
      await page.route("**/api/model/active", (route) => route.fulfill({
        status: 200, contentType: "application/json", body: JSON.stringify({ fixtures: [] }),
      }));
      const fixture = {
        fixtureId: "espn:eng.1:901", primarySource: "espn", primarySourceFixtureId: "901",
        homeTeam: { id: "arsenal", name: "Arsenal" }, awayTeam: { id: "chelsea", name: "Chelsea" },
        kickoff: "2026-10-04T19:00:00.000Z", venue: "Emirates Stadium", neutralVenue: false,
        competition: { id: "eng.1", name: "Premier League", category: "domestic-league" },
        status: "in-play", recognition: "authoritative",
      };
      const explainers = [
        ["Reading a slate", "In general, how do you assess a slate of football fixtures without treating any outcome as guaranteed?", "Compare the ways teams create chances and defend space across a slate; an outcome is never guaranteed."],
        ["No bankers", "In general, why should a strong favourite never be treated as a guaranteed win?", "A strong favourite can still lose through poor finishing or a defensive mistake."],
        ["Derby dynamics", "In general, how can a derby change the tactical trade-offs and game management?", "In a derby, discipline and the timing of pressure can matter as much as possession."],
        ["Scoring chances", "In general, what makes a good chance for a striker, beyond past goal totals?", "A striker benefits from receiving close to goal with room to shoot; past totals alone cannot describe the chance."],
      ];
      const requests: Array<Record<string, unknown>> = [];
      await page.route("**/api/ask", (route) => {
        const request = route.request().postDataJSON();
        requests.push(request);
        const explainer = explainers.find(([, question]) => question === request.question);
        const generalScope = explainer && !request.fixtureContext && request.history.length === 0 && !request.userLine;
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
          answer: generalScope ? explainer[2] : "This match is underway; I have no live forecast.",
          grounding: generalScope ? null : { kind: "fixture", fixture,
            capability: { status: "outside-coverage", reason: "in-play-model-unavailable" } },
        }) });
      });
      await page.goto("/");
      const input = page.getByRole("textbox", { name: "Ask a question" });
      await input.fill("Arsenal vs Chelsea live odds?");
      await page.getByRole("button", { name: "Send", exact: true }).click();
      await expect(page.getByTestId("desk-unpriced-notice")).toBeVisible();
      for (const [index, [label, question, answer]] of explainers.entries()) {
        await page.getByRole("button", { name: label, exact: true }).click();
        await expect(page.getByTestId("desk-pundit-bubble").last()).toContainText(answer);
        await expect(page.getByTestId("desk-grounding-label").last()).toHaveText("General analysis");
        await expect(page.getByTestId("desk-pundit-bubble").last().getByTestId("desk-unpriced-notice")).toHaveCount(0);
        expect(requests[index + 1]).toMatchObject({ question, history: [], voice: "desk", stream: false });
        expect(requests[index + 1]).not.toHaveProperty("fixtureContext");
        expect(requests[index + 1]).not.toHaveProperty("userLine");
        await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("pundit-desk-v2")!).state.selectedId)).toBe(fixture.fixtureId);
      }
      await expect(page.getByTestId("desk-match-board")).toHaveCount(0);
      await expect(page.getByTestId("desk-user-bubble")).toHaveCount(5);
      await input.fill("Back to that match: what about its odds?");
      await page.getByRole("button", { name: "Send", exact: true }).click();
      await expect(page.getByTestId("desk-unpriced-notice")).toHaveCount(2);
      expect(requests[5].fixtureContext).toEqual({ fixtureId: fixture.fixtureId });
      expect(requests[5].history).toHaveLength(10);
      await expect(page.getByTestId("desk-match-board")).toHaveCount(0);
    });
  }

  for (const path of ["/", "/legacy"]) {
    test(`recognized in-play fixture shows no live forecast or market gap at ${path}`, async ({ page }) => {
      const fixture = {
        fixtureId: "espn:eng.1:901", primarySource: "espn", primarySourceFixtureId: "901",
        homeTeam: { id: "arsenal", name: "Arsenal" }, awayTeam: { id: "chelsea", name: "Chelsea" },
        kickoff: "2026-10-04T19:00:00.000Z", venue: "Emirates Stadium", neutralVenue: false,
        competition: { id: "eng.1", name: "Premier League", category: "domestic-league" },
        status: "in-play", recognition: "authoritative",
      };
      await routeTwoFixtureDeskSlate(page);
      await page.route("**/api/model/active", (route) => route.fulfill({
        status: 200, contentType: "application/json", body: JSON.stringify({ fixtures: [] }),
      }));
      const received: Array<Record<string, unknown>> = [];
      let reportedFixture = fixture;
      await page.route("**/api/ask", (route) => {
        received.push(route.request().postDataJSON());
        if (received.at(-1)!.question === "Actually switch to Liverpool vs Fulham") {
          reportedFixture = { ...fixture, fixtureId: "espn:eng.1:902", primarySourceFixtureId: "902",
            homeTeam: { id: "liverpool", name: "Liverpool" }, awayTeam: { id: "fulham", name: "Fulham" } };
        }
        const response = {
          answer: "This fixture is already underway. I have no live forecast or model-to-market comparison.",
          grounding: { kind: "fixture", fixture: reportedFixture,
            capability: { status: "outside-coverage", reason: "in-play-model-unavailable" } },
        };
        return route.fulfill(path === "/legacy"
          ? { status: 200, contentType: "text/event-stream", body: [
            `event: grounding\ndata: ${JSON.stringify({ grounding: response.grounding })}`,
            `event: done\ndata: ${JSON.stringify(response)}`, "",
          ].join("\n\n") }
          : { status: 200, contentType: "application/json", body: JSON.stringify(response) });
      });
      await page.goto(path);
      const input = page.getByRole("textbox", { name: "Ask a question" });
      await input.fill("What are the odds for Arsenal vs Chelsea right now?");
      await page.getByRole("button", { name: "Send", exact: true }).click();
      await expect(page.getByText(/Premier League · Live forecast unavailable/, { exact: false })).toBeVisible();
      for (const testId of ["desk-match-board", "desk-compact-match-context", "match-fixture-card", "compact-match-context"]) {
        await expect(page.getByTestId(testId)).toHaveCount(0);
      }
      const output = path === "/" ? page.getByTestId("desk-pundit-bubble") : page.locator('[aria-live="polite"][aria-relevant="additions text"]');
      await expect(output).not.toContainText(/\d+(?:\.\d+)?\s*%|Fair decimal odds|Model probabilities|percentage points/i);
      if (path === "/") {
        await expect(page.getByTestId("desk-unpriced-notice")).toBeVisible();
        await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("pundit-desk-v2")!).state.selectedId))
          .toBe(fixture.fixtureId);
      }
      await input.fill("What about that match?");
      await page.getByRole("button", { name: "Send", exact: true }).click();
      await expect.poll(() => received.length).toBe(2);
      await expect(page.getByText(/Premier League · Live forecast unavailable/, { exact: false })).toHaveCount(2);
      await expect(page.getByTestId("desk-match-board")).toHaveCount(0);
      await expect(page.getByTestId("match-fixture-card")).toHaveCount(0);
      await expect(page.locator('[data-testid^="market-ev-"]')).toHaveCount(0);
      expect(received[1].fixtureContext).toEqual({ fixtureId: fixture.fixtureId });
      expect(received[1].history).toEqual(expect.arrayContaining([
        expect.objectContaining({ role: "user", content: "What are the odds for Arsenal vs Chelsea right now?" }),
      ]));
      await input.fill("Actually switch to Liverpool vs Fulham");
      await page.getByRole("button", { name: "Send", exact: true }).click();
      await expect(page.getByText(/Premier League · Live forecast unavailable/, { exact: false })).toHaveCount(3);
      await input.fill("What about that match now?");
      await page.getByRole("button", { name: "Send", exact: true }).click();
      await expect.poll(() => received.length).toBe(4);
      expect(received[3].fixtureContext).toEqual({ fixtureId: "espn:eng.1:902" });
      await expect(page.getByTestId("desk-match-board")).toHaveCount(0);
      await expect(page.getByTestId("match-fixture-card")).toHaveCount(0);
    });
  }

  for (const key of ["Enter", "Space"]) {
    test(`paper fixture selection works with ${key}`, async ({ page }) => {
      await routeTwoFixtureDeskSlate(page);
      await page.goto("/board");
      for (const [name, id] of [["Arsenal vs Chelsea", "901"], ["Liverpool vs Fulham", "902"]]) {
        const select = page.getByRole("button", { name: `Select ${name}`, exact: true });
        await expect(select).toBeVisible();
        expect(await select.evaluate((element) => element.tabIndex)).toBe(0);
        await select.focus();
        await page.keyboard.press(key);
        await expect(select).toHaveAttribute("aria-pressed", "true");
        await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("pundit-desk-v2")!).state.selectedId))
          .toBe(`espn:eng.1:${id}`);
      }
      await expect(page.getByRole("button", { name: "Select Arsenal vs Chelsea", exact: true }))
        .toHaveAttribute("aria-pressed", "false");
    });

    test(`draft player selection works with ${key} and unavailable players stay disabled`, async ({ page }) => {
      await page.clock.install();
      await page.goto("/draft");
      await page.getByRole("button", { name: "Start practice draft" }).click();
      await page.clock.runFor(2_401);
      await expect(page.getByText("You are on the clock", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Draft Haaland", exact: true })).toBeDisabled();
      const saka = page.getByRole("button", { name: "Draft Saka", exact: true });
      await expect(saka).toBeEnabled();
      await saka.focus();
      await page.keyboard.press(key);
      await expect(page.locator("aside").getByText("Saka", { exact: true })).toBeVisible();
      await expect(saka).toBeDisabled();
      await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("pundit-desk-v2")!).state.draftTeams[3].picks))
        .toEqual(["saka"]);
    });
  }

  for (const width of [390, 1440]) {
    test(`desk Stop restores the prompt and excludes a late reply at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await routeTwoFixtureDeskSlate(page);
      const requests: Array<Record<string, unknown>> = [];
      let release = () => {};
      await page.route("**/api/ask", async (route) => {
        requests.push(route.request().postDataJSON());
        if (requests.length === 1) {
          await new Promise<void>((resolve) => { release = resolve; });
          await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ answer: "Late cancelled answer.", grounding: null }) }).catch(() => {});
          return;
        }
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ answer: "The retry completed.", grounding: null }) });
      });
      await page.goto("/");
      const input = page.getByRole("textbox", { name: "Ask a question" });
      await input.fill("Explain a high defensive line");
      await page.getByRole("button", { name: "Send", exact: true }).click();
      await expect.poll(() => requests.length).toBe(1);
      await page.getByRole("button", { name: "Stop generating" }).click();
      await expect(input).toBeEnabled();
      await expect(input).toHaveValue("Explain a high defensive line");
      await expect(page.getByTestId("desk-user-bubble")).toHaveCount(0);
      await page.getByRole("button", { name: "Send", exact: true }).click();
      await expect(page.getByText("The retry completed.", { exact: true })).toBeVisible();
      release();
      await expect(page.getByTestId("desk-pundit-bubble")).toHaveCount(1);
      await expect(page.getByText("Late cancelled answer.", { exact: true })).toHaveCount(0);
      expect(requests[1].history).toEqual([]);
    });
  }

  test("desk times out an unanswered request and keeps it ready to retry", async ({ page }) => {
    await routeTwoFixtureDeskSlate(page);
    await page.clock.install();
    let release = () => {};
    let calls = 0;
    await page.route("**/api/ask", async (route) => {
      if (++calls === 1) {
        await new Promise<void>((resolve) => { release = resolve; });
        await route.abort().catch(() => {});
        return;
      }
      expect(route.request().postDataJSON().history).toEqual([]);
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ answer: "The retry completed.", grounding: null }) });
    });
    await page.goto("/");
    const input = page.getByRole("textbox", { name: "Ask a question" });
    await input.fill("Explain a high defensive line");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect.poll(() => calls).toBe(1);
    await page.clock.fastForward(95_001);
    await expect(page.getByText("Pundit took too long to answer. Your question is ready to retry.", { exact: true })).toBeVisible();
    await expect(input).toBeEnabled();
    await expect(input).toHaveValue("Explain a high defensive line");
    await expect(page.getByTestId("desk-user-bubble")).toHaveCount(0);
    release();
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByText("The retry completed.", { exact: true })).toBeVisible();
  });

  test("desk rejects an empty successful answer without echoing the question", async ({ page }) => {
    await routeTwoFixtureDeskSlate(page);
    let calls = 0;
    await page.route("**/api/ask", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ answer: ++calls === 1 ? "  " : "The retry completed.", grounding: null }) }));
    await page.goto("/");
    const input = page.getByRole("textbox", { name: "Ask a question" });
    await input.fill("Explain a high defensive line");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByText("Pundit returned an empty answer. Try again.", { exact: true })).toBeVisible();
    await expect(input).toHaveValue("Explain a high defensive line");
    await expect(page.getByTestId("desk-pundit-bubble")).toHaveCount(0);
    await expect(page.getByTestId("desk-user-bubble")).toHaveCount(0);
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByText("The retry completed.", { exact: true })).toBeVisible();
  });

  test("a totals follow-up keeps a compact, expandable match reference", async ({ page }) => {
    await routeTwoFixtureDeskSlate(page);
    let turn = 0;
    await page.route("**/api/ask", (route) => route.fulfill({
      status: 200, contentType: "application/json", body: JSON.stringify({
        answer: ++turn === 1 ? "Here is the match briefing." : "Over 2.5 is 52.0%; this uses a fixed total-goals assumption.",
        grounding: deskMatchGrounding("espn:eng.1:901", "Arsenal", "Chelsea"),
        presentation: { responseMode: turn === 1 ? "match-preview" : "totals", fixtureCard: turn === 1 ? "expanded" : "compact" },
      }),
    }));
    await page.goto("/");
    const input = page.getByRole("textbox", { name: "Ask a question" });
    await input.fill("Give me the Arsenal vs Chelsea briefing");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByTestId("desk-match-board")).toBeVisible();
    await expect(page.getByTestId("desk-match-board")).toContainText("Model probabilities · fair decimal odds");
    await expect(page.getByTestId("desk-totals-honesty")).toContainText("fixed total-goals assumption");
    await expect(page.getByTestId("desk-match-board")).toContainText("sum to 100%");
    const league = page.getByRole("img", { name: "Premier League", exact: true });
    await expect(league).toHaveAttribute("src", "/crests/PL.svg");
    expect(await league.evaluate((element) => getComputedStyle(element).objectFit)).toBe("contain");
    await input.fill("What about over 2.5?");
    await page.getByRole("button", { name: "Send" }).click();
    const compact = page.getByTestId("desk-compact-match-context");
    await expect(compact).toBeVisible();
    await expect(compact.getByTestId("desk-match-board")).not.toBeVisible();
    await compact.getByText("Arsenal vs Chelsea · Match context", { exact: true }).click();
    await expect(compact.getByTestId("desk-match-board")).toBeVisible();
    await page.reload();
    await expect(compact).toBeVisible();
    await expect(compact.getByTestId("desk-match-board")).not.toBeVisible();
  });

  test("all main routes fit a narrow phone and tablet", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await routeTwoFixtureDeskSlate(page);
    for (const width of [320, 820]) {
      await page.setViewportSize({ width, height: 900 });
      for (const path of ["/", "/board", "/draft", "/vault", "/fixtures", "/model", "/evaluation/club-season", "/evaluation/wc-2026"]) {
        await page.goto(path);
        await expect(page.getByRole("heading").first()).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${path} at ${width}px`).toBe(true);
      }
    }
    expect(errors).toEqual([]);
  });

  for (const width of [390, 820, 1024, 1440]) {
    test(`all sections are reachable without header overflow at ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/model");
      await expect(page.getByRole("heading", { name: "Club season model" })).toBeVisible();
      expect(await page.locator("header").evaluate((header) => header.scrollWidth <= window.innerWidth)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      const note = page.getByText("Kickoffs shown in UK time (GMT/BST).", { exact: true });
      const noteBox = await note.boundingBox();
      const titleBox = await page.getByRole("heading", { name: "Club season model" }).boundingBox();
      expect(noteBox!.y).toBeGreaterThan(titleBox!.y + titleBox!.height);
      expect(await note.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const visible = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return visible === element || element.contains(visible);
      })).toBe(true);
      await expect(page.getByRole("img", { name: /Arsenal.*Draw/ }).first()).toHaveText("");
      const navigation = page.getByRole("navigation", { name: width < 1280 ? "Mobile" : "Main navigation", exact: true });
      if (width < 1280) {
        const more = navigation.getByRole("button", { name: "More", exact: true });
        await more.click();
        await expect(more).toHaveAttribute("aria-expanded", "true");
      }
      for (const name of ["Fixtures", "Model", "Ledger"]) {
        await expect(navigation.getByRole("link", { name, exact: true })).toBeVisible();
      }
      if (width < 1280) await expect(navigation.getByRole("link", { name: "How it works", exact: true })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`model-${width}.png`), fullPage: true });
      await navigation.getByRole("link", { name: "Ledger", exact: true }).click();
      await expect(page).toHaveURL(/evaluation\/club-season/);
      if (width < 1280) await expect(navigation.getByRole("button", { name: "More" })).toHaveAttribute("aria-expanded", "false");
    });
  }

  test("practice books have no fabricated performance and preserve credits", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/vault");
    const main = page.getByRole("main");
    await expect(main.getByText("Not tracked", { exact: true })).toBeVisible();
    await expect(main.getByText(/do not place positions, track the live slate or earn returns/)).toBeVisible();
    await expect(main).not.toContainText(/Sharpe|18\.6%|9\.4%|6\.1%|NAV|Annualized/);
    const alpha = main.getByRole("article").filter({ has: page.getByRole("heading", { name: "Alpha", exact: true }) });
    const credits = alpha.getByRole("spinbutton", { name: "Alpha practice credits" });
    await credits.fill("1");
    await alpha.getByRole("button", { name: "Reserve credits" }).click();
    await expect(alpha.getByText("Minimum 250 credits.", { exact: true })).toBeVisible();
    await credits.fill("250");
    await alpha.getByRole("button", { name: "Reserve credits" }).click();
    await expect(main.getByText("9,750", { exact: true })).toBeVisible();
    await expect(alpha.getByText("250", { exact: true })).toBeVisible();
    await page.reload();
    await expect(main.getByText("9,750", { exact: true })).toBeVisible();
    await alpha.getByRole("button", { name: "Return credits" }).click();
    await expect(main.getByText("10,000", { exact: true })).toBeVisible();
    await expect(alpha.getByRole("button", { name: "Return credits" })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("vault-mobile.png"), fullPage: true });
  });

  test("draft identifies computer opponents before and during play", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/draft");
    await expect(page.getByText(/Practice against seven computer-controlled teams/)).toBeVisible();
    await expect(page.getByText(/Player scores are demo inputs, not current-season statistics/)).toBeVisible();
    await page.getByRole("button", { name: "Start practice draft" }).click();
    await expect(page.getByText("Local practice · seven computer-controlled teams · illustrative player scores", { exact: true })).toBeVisible();
    await expect(page.getByText("You are on the clock", { exact: true })).toBeVisible({ timeout: 10_000 });
    await page.getByRole("row").filter({ hasText: "Saka" }).click();
    await expect(page.locator("aside").getByText("Saka", { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("draft-mobile.png"), fullPage: true });
    await page.reload();
    await expect(page.getByText("Local practice · seven computer-controlled teams · illustrative player scores", { exact: true })).toBeVisible();
    await expect(page.locator("aside").getByText("Saka", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Leave room" }).click();
    await expect(page.getByRole("button", { name: "Start practice draft" })).toBeVisible();
  });

  for (const timezoneId of ["Asia/Singapore", "America/New_York"]) {
    test.describe(timezoneId, () => {
      test.use({ timezoneId });
      test("kickoff labels agree across fixture, model and desk views", async ({ page }) => {
        await page.clock.setFixedTime(new Date("2026-10-04T11:30:00Z"));
        const fixtureId = "espn:eng.1:1";
        for (const [path, testId] of [["/fixtures", "fixture-row"], ["/model", "model-fixture-row"]]) {
          await page.goto(path);
          await expect(page.getByText("Kickoffs shown in UK time (GMT/BST).", { exact: true })).toBeVisible();
          const row = page.locator(`[data-testid="${testId}"][data-fixture-id="${fixtureId}"]`);
          await expect(row).toContainText("12:30");
          await expect(row).toContainText("6 Oct");
        }
        await routeTwoFixtureDeskSlate(page);
        await page.goto("/");
        await expect(page.getByText("Kickoffs shown in UK time (GMT/BST).", { exact: true })).toBeVisible();
        await expect(page.getByText(/20 Sep.*20:00 BST/).first()).toBeVisible();
      });
    });
  }
});

function precisionBoundaryRow(): ModelRowLambdas & Pick<ModelFixtureResponse,
  "pHome" | "pDraw" | "pAway" | "pBttsYes" | "topScores" | "oddsSources"> {
  return {
    competitionId: "eng.1", fixtureId: 901, utcDate: "2099-09-20T19:00:00.000Z",
    home: "Arsenal", away: "Chelsea", homeElo: 1900.6, awayElo: 1800,
    pHome: 0.5, pDraw: 0.25, pAway: 0.25, pOver2_5: 0.52, pBttsYes: 0.5,
    topScores: [{ score: "1-0", probability: 0.13 }], oddsSources: [],
    forecastInputs: {
      homeStrength: 1900.619, awayStrength: 1800, homeAdvantageElo: 42,
      competitionId: "eng.1", fixtureId: 901, utcDate: "2099-09-20T19:00:00.000Z",
      home: "Arsenal", away: "Chelsea", ratingArtifactId: "precision-boundary",
      ratingArtifactSha256: "a".repeat(64), ratingSnapshotAt: "2099-09-19T00:00:00.000Z",
    },
    forecastProvenance: {
      homeAdvantageElo: 42, ratingArtifactId: "precision-boundary",
      ratingArtifactSha256: "a".repeat(64), ratingSnapshotAt: "2099-09-19T00:00:00.000Z",
      config: { baseGoals: 1.35, eloScale: 400, lambdaCap: 5 },
    },
  };
}

async function routePrecisionDeskSlate(page: Page, row: ReturnType<typeof precisionBoundaryRow>) {
  await routeTwoFixtureDeskSlate(page);
  await page.route("**/api/model/active", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ fixtures: [row] }),
  }));
}

async function routeTwoFixtureDeskSlate(page: Page) {
  const fixtures = [
    { fixtureId: 901, home: "Arsenal", away: "Chelsea", pHome: 0.5, pDraw: 0.25, pAway: 0.25 },
    { fixtureId: 902, home: "Liverpool", away: "Fulham", pHome: 0.65, pDraw: 0.2, pAway: 0.15 },
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
  await page.route("**/api/matches/recent?competition=eng.1", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ matches: [], clubForm: { teams: [] } }),
  }));
}

function deskMatchGrounding(
  fixtureId: string,
  home = "Sunderland",
  away = "Arsenal",
) {
  return {
    kind: "match",
    fixtureId,
    competitionId: "eng.1",
    competition: "Premier League",
    homeFieldAdvantage: true,
    date: "2026-09-12",
    stage: "match",
    home,
    away,
    pHome: 0.18,
    pDraw: 0.24,
    pAway: 0.58,
    pOver2_5: 0.52,
    pUnder2_5: 0.48,
    pBttsYes: 0.46,
    pBttsNo: 0.54,
    topScores: [{ score: "0-1", probability: 0.14 }],
    scorelines: [{ score: "0-1", probability: 0.14 }],
    stakePHome: null,
    stakePDraw: null,
    stakePAway: null,
    oddsSources: [{
      source: "polymarket",
      observedAt: "2026-09-10T12:00:00.000Z",
      pHome: 0.2,
      pDraw: 0.25,
      pAway: 0.55,
    }],
    pricing: {
      fixtureId,
      home,
      away,
      kickoff: "2026-09-12T19:00:00.000Z",
      modelVersion: "test",
      pricedAt: "2026-09-10T12:00:00.000Z",
      model: {
        home: { p: 0.18, fairOdds: 5.56 },
        draw: { p: 0.24, fairOdds: 4.17 },
        away: { p: 0.58, fairOdds: 1.72 },
      },
      markets: [{
        source: "polymarket",
        observedAt: "2026-09-10T12:00:00.000Z",
        edgeBand: "agreement",
        legs: {
          home: { outcome: "home", modelP: 0.18, fairOdds: 5.56, decimalOdds: 5, impliedP: 0.2, evPct: -0.1 },
          draw: { outcome: "draw", modelP: 0.24, fairOdds: 4.17, decimalOdds: 4, impliedP: 0.25, evPct: -0.04 },
          away: { outcome: "away", modelP: 0.58, fairOdds: 1.72, decimalOdds: 1.82, impliedP: 0.55, evPct: 0.0556 },
        },
      }],
      userLine: null,
      stakeFrac: null,
    },
  };
}

test.describe("smoke", () => {
  test("homepage", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Pundit" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Ask a question" })).toBeVisible();
    // Desk repeats the disclaimer in the hero, brief, and match panel; the header
    // strip is the unambiguous smoke target.
    await expect(page.getByText("Analysis only — not betting advice.", { exact: true })).toBeVisible();
  });

  test("fixtures", async ({ page }) => {
    await page.goto("/fixtures");
    await expect(page.getByRole("heading", { name: "Fixtures" })).toBeVisible();
    await expect(page.getByRole("button", { name: "All" })).toBeVisible();
    await expect(page.locator("span.truncate", { hasText: "Arsenal" }).first()).toBeVisible();
  });

  for (const failure of ["network", "429"] as const) {
    test(`fixtures recover competition filters after a ${failure} failure without losing the schedule`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.addInitScript(() => {
        (window as Window & { __PUNDIT_E2E_FIXTURE_STATE__?: string }).__PUNDIT_E2E_FIXTURE_STATE__ = "competitions-live";
      });
      let attempts = 0;
      await page.route("**/api/matches/competitions", (route) => {
        if (++attempts === 1) {
          return failure === "network" ? route.abort("failed") : route.fulfill({
            status: 429, contentType: "application/json", body: JSON.stringify({ error: "Too many requests, please try again later" }),
          });
        }
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
          competitions: [{ id: "eng.1", name: "Premier League", type: "league", enabled: true, priority: 1 }],
          enabled: ["eng.1"], lastUpdated: new Date().toISOString(),
        }) });
      });
      await page.goto("/fixtures");
      const alert = page.getByRole("alert").filter({ hasText: "Competition filters" });
      await expect(alert).toContainText(failure === "429" ? "temporarily limited" : "unavailable right now");
      await expect(page.getByTestId("fixture-row")).toHaveCount(3);
      await expect(page.getByRole("button", { name: "All", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Premier League", exact: true })).toHaveCount(0);
      await alert.getByRole("button", { name: "Retry", exact: true }).click();
      await expect(page.getByRole("button", { name: "Premier League", exact: true })).toBeVisible();
      await expect(alert).toHaveCount(0);
      await expect(page.getByTestId("fixture-row")).toHaveCount(3);
      expect(attempts).toBe(2);
      expect(errors).toEqual([]);
    });
  }

  test("a competition response from an unmounted fixtures page cannot replace the next page's filters", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      (window as Window & { __PUNDIT_E2E_FIXTURE_STATE__?: string }).__PUNDIT_E2E_FIXTURE_STATE__ = "competitions-live";
    });
    let finishOldRequest!: () => void;
    const oldRequest = new Promise<void>((resolve) => { finishOldRequest = resolve; });
    let attempts = 0;
    await page.route("**/api/matches/competitions", async (route) => {
      const old = ++attempts === 1;
      if (old) await oldRequest;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
        competitions: [{ id: old ? "old" : "eng.1", name: old ? "Old filters" : "Premier League", type: "league", enabled: true, priority: 1 }],
        enabled: [old ? "old" : "eng.1"], lastUpdated: new Date().toISOString(),
      }) });
    });
    await page.goto("/fixtures");
    await expect(page.getByTestId("fixture-row")).toHaveCount(3);
    await expect.poll(() => attempts).toBe(1);
    const navigation = page.getByRole("navigation", { name: "Main navigation" });
    await navigation.getByRole("link", { name: "Desk", exact: true }).click();
    await expect(page).toHaveURL("/");
    await navigation.getByRole("link", { name: "Fixtures", exact: true }).click();
    await expect(page.getByRole("button", { name: "Premier League", exact: true })).toBeVisible();
    const oldResponse = page.waitForResponse("**/api/matches/competitions");
    finishOldRequest();
    await oldResponse;
    await expect(page.getByRole("button", { name: "Old filters", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Premier League", exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("fixtures stay chronological and expose canonical capability", async ({ page }) => {
    await page.goto("/fixtures");
    const rows = page.getByTestId("fixture-row");
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toHaveAttribute("data-fixture-id", "espn:eng.1:3");
    await expect(rows.nth(1)).toHaveAttribute("data-fixture-id", "espn:eng.1:1");
    await expect(rows.nth(2)).toHaveAttribute("data-fixture-id", "espn:uefa.champions_qual:2");
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
    await expect(arsenal).toHaveAttribute("data-fixture-id", "espn:eng.1:1");
    await expect(arsenal).toHaveAttribute("data-model-version", "mock-v1");
    await expect(arsenal).toHaveAttribute("data-forecast-at", /T/);
    await arsenal.getByRole("button", { name: "Expand details" }).click();
    await expect(page.getByTestId("totals-honesty")).toHaveText(
      "I use a fixed total-goals assumption, so these totals cannot tell me whether this particular match will be more open or tighter."
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
      expect(requests[0]).not.toHaveProperty("fixtureContext");
    });
  }

  test("desk labels season, table and general answers without internal grounding jargon", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const season = {
      kind: "season", competitionId: "eng.1", competition: "Premier League",
      updatedAt: "2026-09-21T10:00:00.000Z", standings: [],
      seasonOutlook: { competitionId: "eng.1", competition: "Premier League", runs: 10000,
        titleProbabilities: [], topFourProbabilities: [], remainingFixtures: 330,
        updatedAt: "2026-09-21T10:00:00.000Z" },
    };
    const responses = [
      { answer: "Man City lead my title outlook.", grounding: season },
      { answer: "The table is only five matches old.", grounding: {
        kind: "competition", competitionId: "eng.1", competition: "Premier League",
        updatedAt: "2026-09-21T10:00:00.000Z", standings: [],
      } },
      { answer: "A high line leaves space behind.", grounding: null },
    ];
    await page.route("**/api/ask", (route) => route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify(responses.shift()),
    }));
    await page.goto("/");
    const input = page.getByRole("textbox", { name: "Ask a question" });
    for (const question of ["Who leads the title outlook?", "What does the table show?", "Explain a high line."]) {
      await input.fill(question);
      await page.getByRole("button", { name: "Send" }).click();
    }
    await expect(page.getByTestId("desk-grounding-label")).toHaveText([
      "Season outlook · Premier League", "Current table · Premier League", "General analysis",
    ]);
    await expect(page.locator("body")).not.toContainText("model-grounded");
  });

  for (const width of [390, 1440]) {
    test(`verified ESPN results have their own label and retain the forecast pin at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await routeTwoFixtureDeskSlate(page);
      const fixtureId = "espn:eng.1:901";
      const citation = { id: "S1", title: "Brighton 3–0 Arsenal — ESPN",
        url: "https://www.espn.com/soccer/match/_/gameId/401879274", date: "2026-09-19" };
      const result = "The latest completed Premier League result I have for Arsenal is **Brighton 3–0 Arsenal** (2026-09-19). [ESPN match record, 2026-09-19](https://www.espn.com/soccer/match/_/gameId/401879274).";
      const responses = [
        { answer: "I have the Arsenal–Chelsea forecast in view.", grounding: deskMatchGrounding(fixtureId, "Arsenal", "Chelsea") },
        { answer: result, grounding: null, citations: [citation],
          verification: { status: "verified", supportedClaimCount: 1, removedClaimCount: 0 } },
        { answer: "I still have Arsenal–Chelsea in view.", grounding: deskMatchGrounding(fixtureId, "Arsenal", "Chelsea") },
        { answer: "I couldn't verify that result.", grounding: null, citations: [citation],
          verification: { status: "unavailable", supportedClaimCount: 0, removedClaimCount: 1 } },
      ];
      const requests: Array<Record<string, unknown>> = [];
      await page.route("**/api/ask", async (route) => {
        requests.push(route.request().postDataJSON());
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(responses.shift()) });
      });
      await page.goto("/");
      await page.locator(`[data-testid="desk-featured-fixture"][data-fixture-id="${fixtureId}"]`).click();
      await expect(page.getByText("I have the Arsenal–Chelsea forecast in view.")).toBeVisible();
      const input = page.getByRole("textbox", { name: "Ask a question" });
      await input.fill("What is Arsenal's latest Premier League result?");
      await page.getByRole("button", { name: "Send" }).click();
      const resultBubble = page.getByTestId("desk-pundit-bubble").last();
      await expect(resultBubble.getByTestId("desk-grounding-label")).toHaveText("ESPN result");
      await expect(resultBubble.getByRole("link", { name: "ESPN match record, 2026-09-19" })).toHaveAttribute("href", citation.url);
      await expect(resultBubble).toContainText("Brighton 3–0 Arsenal");
      await expect(resultBubble).not.toContainText("ARS–CHE");
      await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("pundit-desk-v2")!).state.selectedId)).toBe(fixtureId);
      await input.fill("Back to that match: what is the 1X2?");
      await page.getByRole("button", { name: "Send" }).click();
      await expect(page.getByText("I still have Arsenal–Chelsea in view.")).toBeVisible();
      expect(requests[2].fixtureContext).toEqual({ fixtureId });
      await input.fill("Can you verify that result?");
      await page.getByRole("button", { name: "Send" }).click();
      await expect(page.getByTestId("desk-grounding-label").last()).toHaveText("General analysis");
      await expect(page.getByTestId("desk-grounding-label").filter({ hasText: "ESPN result" })).toHaveCount(1);
    });
  }

  test("desk featured fixture keeps its identity and renders grounded market rows", async ({ page }) => {
    await routeTwoFixtureDeskSlate(page);
    const requests: Array<Record<string, unknown>> = [];
    await page.route("**/api/ask", async (route) => {
      const request = route.request().postDataJSON() as Record<string, unknown>;
      requests.push(request);
      const fixtureId = ((request.fixtureContext as { fixtureId?: string } | undefined)?.fixtureId) ?? "missing";
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          answer: "I make Arsenal the side, with the market close to my numbers.",
          grounding: deskMatchGrounding(fixtureId, "Arsenal", "Chelsea"),
        }),
      });
    });

    await page.goto("/");
    const arsenal = page.locator('[data-testid="desk-featured-fixture"][data-fixture-id="espn:eng.1:901"]');
    await expect(arsenal).toBeVisible();
    await arsenal.click();
    await expect.poll(() => requests.length).toBe(1);
    expect(requests[0].fixtureContext).toEqual({ fixtureId: "espn:eng.1:901" });
    await expect(page.getByTestId("desk-match-board")).toBeVisible();
    await expect(page.getByTestId("desk-match-board")).toHaveAttribute("data-fixture-id", "espn:eng.1:901");
    await expect(page.getByTestId("desk-match-board")).toHaveAttribute("data-rating-artifact-id", "test");
    await expect(page.getByTestId("desk-match-board")).toHaveAttribute("data-priced-at", "2026-09-10T12:00:00.000Z");
    await expect(page.getByTestId("desk-board-markets")).toContainText("Polymarket");
    await expect(page.getByTestId("desk-board-markets")).toContainText("55.0%");
  });

  test("desk preserves an unresolved scorer switch and pins a resolved replacement", async ({ page }) => {
    await routeTwoFixtureDeskSlate(page);
    const requests: Array<Record<string, unknown>> = [];
    await page.route("**/api/ask", async (route) => {
      requests.push(route.request().postDataJSON());
      const turn = requests.length;
      const grounding = turn === 2 ? null : turn >= 4
        ? deskMatchGrounding("espn:eng.1:902", "Liverpool", "Fulham")
        : deskMatchGrounding("espn:eng.1:901", "Arsenal", "Chelsea");
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
        answer: `Reply ${turn}.`, grounding,
      }) });
    });
    await page.goto("/");
    await page.locator('[data-testid="desk-featured-fixture"][data-fixture-id="espn:eng.1:901"]').click();
    await expect(page.getByText("Reply 1.", { exact: true })).toBeVisible();
    const input = page.getByRole("textbox", { name: "Ask a question" });
    for (const [index, question] of [
      "Who is most likely to score for Liverpool?",
      "Back to this match: who scored recently?",
      "Switch to Liverpool vs Fulham",
      "Who scored recently?",
    ].entries()) {
      await input.fill(question);
      await page.getByRole("button", { name: "Send" }).click();
      await expect(page.getByText(`Reply ${index + 2}.`, { exact: true })).toBeVisible();
    }
    expect(requests.slice(0, 4).map((request) => request.fixtureContext)).toEqual(
      Array(4).fill({ fixtureId: "espn:eng.1:901" }),
    );
    expect(requests[4].fixtureContext).toEqual({ fixtureId: "espn:eng.1:902" });
    await expect(page.getByText("Pinned · Liverpool vs Fulham", { exact: true })).toBeVisible();
  });

  test("New Chat clears fixture context, queued state and shared URL", async ({ page }) => {
    const requests: Array<Record<string, unknown>> = [];
    await page.route("**/api/ask", async (route) => {
      requests.push(route.request().postDataJSON());
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ answer: "Here is the read.", grounding: null }),
      });
    });

    await page.goto("/?fixture=gw4-sun-ars&q=Give%20me%20the%20match%20briefing");
    await expect.poll(() => requests.length).toBe(1);
    await expect(page.getByText("Pinned · Sunderland vs Arsenal")).toBeVisible();
    await page.getByRole("button", { name: "New Chat" }).click();
    await expect(page.getByTestId("desk-chat-transcript").getByTestId("desk-user-bubble")).toHaveCount(0);
    await expect(page.getByText(/Pinned ·/)).toHaveCount(0);
    await expect.poll(() => new URL(page.url()).search).toBe("");

    await page.getByRole("textbox", { name: "Ask a question" }).fill("Walk the slate");
    await page.getByRole("button", { name: "Send" }).click();
    await expect.poll(() => requests.length).toBe(2);
    expect(requests[1]).not.toHaveProperty("fixtureContext");
  });

  test("desk rejects oversized questions and hostile text cannot overflow mobile", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    let calls = 0;
    await page.route("**/api/ask", async (route) => {
      calls += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ answer: "A".repeat(500), grounding: null }),
      });
    });
    await page.goto("/");
    const input = page.getByRole("textbox", { name: "Ask a question" });
    await expect(input).toHaveAttribute("maxlength", "500");
    await input.evaluate((node) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(node, "X".repeat(501));
      node.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText("Questions must be 500 characters or fewer.", { exact: true })).toBeVisible();
    expect(calls).toBe(0);

    await input.fill("X".repeat(500));
    await page.getByRole("button", { name: "Send" }).click();
    await expect.poll(() => calls).toBe(1);
    await expect(page.getByTestId("desk-pundit-bubble")).toBeVisible();
    const widths = await page.evaluate(() => ({
      client: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    expect(widths.scroll).toBeLessThanOrEqual(widths.client);
  });

  test("desk accepts a valid partial live slate without static backfill", async ({ page }) => {
    await page.route("**/api/model/active", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ fixtures: [{
        competitionId: "eng.1", fixtureId: 777, utcDate: "2099-09-20T19:00:00.000Z",
        home: "Arsenal", away: "Liverpool", homeElo: 1900, awayElo: 1880,
        pHome: 0.44, pDraw: 0.27, pAway: 0.29, pOver2_5: 0.53, pBttsYes: 0.55,
        topScores: [{ score: "1-1", probability: 0.13 }], oddsSources: [],
      }] }),
    }));
    await page.route("**/api/matches/active", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ fixtures: [{
        id: 777, competitionId: "eng.1", homeTeam: "Arsenal", awayTeam: "Liverpool",
        utcDate: "2099-09-20T19:00:00.000Z", status: "SCHEDULED", venue: "Emirates Stadium",
      }] }),
    }));
    await page.route("**/api/matches/recent?competition=eng.1", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ matches: [], clubForm: { teams: [] } }),
    }));

    await page.goto("/");
    await expect(page.getByText("Live model", { exact: true })).toBeVisible();
    await expect(page.locator('[data-testid="desk-featured-fixture"][data-fixture-id="espn:eng.1:777"]')).toBeVisible();
    await expect(page.getByText("11", { exact: true })).toHaveCount(0);
    await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Paper" }).click();
    await expect(page.getByText("No comparison market", { exact: true }).first()).toBeVisible();
  });

  test("desk tells the truth when the live slate has no priced fixtures or captured forecasts", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("pundit-desk-v2", JSON.stringify({
        state: {
          cash: 9800,
          tickets: [
            {
              id: "settling-ticket",
              legs: [{ fixtureId: "espn:eng.1:778", market: "away", price: 1.6 }],
              stake: 100,
              price: 1.6,
              status: "open",
              pnl: 0,
              placedAt: 1,
            },
            {
              id: "stale-ticket",
              legs: [{ fixtureId: "gw4-sun-ars", market: "away", price: 1.6 }],
              stake: 100,
              price: 1.6,
              status: "open",
              pnl: 0,
              placedAt: 1,
            },
          ],
          selectedId: "espn:eng.1:778",
          scores: { "espn:eng.1:778": [1, 2] },
          vaultAlloc: { alpha: 0, neutral: 0, yield: 0 },
          messages: [],
        },
        version: 0,
      }));
    });
    await page.route("**/api/model/active", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ fixtures: [] }),
    }));
    await page.route("**/api/matches/active", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ fixtures: [] }),
    }));
    await page.route("**/api/matches/recent?competition=eng.1", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        matches: [{
          id: 778,
          competitionId: "eng.1",
          homeTeam: "Everton",
          awayTeam: "Chelsea",
          utcDate: "2026-09-13T14:00:00.000Z",
          status: "STATUS_FINAL",
          score: { home: 1, away: 2 },
        }],
        clubForm: { teams: [] },
      }),
    }));

    await page.goto("/");
    await expect(page.getByText("No priced fixtures", { exact: true })).toBeVisible();
    await expect(page.getByText("No priced fixtures are live right now.", { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/Pinned ·/)).toHaveCount(0);
    await expect(page.getByText("NO FORECAST", { exact: true })).toBeVisible();
    await expect(page.getByText("MISS", { exact: true })).toHaveCount(0);
    await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Paper" }).click();
    await expect(page.getByText("No captured settled forecasts", { exact: true })).toBeVisible();
    await expect(page.getByText("won", { exact: true })).toBeVisible();
    await expect(page.getByTestId("paper-position-count")).toHaveText("1");
    await expect(page.locator('[data-ticket-id="stale-ticket"]')).toHaveCount(0);
    await expect(page.getByText("10,060", { exact: false }).first()).toBeVisible();
    await expect(page.getByText(/NaN|GW3|GW4/)).toHaveCount(0);
  });

  test("desk binds a user line to its selected fixture and clears it on fixture change", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await routeTwoFixtureDeskSlate(page);
    const requests: Array<Record<string, unknown>> = [];
    await page.route("**/api/ask", async (route) => {
      requests.push(route.request().postDataJSON());
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ answer: "No line is attached to this fixture.", grounding: null }),
      });
    });
    await page.goto("/");
    const fixtures = page.locator('[data-testid="desk-slate-fixture"]:visible');
    await expect(fixtures).toHaveCount(2);
    await fixtures.nth(0).click();
    const line = page.getByTestId("desk-user-line-decimal");
    await line.fill("2.10");
    await page.getByTestId("desk-user-line-outcome-away").click();
    await fixtures.nth(1).click();
    await expect(line).toHaveValue("");
    await expect(page.getByTestId("desk-user-line-outcome-home")).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "+EV", exact: true }).click();
    await expect.poll(() => requests.length).toBe(1);
    expect(requests[0]).not.toHaveProperty("userLine");
  });

  test("New Chat clears fixture-only context before any message is sent", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await routeTwoFixtureDeskSlate(page);
    await page.goto("/");
    await page.locator('[data-testid="desk-slate-fixture"]:visible').first().click();
    const reset = page.getByRole("button", { name: "New Chat" });
    await expect(reset).toBeEnabled();
    await reset.click();
    await expect(page.getByText(/Pinned ·/)).toHaveCount(0);
    await expect(reset).toBeDisabled();
  });

  test("desk retries after a failed ask without sending dangling history", async ({ page }) => {
    await routeTwoFixtureDeskSlate(page);
    let call = 0;
    const requests: Array<Record<string, unknown>> = [];
    await page.route("**/api/ask", async (route) => {
      call += 1;
      requests.push(route.request().postDataJSON());
      if (call === 1) {
        await route.fulfill({
          status: 502,
          contentType: "application/json",
          body: JSON.stringify({ error: "Analysis generation failed." }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          answer: "Liverpool control the tempo through the half-spaces.",
          grounding: { kind: "match", home: "Liverpool", away: "Fulham" },
        }),
      });
    });
    await page.goto("/");
    await page.locator('[data-testid="desk-slate-fixture"][data-fixture-id="espn:eng.1:902"]:visible').first().click();
    const input = page.getByRole("textbox", { name: "Ask a question" });
    await input.fill("How do Liverpool win this?");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText("Analysis generation failed.", { exact: true })).toBeVisible();
    await expect(page.getByTestId("desk-chat-transcript").getByTestId("desk-user-bubble")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "How do Liverpool win this?" })).toBeVisible();
    await page.getByRole("button", { name: "Tactical matchup" }).click();
    await expect(page.getByText("Liverpool control the tempo through the half-spaces.")).toBeVisible();
    expect(requests).toHaveLength(2);
    expect(requests[1].history).toEqual([]);
  });

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

    await page.goto("/legacy?q=Viking%20vs%20Dinamo%20Zagreb&fixture=espn%3Auefa.champions_qual%3A4");
    await expect.poll(() => received.length).toBe(1);
    expect(received[0].fixtureContext).toEqual({
      fixtureId: "espn:uefa.champions_qual:4",
    });
    expect(received[0].question).toBe("Viking vs Dinamo Zagreb");

    await page.goto("/legacy?q=What%20does%20the%20table%20show%3F");
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
    await expect(nav.getByRole("link", { name: "Paper" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Draft" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Vaults" })).toBeVisible();
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
    await expect(ev).toContainText("large price gap; sensitive to forecast error");
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

    await page.goto("/legacy?q=Preview%20Arsenal%20vs%20Coventry%20City&fixture=espn%3Aeng.1%3A1");
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

test("canonical probability attributes agree across Fixtures, Model and Desk despite aliases", async ({ page }) => {
  const fixtureId = "espn:eng.1:1";
  await page.goto("/fixtures");
  const fixture = page.locator(`[data-testid="fixture-row"][data-fixture-id="${fixtureId}"]`);
  await expect(fixture).toHaveAttribute("data-capability", "priced");
  const values = await Promise.all(["home", "draw", "away"].map((side) => fixture.getAttribute(`data-p-${side}`)));
  await page.goto("/model");
  const model = page.locator(`[data-testid="model-fixture-row"][data-fixture-id="${fixtureId}"]`);
  for (const [index, side] of ["home", "draw", "away"].entries()) {
    await expect(model).toHaveAttribute(`data-p-${side}`, values[index]!);
  }
  await routeTwoFixtureDeskSlate(page);
  await page.route("**/api/ask", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
    answer: "I have the fixture in view.",
    grounding: { ...deskMatchGrounding(fixtureId, "Arsenal FC", "Coventry"), pHome: Number(values[0]), pDraw: Number(values[1]), pAway: Number(values[2]) },
  }) }));
  await page.goto("/");
  await page.getByRole("textbox", { name: "Ask a question" }).fill("Arsenal vs Coventry");
  await page.getByRole("button", { name: "Send" }).click();
  const desk = page.locator(`[data-testid="desk-match-board"][data-fixture-id="${fixtureId}"]`);
  await expect(desk).toHaveAttribute("data-capability", "priced");
  for (const [index, side] of ["home", "draw", "away"].entries()) {
    await expect(desk).toHaveAttribute(`data-p-${side}`, values[index]!);
  }
});
