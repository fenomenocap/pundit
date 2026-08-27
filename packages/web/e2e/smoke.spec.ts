import { test, expect, type Page } from "@playwright/test";

type ModelRequestTestControl = {
  batchCount: number;
  releaseBatches: Record<number, () => void>;
};

type ModelRequestTestWindow = Window & {
  __modelRequestTestControl?: ModelRequestTestControl;
};

type ModelRequestTestOptions = {
  holdBatches?: number[];
  failBatches?: number[];
  errorBatches?: number[];
  pHomeByBatch?: Record<number, number>;
  nullLastUpdatedBatches?: number[];
  failCompetitionMetadataCalls?: number[];
  competitionIdsByCall?: Array<string[] | null>;
};

async function installModelRequestControl(
  page: Page,
  options: ModelRequestTestOptions = {},
): Promise<void> {
  await page.addInitScript(
    ({
      holdBatches = [],
      failBatches = [],
      errorBatches = [],
      pHomeByBatch = {},
      nullLastUpdatedBatches = [],
      failCompetitionMetadataCalls = [],
      competitionIdsByCall = [],
    }) => {
      const originalPromiseAll = Promise.all.bind(Promise) as (
        values: Iterable<unknown>
      ) => Promise<unknown[]>;
      const promiseConstructor = Promise as unknown as {
        all: (values: Iterable<unknown>) => Promise<unknown[]>;
      };
      const control: ModelRequestTestControl = {
        batchCount: 0,
        releaseBatches: {},
      };
      (window as ModelRequestTestWindow).__modelRequestTestControl = control;

      const isRecord = (value: unknown): value is Record<string, unknown> => (
        typeof value === "object" && value !== null && !Array.isArray(value)
      );

      let competitionMetadataCallCount = 0;
      const competitionResponseVariants = new WeakMap<object, unknown>();
      const promisePrototype = Promise.prototype as unknown as {
        then: (
          onFulfilled?: (value: unknown) => unknown,
          onRejected?: (reason: unknown) => unknown,
        ) => Promise<unknown>;
      };
      const originalThen = promisePrototype.then;
      promisePrototype.then = function (
        this: Promise<unknown>,
        onFulfilled,
        onRejected,
      ) {
        return originalThen.call(
          this,
          (value: unknown) => {
            if (isRecord(value) && Array.isArray(value.competitions)) {
              if (competitionResponseVariants.has(value)) {
                const deliveredValue = competitionResponseVariants.get(value);
                return onFulfilled ? onFulfilled(deliveredValue) : deliveredValue;
              }
              const call = ++competitionMetadataCallCount;
              if (failCompetitionMetadataCalls.includes(call)) {
                competitionResponseVariants.set(value, null);
                const reason = new Error(`Synthetic competition metadata failure for call ${call}`);
                return onRejected ? onRejected(reason) : Promise.reject(reason);
              }
              const configuredIds = competitionIdsByCall[call - 1];
              const deliveredValue = Array.isArray(configuredIds)
                ? {
                    ...value,
                    competitions: value.competitions.filter((competition) => (
                      isRecord(competition)
                      && typeof competition.id === "string"
                      && configuredIds.includes(competition.id)
                    )),
                  }
                : value;
              competitionResponseVariants.set(value, deliveredValue);
              if (isRecord(deliveredValue)) {
                competitionResponseVariants.set(deliveredValue, deliveredValue);
              }
              return onFulfilled ? onFulfilled(deliveredValue) : deliveredValue;
            }
            return onFulfilled ? onFulfilled(value) : value;
          },
          onRejected,
        );
      };

      promiseConstructor.all = (values) => originalPromiseAll(values).then((items) => {
        if (!Array.isArray(items) || items.length !== 3) return items;
        const [model, competitionResult, readiness] = items;
        const hasCompetitionData = competitionResult === null || (
          isRecord(competitionResult) && Array.isArray(competitionResult.competitions)
        );
        if (
          !isRecord(model)
          || !Array.isArray(model.fixtures)
          || !hasCompetitionData
          || !(
            readiness === null
            || (isRecord(readiness) && isRecord(readiness.model))
          )
        ) {
          return items;
        }

        const batch = ++control.batchCount;
        const responseError = errorBatches.includes(batch)
          ? `Synthetic model response failure for batch ${batch}`
          : undefined;
        const pHome = pHomeByBatch[batch];
        const fixtures = typeof pHome === "number"
          ? model.fixtures.map((fixture, index) => (
              index === 0 && isRecord(fixture)
                ? { ...fixture, pHome, pDraw: 0.2, pAway: 0.8 - pHome }
                : fixture
            ))
          : model.fixtures;
        const response = {
          ...model,
          fixtures,
          ...(responseError === undefined ? {} : { error: responseError }),
          ...(nullLastUpdatedBatches.includes(batch) ? { lastUpdated: null } : {}),
        };
        items[0] = response;

        const reject = () => Promise.reject(new Error(
          `Synthetic model request failure for batch ${batch}`
        ));
        if (holdBatches.includes(batch)) {
          return new Promise<unknown[]>((resolve, rejectBatch) => {
            control.releaseBatches[batch] = () => {
              if (failBatches.includes(batch)) {
                rejectBatch(new Error(`Synthetic model request failure for batch ${batch}`));
              } else {
                resolve(items);
              }
            };
          });
        }
        return failBatches.includes(batch) ? reject() : items;
      });
    },
    options,
  );
}

