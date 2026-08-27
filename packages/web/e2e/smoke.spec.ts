import { test, expect, type Page } from "@playwright/test";

type ControlledAskRequest = {
  body: Record<string, unknown>;
  signalAborted: boolean;
  readerCanceled: boolean;
  lateCompletionAttempted: boolean;
  lateCompletionRejected: boolean;
};

type ControlledAskControl = {
  requests: ControlledAskRequest[];
  push: (index: number, event: string, data: unknown) => void;
  complete: (index: number, answer: string, grounding: unknown) => void;
  lateComplete: (index: number, answer: string, grounding: unknown) => void;
};

type StopChatWindow = Window & { __stopChatControl?: ControlledAskControl };

async function installControlledAskFetch(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const win = window as StopChatWindow;
    if (win.__stopChatControl) return;

    const nativeFetch = window.fetch.bind(window);
    const encoder = new TextEncoder();
    const requests: ControlledAskRequest[] = [];
    type InternalRequest = ControlledAskRequest & {
      controller: ReadableStreamDefaultController<Uint8Array> | null;
      open: boolean;
      onAbort?: () => void;
      signal?: AbortSignal;
    };
    const internalRequests: InternalRequest[] = [];

    function writeBlock(index: number, block: string, late: boolean): boolean {
      const request = internalRequests[index];
      if (!request?.open || !request.controller) {
        if (late && request) request.lateCompletionRejected = true;
        return false;
      }
      try {
        request.controller.enqueue(encoder.encode(block));
        return true;
      } catch {
        request.open = false;
        if (late) request.lateCompletionRejected = true;
        return false;
      }
    }

    function sseBlock(event: string, data: unknown): string {
      return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    }

    function finish(index: number, answer: string, grounding: unknown, late: boolean): void {
      const request = internalRequests[index];
      if (!request) return;
      if (late) request.lateCompletionAttempted = true;
      const blocks = [
        sseBlock("grounding", { grounding }),
        sseBlock("delta", { text: answer }),
        sseBlock("done", { answer, grounding }),
      ];
      // Leave the transport open: authoritative done must release the reader.
      writeBlock(index, blocks.join(""), late);
    }

    const control: ControlledAskControl = {
      requests,
      push(index, event, data) {
        writeBlock(index, sseBlock(event, data), false);
      },
      complete(index, answer, grounding) {
        finish(index, answer, grounding, false);
      },
      lateComplete(index, answer, grounding) {
        finish(index, answer, grounding, true);
      },
    };
    win.__stopChatControl = control;

    window.fetch = async (input, init) => {
      const requestUrl = input instanceof Request ? input.url : String(input);
      let pathname: string;
      try {
        pathname = new URL(requestUrl, window.location.href).pathname;
      } catch {
        return nativeFetch(input, init);
      }
      if (pathname !== "/api/ask") return nativeFetch(input, init);

      let parsedBody: unknown = {};
      try {
        parsedBody = typeof init?.body === "string" ? JSON.parse(init.body) : {};
      } catch {
        parsedBody = {};
      }
      const request: InternalRequest = {
        body: parsedBody && typeof parsedBody === "object" && !Array.isArray(parsedBody)
          ? parsedBody as Record<string, unknown>
          : {},
        signalAborted: false,
        readerCanceled: false,
        lateCompletionAttempted: false,
        lateCompletionRejected: false,
        controller: null,
        open: true,
        signal: init?.signal ?? undefined,
      };
      requests.push(request);
      internalRequests.push(request);

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          request.controller = controller;
          request.onAbort = () => {
            request.signalAborted = true;
            // Give the helper's abort listener a chance to cancel the reader.
            // If it does not, the pending read still rejects deterministically.
            queueMicrotask(() => {
              if (!request.readerCanceled && request.open) {
                try {
                  controller.error(new DOMException("The operation was aborted.", "AbortError"));
                } catch {
                  // The reader may have been canceled concurrently.
                }
                request.open = false;
              }
            });
          };
          if (request.signal?.aborted) request.onAbort();
          else request.signal?.addEventListener("abort", request.onAbort, { once: true });
        },
        cancel() {
          request.readerCanceled = true;
          request.open = false;
          if (request.onAbort && request.signal) {
            request.signal.removeEventListener("abort", request.onAbort);
          }
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    };
  });
}

async function controlledAskRequests(page: Page): Promise<ControlledAskRequest[]> {
  return page.evaluate(() => {
    const control = (window as StopChatWindow).__stopChatControl;
    return control?.requests.map((request) => ({
      body: request.body,
      signalAborted: request.signalAborted,
      readerCanceled: request.readerCanceled,
      lateCompletionAttempted: request.lateCompletionAttempted,
      lateCompletionRejected: request.lateCompletionRejected,
    })) ?? [];
  });
}

