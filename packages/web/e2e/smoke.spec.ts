import { test, expect, type Page } from "@playwright/test";

async function installModelResponse(
  page: Page,
  options: { error?: string; marketObservedAt?: string | null },
): Promise<void> {
  await page.addInitScript(({ error, marketObservedAt }) => {
    const originalPromiseAll = Promise.all.bind(Promise) as (
      values: Iterable<unknown>
    ) => Promise<unknown[]>;
    const promiseConstructor = Promise as unknown as {
      all: (values: Iterable<unknown>) => Promise<unknown[]>;
    };
    promiseConstructor.all = (values) => originalPromiseAll(values).then((items) => {
      if (!Array.isArray(items) || items.length !== 3) return items;
      const [model, competitions] = items as Array<{
        fixtures?: unknown[];
        competitions?: unknown[];
      }>;
      if (!Array.isArray(model?.fixtures) || !Array.isArray(competitions?.competitions)) {
        return items;
      }
      items[0] = {
        ...(model as Record<string, unknown>),
        ...(error === undefined ? {} : { error }),
        fixtures: marketObservedAt === undefined ? model.fixtures : model.fixtures.map((fixture) => {
          const row = fixture as Record<string, unknown>;
          return {
            ...row,
            oddsSources: (row.oddsSources as Record<string, unknown>[] | undefined)?.map((source) => ({
              ...source,
              observedAt: marketObservedAt ?? undefined,
            })),
          };
        }),
      };
      return items;
    });
  }, options);
}

type HomeDiscoveryTestControl = {
  statuses: string[];
};

type HomeDiscoveryTestWindow = Window & {
  __homeDiscoveryTestControl?: HomeDiscoveryTestControl;
};

async function installHomeDiscoveryObserver(
  page: Page,
  options: { failModel?: boolean } = {},
): Promise<void> {
  await page.addInitScript(
    ({ failModel = false }) => {
      const statusTexts = [
        "Loading fixture coverage…",
        "Model grounded · active fixtures live",
        "Model not ready — table and general questions still work",
      ];
      const statuses: string[] = [];
      const record = (value: string | null | undefined) => {
        for (const status of statusTexts) {
          if (value?.trim() === status && statuses[statuses.length - 1] !== status) {
            statuses.push(status);
          }
        }
      };
      const inspect = (node: Node) => {
        if (node instanceof Element && node.matches("script, style")) return;
        if (node.nodeType === Node.TEXT_NODE) {
          record(node.nodeValue);
          return;
        }
        for (const child of Array.from(node.childNodes)) inspect(child);
      };
      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.target.parentElement?.closest("script, style")) continue;
          if (mutation.type === "characterData") {
            record(mutation.oldValue);
            record(mutation.target.nodeValue);
          } else {
            mutation.addedNodes.forEach(inspect);
            mutation.removedNodes.forEach(inspect);
          }
        }
      });
      observer.observe(document, {
        childList: true,
        subtree: true,
        characterData: true,
        characterDataOldValue: true,
      });
      inspect(document);
      (window as HomeDiscoveryTestWindow).__homeDiscoveryTestControl = { statuses };

      if (failModel) {
        const originalSlice = Array.prototype.slice;
        let failed = false;
        Array.prototype.slice = function<T>(this: T[], start?: number, end?: number) {
          const first = this[0] as {
            competitionId?: unknown;
            home?: unknown;
            pHome?: unknown;
          } | undefined;
          if (
            !failed
            && typeof first?.competitionId === "string"
            && typeof first.home === "string"
            && typeof first.pHome === "number"
          ) {
            failed = true;
            throw new Error("Synthetic fixture discovery failure");
          }
          return originalSlice.call(this, start, end);
        };
      }
    },
    options,
  );
}

async function homeDiscoveryStatuses(page: Page): Promise<string[]> {
  return page.evaluate(() => (
    (window as HomeDiscoveryTestWindow).__homeDiscoveryTestControl?.statuses ?? []
  ));
}

