import { test, expect, type Page } from "@playwright/test";

type FixtureBatchTestControl = {
  fixtureBatchCount: number;
  releaseBatches: Record<number, () => void>;
};

type FixtureBatchTestWindow = Window & {
  __fixtureBatchTestControl?: FixtureBatchTestControl;
};

async function installFixtureBatchControl(
  page: Page,
  options: {
    holdBatches?: number[];
    errorBatches?: number[];
    nullTimestampBatches?: number[];
    markFirstBatchLive?: boolean;
    firstBatchStatuses?: Record<string, string>;
    triggerLivePollOnce?: boolean;
  },
) {
  await page.addInitScript(
    ({
      holdBatches = [],
      errorBatches = [],
      nullTimestampBatches = [],
      markFirstBatchLive = false,
      firstBatchStatuses = {},
      triggerLivePollOnce = false,
    }) => {
      const originalPromiseAll = Promise.all.bind(Promise) as (
        values: Iterable<unknown>
      ) => Promise<unknown[]>;
      const control: FixtureBatchTestControl = {
        fixtureBatchCount: 0,
        releaseBatches: {},
      };
      (window as FixtureBatchTestWindow).__fixtureBatchTestControl = control;

      const promiseConstructor = Promise as unknown as {
        all: (values: Iterable<unknown>) => Promise<unknown[]>;
      };
      promiseConstructor.all = (values) => originalPromiseAll(values).then((items) => {
        if (!Array.isArray(items) || items.length !== 3) return items;
        const [upcoming, recent, standings] = items as Array<{
          matches?: unknown[];
          standings?: unknown[];
        }>;
        if (
          !Array.isArray(upcoming?.matches)
          || !Array.isArray(recent?.matches)
          || !Array.isArray(standings?.standings)
        ) {
          return items;
        }

        control.fixtureBatchCount += 1;
        const batchNumber = control.fixtureBatchCount;
        if (errorBatches.includes(batchNumber)) {
          items[0] = {
            ...(items[0] as Record<string, unknown>),
            error: "Retry fixture load",
          };
        }
        if (nullTimestampBatches.includes(batchNumber)) {
          items[0] = { ...(items[0] as Record<string, unknown>), lastUpdated: null };
          items[1] = { ...(items[1] as Record<string, unknown>), lastUpdated: null };
          items[2] = { ...(items[2] as Record<string, unknown>), lastUpdated: null };
        }
        if (markFirstBatchLive && batchNumber === 1) {
          items[0] = {
            ...(items[0] as Record<string, unknown>),
            matches: upcoming.matches.map((match) => ({
              ...(match as Record<string, unknown>),
              status: "IN_PLAY",
            })),
          };
        }
        if (batchNumber === 1 && Object.keys(firstBatchStatuses).length > 0) {
          items[0] = {
            ...(items[0] as Record<string, unknown>),
            matches: upcoming.matches.map((match) => {
              const fixture = match as Record<string, unknown>;
              return {
                ...fixture,
                status: firstBatchStatuses[String(fixture.id)] ?? fixture.status,
              };
            }),
          };
        }
        if (holdBatches.includes(batchNumber)) {
          return new Promise<unknown[]>((resolve) => {
            control.releaseBatches[batchNumber] = () => resolve(items);
          });
        }
        return items;
      });

      if (triggerLivePollOnce) {
        const originalSetInterval = window.setInterval.bind(window);
        window.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
          if (timeout === 60_000) return window.setTimeout(handler, 5, ...args);
          return originalSetInterval(handler, timeout, ...args);
        }) as typeof window.setInterval;
      }
    },
    options,
  );
}

async function fixtureBatchCount(page: Page): Promise<number> {
  return page.evaluate(
    () => (window as FixtureBatchTestWindow).__fixtureBatchTestControl?.fixtureBatchCount ?? 0
  );
}

async function releaseFixtureBatch(page: Page, batchNumber: number): Promise<void> {
  await page.evaluate(async (requestedBatch) => {
    const control = (window as FixtureBatchTestWindow).__fixtureBatchTestControl;
    const release = control?.releaseBatches[requestedBatch];
    if (!release) throw new Error(`Fixture batch ${requestedBatch} is not waiting.`);
    release();
    // Let the released continuation and React's render settle before checking
    // that stale data stayed absent.
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  }, batchNumber);
}

