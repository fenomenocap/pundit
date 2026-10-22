import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { applyServerTimeouts, SERVER_HEADERS_TIMEOUT_MS, SERVER_KEEP_ALIVE_TIMEOUT_MS } from "./index";

describe("API server keep-alive timeouts", () => {
  it("keepAliveTimeout 65s and headersTimeout 66s (headers > keep-alive)", () => {
    expect(SERVER_KEEP_ALIVE_TIMEOUT_MS).toBe(65_000);
    expect(SERVER_HEADERS_TIMEOUT_MS).toBe(66_000);
    expect(SERVER_HEADERS_TIMEOUT_MS).toBeGreaterThan(SERVER_KEEP_ALIVE_TIMEOUT_MS);
  });

  it("applyServerTimeouts sets both on a real http.Server", () => {
    const server = createServer();
    try {
      applyServerTimeouts(server);
      expect(server.keepAliveTimeout).toBe(65_000);
      expect(server.headersTimeout).toBe(66_000);
    } finally {
      server.close();
    }
  });
});