async function pushControlledAskEvent(page: Page, index: number, event: string, data: unknown): Promise<void> {
  await page.evaluate(({ index: requestIndex, event: eventName, data: eventData }) => {
    (window as StopChatWindow).__stopChatControl?.push(requestIndex, eventName, eventData);
  }, { index, event, data });
}

async function completeControlledAsk(
  page: Page,
  index: number,
  answer: string,
  grounding: unknown = null,
  late = false
): Promise<void> {
  await page.evaluate(({ index: requestIndex, answer: answerText, grounding: answerGrounding, late: lateAnswer }) => {
    const control = (window as StopChatWindow).__stopChatControl;
    if (lateAnswer) control?.lateComplete(requestIndex, answerText, answerGrounding);
    else control?.complete(requestIndex, answerText, answerGrounding);
  }, { index, answer, grounding, late });
}

const STOP_TEST_FIXTURE_GROUNDING = {
  kind: "fixture" as const,
  fixture: {
    fixtureId: "espn:club.friendly:991",
    primarySource: "espn" as const,
    primarySourceFixtureId: "991",
    homeTeam: { id: "arsenal", name: "Arsenal" },
    awayTeam: { id: "liverpool", name: "Liverpool" },
    kickoff: "2026-08-18T19:00:00.000Z",
    venue: "National Stadium",
    neutralVenue: true,
    competition: { id: "club.friendly", name: "Club Friendly", category: "club-friendly" as const },
    status: "scheduled" as const,
    recognition: "authoritative" as const,
  },
  capability: { status: "outside-coverage" as const, reason: "friendly-policy-disabled" as const },
};