test.describe("smoke", () => {
  test("postponed and canceled fixtures show their status without an Ask link", async ({ page }) => {
    await installFixtureBatchControl(page, {
      firstBatchStatuses: { "1": "POSTPONED", "2": "CANCELLED" },
    });
    await page.goto("/fixtures");
    const postponed = page.getByTitle("Arsenal", { exact: true })
      .locator("xpath=ancestor::div[contains(@class, 'relative')][1]");
    const canceled = page.getByTitle("Riga FC", { exact: true })
      .locator("xpath=ancestor::div[contains(@class, 'relative')][1]");
    await expect(postponed.getByText("Postponed", { exact: true })).toBeVisible();
    await expect(canceled.getByText("Canceled", { exact: true })).toBeVisible();
    for (const fixture of [postponed, canceled]) {
      await expect(fixture.getByText("Scheduled", { exact: true })).toHaveCount(0);
      await expect(fixture.getByRole("link", { name: "Ask about this match" })).toHaveCount(0);
    }
    await expect(page.getByText("Full Time", { exact: true })).toBeVisible();
  });

  test("unknown fixture status stays unavailable without an Ask link", async ({ page }) => {
    await installFixtureBatchControl(page, { firstBatchStatuses: { "1": "constructor" } });
    await page.goto("/fixtures");
    const fixture = page.getByTitle("Arsenal", { exact: true })
      .locator("xpath=ancestor::div[contains(@class, 'relative')][1]");
    await expect(fixture.getByText("Status unavailable", { exact: true })).toBeVisible();
    await expect(fixture.getByRole("link", { name: "Ask about this match" })).toHaveCount(0);
    await expect(page.getByText("Scheduled", { exact: true })).toBeVisible();
  });

  test("selection clears prior fixture data while the new request is pending", async ({ page }) => {
    await installFixtureBatchControl(page, { holdBatches: [2] });
    await page.goto("/fixtures");
    await expect(page.getByText("Riga FC", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Standings", exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Premier League", exact: true }).click();
    await expect.poll(() => fixtureBatchCount(page)).toBe(2);
    await expect(page.getByText("Riga FC", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Standings", exact: true })).toHaveCount(0);
    await expect(page.getByText("Loading…", { exact: true })).toBeVisible();

    await releaseFixtureBatch(page, 2);
    await expect(page.getByText("Arsenal", { exact: true }).first()).toBeVisible();
  });

  test("fixture selection and retry ignore stale responses", async ({ page }) => {
    await installFixtureBatchControl(page, {
      holdBatches: [1, 3],
      errorBatches: [2, 3],
      nullTimestampBatches: [1],
    });
    await page.goto("/fixtures");
    await expect(page.getByRole("button", { name: "Premier League", exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Premier League", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Retry fixture load" })).toBeVisible();

    await releaseFixtureBatch(page, 1);
    await expect(page.getByRole("alert").filter({ hasText: "Retry fixture load" })).toBeVisible();
    await expect(page.getByText(/^Updated /)).toBeVisible();
    await expect(page.getByText("Riga FC", { exact: true })).toHaveCount(0);

    await page.getByRole("button", { name: "Retry" }).click();
    await expect.poll(() => fixtureBatchCount(page)).toBe(3);
    await page.getByRole("button", { name: "Retry" }).click();
    await expect.poll(() => fixtureBatchCount(page)).toBe(4);
    await expect(page.getByRole("button", { name: "Retry" })).toHaveCount(0);

    await releaseFixtureBatch(page, 3);
    await expect(page.getByRole("button", { name: "Retry" })).toHaveCount(0);
    await expect(page.getByText("Riga FC", { exact: true })).toHaveCount(0);
  });

  test("stale live poll response cannot replace a newer selection", async ({ page }) => {
    await installFixtureBatchControl(page, {
      holdBatches: [2],
      markFirstBatchLive: true,
      triggerLivePollOnce: true,
    });
    await page.goto("/fixtures");
    await expect(page.getByText("Riga FC", { exact: true }).first()).toBeVisible();
    await expect.poll(() => fixtureBatchCount(page)).toBe(2);

    await page.getByRole("button", { name: "Premier League", exact: true }).click();
    await expect(page.getByText("Riga FC", { exact: true })).toHaveCount(0);

    await releaseFixtureBatch(page, 2);
    await expect(page.getByText("Riga FC", { exact: true })).toHaveCount(0);
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