test.describe("smoke", () => {
  test("homepage reports fixture discovery pending before becoming ready", async ({ page }) => {
    await installHomeDiscoveryObserver(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("Model grounded · active fixtures live", { exact: true })).toBeVisible();
    await expect.poll(() => homeDiscoveryStatuses(page)).toEqual(
      expect.arrayContaining([
        "Loading fixture coverage…",
        "Model grounded · active fixtures live",
      ]),
    );
    const statuses = await homeDiscoveryStatuses(page);
    expect(statuses.indexOf("Loading fixture coverage…"))
      .toBeLessThan(statuses.indexOf("Model grounded · active fixtures live"));
  });

  test("homepage reports unavailable fixture discovery after a failed model load", async ({ page }) => {
    await installHomeDiscoveryObserver(page, { failModel: true });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("Model not ready — table and general questions still work", { exact: true }))
      .toBeVisible();
    await expect.poll(() => homeDiscoveryStatuses(page)).toEqual(
      expect.arrayContaining([
        "Loading fixture coverage…",
        "Model not ready — table and general questions still work",
      ]),
    );
    const statuses = await homeDiscoveryStatuses(page);
    expect(statuses.indexOf("Loading fixture coverage…"))
      .toBeLessThan(statuses.indexOf("Model not ready — table and general questions still work"));
  });

  test("model keeps priced fixtures visible with a partial coverage warning", async ({ page }) => {
    await installModelResponse(page, { error: "Some active fixtures could not be priced." });
    await page.goto("/model");

    await expect(page.getByRole("alert").filter({ hasText: "Some active fixtures could not be priced." }))
      .toBeVisible();
    await expect(
      page.locator("tbody tr").filter({ hasText: "Arsenal · Coventry City" }).first()
    ).toBeVisible();
  });

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
    const bar = page.getByRole("img", { name: "Arsenal 72.0%, Draw 18.0%, Coventry City 10.0%." });
    await expect(bar).toBeVisible();
    await expect(bar).toHaveText("");
    const proportions = await bar.evaluate((element) => {
      const width = element.getBoundingClientRect().width;
      return Array.from(element.children).map((segment) => segment.getBoundingClientRect().width / width);
    });
    for (const [index, probability] of [0.72, 0.18, 0.1].entries()) {
      expect(proportions[index]).toBeCloseTo(probability, 2);
    }
    await expect(bar.locator("..").getByText("72.0%", { exact: true })).toBeVisible();
    await expect(bar.locator("..").getByText("18.0%", { exact: true })).toBeVisible();
    await expect(bar.locator("..").getByText("10.0%", { exact: true })).toBeVisible();
  });

  test("model expanded row shows cached market comparison", async ({ page }) => {
    const fixedNow = "2026-08-27T12:34:56.000Z";
    await page.addInitScript((timestamp) => {
      Date.now = () => Date.parse(timestamp);
    }, fixedNow);
    const observedAt = "2026-08-27T11:20:30.000Z";
    await installModelResponse(page, { marketObservedAt: observedAt });
    await page.goto("/model");
    const arsenal = page.locator("tr").filter({ hasText: "Arsenal · Coventry City" });
    await expect(arsenal).toBeVisible();
    await arsenal.getByRole("button", { name: "Expand details" }).click();
    await expect(page.getByText("Markets", { exact: true })).toBeVisible();
    await expect(page.getByText("Polymarket", { exact: true })).toBeVisible();
    await expect(page.getByText("68.0%")).toBeVisible();
    const expectedObservedLabel = await page.evaluate((timestamp) => (
      `Polymarket · Observed ${new Date(timestamp).toLocaleString()}`
    ), observedAt);
    await expect(page.getByText(expectedObservedLabel, { exact: true })).toBeVisible();
    await expect(page.getByText(/The page update time is the model cache/)).toBeVisible();
    await expect(page.getByText("Stake", { exact: true })).toHaveCount(0);
  });

  for (const observedAt of [null, "not-a-date"]) {
    test(`model market observation time is unavailable when ${observedAt === null ? "missing" : "invalid"}`, async ({ page }) => {
      await installModelResponse(page, { marketObservedAt: observedAt });
      await page.goto("/model");
      await page.locator("tr").filter({ hasText: "Arsenal · Coventry City" })
        .getByRole("button", { name: "Expand details" }).click();
      await expect(page.getByText("Polymarket · Observed time unavailable", { exact: true })).toBeVisible();
      await expect(page.getByText("68.0%")).toBeVisible();
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
    const predictions = nav.getByRole("link", { name: /^(Predictions|Model)$/ });
    await expect(predictions).toBeVisible();
    await expect(predictions).toHaveAttribute("href", "/model");
    await expect(nav.getByText("WC Backtest")).not.toBeVisible();
  });
});