async function expectNoChatError(page: Page): Promise<void> {
  await expect(page.locator('[aria-relevant="additions text"]').getByRole("alert")).toHaveCount(0);
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

  test("stopping before the first delta restores the shared prompt and its fixture identity", async ({ page }) => {
    await installControlledAskFetch(page);
    const question = "Arsenal vs Liverpool friendly";
    const fixtureId = "espn:club.friendly:991";
    await page.goto(`/?q=${encodeURIComponent(question)}&fixture=${encodeURIComponent(fixtureId)}`);

    const input = page.getByRole("textbox", { name: "Ask a question" });
    await expect.poll(async () => (await controlledAskRequests(page)).length).toBe(1);

    const stop = page.getByRole("button", { name: "Stop generating" });
    await expect(stop).toBeVisible();
    await stop.click();
    await expect.poll(async () => {
      const request = (await controlledAskRequests(page))[0];
      return {
        signalAborted: request?.signalAborted,
        readerCanceled: request?.readerCanceled,
      };
    }).toEqual({ signalAborted: true, readerCanceled: true });

    expect((await controlledAskRequests(page)).length).toBe(1);
    await expect(input).toHaveValue(question);
    await expect(input).toBeEnabled();
    await expect(page.getByRole("status")).toHaveText("Response stopped.");
    await expect(page.getByText(question, { exact: true })).toHaveCount(0);
    await expectNoChatError(page);

    await page.getByRole("button", { name: "Send" }).click();
    await expect.poll(async () => (await controlledAskRequests(page)).length).toBe(2);
    const requests = await controlledAskRequests(page);
    expect(requests[1].body).toMatchObject({ question, history: [], fixtureContext: { fixtureId } });

    await stop.click();
    await expect(input).toBeEnabled();
    await input.fill("After stop");
    await page.getByRole("button", { name: "Send" }).click();
    await expect.poll(async () => (await controlledAskRequests(page)).length).toBe(3);
    const editedRequest = (await controlledAskRequests(page))[2];
    expect(editedRequest.body).toMatchObject({ question: "After stop", history: [] });
    expect(editedRequest.body).not.toHaveProperty("fixtureContext");

    await completeControlledAsk(page, 2, "New response");
    await expect(page.getByText("New response", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
    expect((await controlledAskRequests(page))[2].readerCanceled).toBe(true);
  });

  test("stopping mid-stream discards partial history and keeps completed fixture context", async ({ page }) => {
    await installControlledAskFetch(page);
    await page.goto("/");

    const input = page.getByRole("textbox", { name: "Ask a question" });
    const firstQuestion = "Arsenal vs Liverpool friendly";
    const firstAnswer = "Completed fixture context.";
    await input.fill(firstQuestion);
    await page.getByRole("button", { name: "Send" }).click();
    await expect.poll(async () => (await controlledAskRequests(page)).length).toBe(1);
    await completeControlledAsk(page, 0, firstAnswer, STOP_TEST_FIXTURE_GROUNDING);
    await expect(page.getByText(firstAnswer, { exact: true })).toBeVisible();
    await expect(page.getByText("Following: Arsenal vs Liverpool", { exact: true }).first()).toBeVisible();

    const interruptedQuestion = "Tell me more about that match";
    await input.fill(interruptedQuestion);
    await page.getByRole("button", { name: "Send" }).click();
    await expect.poll(async () => (await controlledAskRequests(page)).length).toBe(2);
    const initialRequests = await controlledAskRequests(page);
    expect(initialRequests[1].body.fixtureContext).toEqual({ fixtureId: "espn:club.friendly:991" });
    expect(initialRequests[1].body.history).toEqual([
      { role: "user", content: firstQuestion },
      { role: "assistant", content: firstAnswer },
    ]);

    const partialAnswer = "Partial answer that must disappear.";
    await pushControlledAskEvent(page, 1, "grounding", { grounding: STOP_TEST_FIXTURE_GROUNDING });
    await pushControlledAskEvent(page, 1, "delta", { text: partialAnswer });
    await expect(page.getByText(partialAnswer, { exact: true })).toBeVisible();
    const stop = page.getByRole("button", { name: "Stop generating" });
    await expect(stop).toBeVisible();
    await stop.click();
    await expect.poll(async () => {
      const request = (await controlledAskRequests(page))[1];
      return {
        signalAborted: request?.signalAborted,
        readerCanceled: request?.readerCanceled,
      };
    }).toEqual({ signalAborted: true, readerCanceled: true });

    const lateAnswer = "Late completion that must not render.";
    await completeControlledAsk(page, 1, lateAnswer, STOP_TEST_FIXTURE_GROUNDING, true);
    await expect.poll(async () => {
      const request = (await controlledAskRequests(page))[1];
      return {
        lateCompletionAttempted: request?.lateCompletionAttempted,
        lateCompletionRejected: request?.lateCompletionRejected,
      };
    }).toEqual({ lateCompletionAttempted: true, lateCompletionRejected: true });
    await expect(page.getByText(partialAnswer, { exact: true })).toHaveCount(0);
    await expect(page.getByText(lateAnswer, { exact: true })).toHaveCount(0);
    await expect(page.getByText(firstAnswer, { exact: true })).toBeVisible();
    await expect(page.getByText("Following: Arsenal vs Liverpool", { exact: true }).first()).toBeVisible();
    await expect(page.getByText(interruptedQuestion, { exact: true })).toHaveCount(0);
    await expect(input).toHaveValue(interruptedQuestion);
    await expect(input).toBeEnabled();
    await expect(page.getByRole("status")).toHaveText("Response stopped.");
    await expectNoChatError(page);

    const finalQuestion = "Final follow up";
    const finalAnswer = "Final response";
    await input.fill(finalQuestion);
    await page.getByRole("button", { name: "Send" }).click();
    await expect.poll(async () => (await controlledAskRequests(page)).length).toBe(3);
    const finalRequests = await controlledAskRequests(page);
    expect(finalRequests[2].body.fixtureContext).toEqual({ fixtureId: "espn:club.friendly:991" });
    expect(finalRequests[2].body.history).toEqual([
      { role: "user", content: firstQuestion },
      { role: "assistant", content: firstAnswer },
    ]);
    await completeControlledAsk(page, 2, finalAnswer, STOP_TEST_FIXTURE_GROUNDING);
    await expect(page.getByText(finalAnswer, { exact: true })).toBeVisible();
  });

  test("unmounting chat aborts its active stream", async ({ page }) => {
    await installControlledAskFetch(page);
    await page.goto("/");

    const input = page.getByRole("textbox", { name: "Ask a question" });
    await input.fill("Navigate away while waiting");
    await page.getByRole("button", { name: "Send" }).click();
    await expect.poll(async () => (await controlledAskRequests(page)).length).toBe(1);
    await expect(page.getByRole("button", { name: "Stop generating" })).toBeVisible();

    await page.getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name: "Fixtures" }).click();
    await expect(page).toHaveURL(/\/fixtures$/);
    await expect(page.getByRole("heading", { name: "Fixtures" })).toBeVisible();
    await expect.poll(async () => {
      const request = (await controlledAskRequests(page))[0];
      return {
        signalAborted: request?.signalAborted,
        readerCanceled: request?.readerCanceled,
      };
    }).toEqual({ signalAborted: true, readerCanceled: true });
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
