import { IncomingMessage, ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { Duplex } from "node:stream";
import { describe, expect, it } from "vitest";
import { app } from "./index";

async function preflight(headers: Record<string, string>): Promise<{ status: number; raw: string }> {
  const chunks: Buffer[] = [];
  const socket = new Duplex({
    read() {},
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      callback();
    },
  });
  Object.defineProperty(socket, "remoteAddress", { value: "127.0.0.1" });
  const request = new IncomingMessage(socket as unknown as Socket);
  request.method = "OPTIONS";
  request.url = "/api/ask";
  request.headers = {
    host: "localhost",
    origin: "https://thepundit.vercel.app",
    "access-control-request-method": "POST",
    ...headers,
  };
  const response = new ServerResponse(request);
  response.assignSocket(socket as unknown as Socket);
  await new Promise<void>((resolve, reject) => {
    response.once("finish", resolve);
    response.once("error", reject);
    app(request, response);
    request.emit("end");
  });
  return { status: response.statusCode ?? 0, raw: Buffer.concat(chunks).toString("utf8") };
}

describe("CORS allows x-pundit-take", () => {
  it("reflects x-pundit-take on the /api/ask preflight", async () => {
    const result = await preflight({
      "access-control-request-headers": "content-type,x-pundit-take",
    });
    expect(result.status).toBe(204);
    expect(result.raw.toLowerCase()).toContain("access-control-allow-headers:");
    expect(result.raw.toLowerCase()).toContain("x-pundit-take");
    expect(result.raw.toLowerCase()).toContain("content-type");
  });
});