async function modelRequestBatchCount(page: Page): Promise<number> {
  return page.evaluate(
    () => (window as ModelRequestTestWindow).__modelRequestTestControl?.batchCount ?? 0
  );
}

async function releaseModelRequestBatch(page: Page, batch: number): Promise<void> {
  await page.evaluate(async (batchNumber) => {
    const release = (window as ModelRequestTestWindow)
      .__modelRequestTestControl?.releaseBatches[batchNumber];
    if (!release) throw new Error(`Model request batch ${batchNumber} is not held`);
    release();
    // Let the released promise and React's resulting render settle before a
    // negative assertion can accidentally pass against the previous frame.
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  }, batch);
}

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

  test("model", async ({ page }) => {
    await page.goto("/model");
    await expect(page.getByRole("heading", { name: "Club season model" })).toBeVisible();
    const table = page.locator("table");
    const emptyState = page.getByText("No upcoming fixtures in the next 14 days");
    await expect(table.or(emptyState)).toBeVisible({ timeout: 15_000 });
  });

  test("model keeps fixtures visible when competition metadata fails", async ({ page }) => {
    await installModelRequestControl(page, { failCompetitionMetadataCalls: [1] });
    await page.goto("/model");

    await expect(page.getByRole("alert").filter({
      hasText: "Competition filters unavailable. Showing all model fixtures.",
    })).toBeVisible();
    const all = page.getByRole("button", { name: "All", exact: true });
    await expect(all).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "Premier League", exact: true })).toHaveCount(0);
    await expect(page.locator("tr").filter({ hasText: "Arsenal · Coventry City" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(page.getByRole("button", { name: "Premier League", exact: true })).toBeVisible();
    await expect(page.getByText("Competition filters unavailable. Showing all model fixtures.", { exact: true }))
      .toHaveCount(0);
    await expect(page.locator("tr").filter({ hasText: "Arsenal · Coventry City" })).toBeVisible();
  });

  test("model retains a selected filter through metadata failure and resets it when removed", async ({ page }) => {
    await installModelRequestControl(page, {
      errorBatches: [1],
      failCompetitionMetadataCalls: [2],
      competitionIdsByCall: [null, null, []],
    });
    await page.goto("/model");

    await expect(page.getByRole("alert").filter({
      hasText: "Synthetic model response failure for batch 1",
    })).toBeVisible();
    const all = page.getByRole("button", { name: "All", exact: true });
    const qualifiers = page.getByRole("button", {
      name: "UEFA Champions League Qualifiers",
      exact: true,
    });
    await expect(qualifiers).toBeVisible();
    await qualifiers.click();
    await expect(qualifiers).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("tr").filter({ hasText: "Viking · Dinamo Zagreb" })).toBeVisible();
    await expect(page.locator("tr").filter({ hasText: "Arsenal · Coventry City" })).toHaveCount(0);

    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(page.getByRole("alert").filter({
      hasText: "Competition filters could not refresh. Showing the last known filters.",
    })).toBeVisible();
    await expect(qualifiers).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("tr").filter({ hasText: "Viking · Dinamo Zagreb" })).toBeVisible();
    await expect(page.locator("tr").filter({ hasText: "Arsenal · Coventry City" })).toHaveCount(0);

    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(page.getByRole("button", {
      name: "UEFA Champions League Qualifiers",
      exact: true,
    })).toHaveCount(0);
    await expect(all).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("tr").filter({ hasText: "Viking · Dinamo Zagreb" })).toBeVisible();
    await expect(page.locator("tr").filter({ hasText: "Arsenal · Coventry City" })).toBeVisible();
    await expect(page.getByText("Competition filters could not refresh. Showing the last known filters.", {
      exact: true,
    })).toHaveCount(0);
  });

  test("model expanded row shows cached market comparison", async ({ page }) => {
    await page.goto("/model");
    const arsenal = page.locator("tr").filter({ hasText: "Arsenal · Coventry City" });
    await expect(arsenal).toBeVisible();
    await arsenal.getByRole("button", { name: "Expand details" }).click();
    await expect(page.getByText("Markets", { exact: true })).toBeVisible();
    await expect(page.getByText("Polymarket", { exact: true })).toBeVisible();
    await expect(page.getByText("68.0%")).toBeVisible();
    await expect(page.getByText("Stake", { exact: true })).toHaveCount(0);
  });

  test("model Retry ignores an older successful response", async ({ page }) => {
    await installModelRequestControl(page, {
      holdBatches: [2],
      errorBatches: [1],
      pHomeByBatch: { 2: 0.11, 3: 0.63 },
      nullLastUpdatedBatches: [1],
    });

    await page.goto("/model");
    const initialError = page.getByRole("alert").filter({ hasText: "Synthetic model response failure for batch 1" });
    await expect(initialError).toBeVisible();
    await expect.poll(() => modelRequestBatchCount(page)).toBe(1);

    await page.getByRole("button", { name: "Retry" }).click();
    await expect.poll(() => modelRequestBatchCount(page)).toBe(2);
    await page.getByRole("button", { name: "Retry" }).click();
    await expect.poll(() => modelRequestBatchCount(page)).toBe(3);

    const latestProbability = page.getByRole("img", {
      name: "Arsenal 63.0%, Draw 20.0%, Coventry City 17.0%.",
    });
    await expect(latestProbability).toBeVisible();
    await releaseModelRequestBatch(page, 2);
    await expect(latestProbability).toBeVisible();
    await expect(page.getByRole("img", {
      name: "Arsenal 11.0%, Draw 20.0%, Coventry City 69.0%.",
    })).toHaveCount(0);
  });

  test("model Retry ignores an older failed response", async ({ page }) => {
    await installModelRequestControl(page, {
      holdBatches: [2],
      failBatches: [2],
      errorBatches: [1],
      pHomeByBatch: { 3: 0.63 },
      nullLastUpdatedBatches: [1],
    });

    await page.goto("/model");
    const initialError = page.getByRole("alert").filter({ hasText: "Synthetic model response failure for batch 1" });
    await expect(initialError).toBeVisible();
    await expect.poll(() => modelRequestBatchCount(page)).toBe(1);

    await page.getByRole("button", { name: "Retry" }).click();
    await expect.poll(() => modelRequestBatchCount(page)).toBe(2);
    await page.getByRole("button", { name: "Retry" }).click();
    await expect.poll(() => modelRequestBatchCount(page)).toBe(3);

    const latestProbability = page.getByRole("img", {
      name: "Arsenal 63.0%, Draw 20.0%, Coventry City 17.0%.",
    });
    await expect(latestProbability).toBeVisible();
    await expect(page.getByRole("alert").filter({ hasText: "Synthetic model" })).toHaveCount(0);
    await releaseModelRequestBatch(page, 2);
    await expect(latestProbability).toBeVisible();
    await expect(page.getByRole("alert").filter({ hasText: "Synthetic model" })).toHaveCount(0);
  });

  test("model Retry keeps loading while an older request finishes", async ({ page }) => {
    await installModelRequestControl(page, {
      holdBatches: [2, 3],
      errorBatches: [1],
      pHomeByBatch: { 3: 0.63 },
      nullLastUpdatedBatches: [1],
    });

    await page.goto("/model");
    const initialError = page.getByRole("alert").filter({ hasText: "Synthetic model response failure for batch 1" });
    await expect(initialError).toBeVisible();
    await expect.poll(() => modelRequestBatchCount(page)).toBe(1);

    await page.getByRole("button", { name: "Retry" }).click();
    await expect.poll(() => modelRequestBatchCount(page)).toBe(2);
    await page.getByRole("button", { name: "Retry" }).click();
    await expect.poll(() => modelRequestBatchCount(page)).toBe(3);
    await expect(page.getByText("Loading…", { exact: true })).toBeVisible();

    await releaseModelRequestBatch(page, 2);
    await expect(page.getByText("Loading…", { exact: true })).toBeVisible();

    await releaseModelRequestBatch(page, 3);
    await expect(page.getByRole("img", {
      name: "Arsenal 63.0%, Draw 20.0%, Coventry City 17.0%.",
    })).toBeVisible();
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

    await page.goto("/");
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

    await page.goto("/");
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

    await page.goto("/");
    const input = page.getByRole("textbox", { name: "Ask a question" });
    await input.fill("Arsenal vs Liverpool friendly");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(/Club Friendly · Outside Pundit model coverage/i)).toBeVisible();
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

    await page.goto("/");
    const chip = page.getByRole("button", { name: /Dinamo Zagreb vs Viking/ });
    await expect(chip).toBeVisible();
    await chip.click();

    await expect.poll(() => received.length).toBe(1);
    expect(received[0].fixtureContext).toEqual({ fixtureId: "espn:uefa.champions_qual:3" });
    expect(received[0].question).toContain("Dinamo Zagreb vs Viking");
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

    await page.goto("/");
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
    await expect(nav.getByRole("link", { name: "Chat" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Fixtures" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Predictions" })).toBeVisible();
    await expect(nav.getByText("WC Backtest")).not.toBeVisible();
  });
});
