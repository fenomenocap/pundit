import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import test from "node:test";

const apiRequire = createRequire(new URL("../packages/api/package.json", import.meta.url));
const webRequire = createRequire(new URL("../packages/web/package.json", import.meta.url));
const expressRequire = createRequire(apiRequire.resolve("express"));
const tailwindRequire = createRequire(webRequire.resolve("tailwindcss"));
const postcssRequire = createRequire(webRequire.resolve("postcss"));

test("Express proxy trust rejects the mapped short-prefix spoof while preserving valid forwarding", () => {
  assert.equal(expressRequire("proxy-addr/package.json").version, "2.0.8");
  const express = apiRequire("express");
  const request = (trust, remote, forwarded) => {
    const app = express();
    if (trust !== undefined) app.set("trust proxy", trust);
    const req = Object.create(express.request);
    req.app = app;
    req.socket = { remoteAddress: remote };
    req.headers = { "x-forwarded-for": forwarded };
    return { ip: req.ip, ips: req.ips };
  };
  for (const trust of ["::ffff:10.0.0.0/8", "::/1", ["::/1", "::ffff:10.0.0.0/8"]]) {
    assert.deepEqual(request(trust, "198.51.100.10", "203.0.113.80"), { ip: "198.51.100.10", ips: [] });
    assert.deepEqual(request(trust, "::ffff:198.51.100.10", "203.0.113.80"), { ip: "::ffff:198.51.100.10", ips: [] });
  }
  assert.deepEqual(request(undefined, "198.51.100.10", "203.0.113.80"), { ip: "198.51.100.10", ips: [] });
  for (const trust of ["10.0.0.0/8", "::ffff:10.0.0.0/104"]) {
    assert.deepEqual(request(trust, "10.1.2.3", "203.0.113.80"), { ip: "203.0.113.80", ips: ["203.0.113.80"] });
  }
  // Pundit's production configuration remains one trusted Railway hop.
  assert.deepEqual(request(1, "10.1.2.3", "203.0.113.80, 10.2.3.4"), { ip: "10.2.3.4", ips: ["10.2.3.4"] });
});

test("PostCSS indexed source maps reject excessive, fractional and nested offsets", () => {
  assert.equal(postcssRequire("source-map-js/package.json").version, "1.2.2");
  const { SourceMapConsumer } = postcssRequire("source-map-js");
  const source = { version: 3, sources: ["input.css"], names: [], mappings: "AAAA" };
  const indexed = (line, column = 0, map = source) => ({ version: 3, sections: [{ offset: { line, column }, map }] });
  for (const line of [1e12, Infinity, NaN, -1, 0.5, "1"]) {
    assert.throws(() => new SourceMapConsumer(indexed(line)), /Section offset/);
  }
  for (const column of [-1, 0.5, Infinity, "1"]) {
    assert.throws(() => new SourceMapConsumer(indexed(0, column)), /Section offset/);
  }
  assert.throws(() => new SourceMapConsumer(indexed(7000000, 0, indexed(7000000))), /nested sections/);
  const consumer = new SourceMapConsumer(indexed(2));
  assert.deepEqual(consumer.originalPositionFor({ line: 3, column: 1 }), { source: "input.css", line: 1, column: 0, name: null });
});

test("Tailwind selector parsing handles the advisory-sized flat selector within a bounded process", () => {
  assert.equal(tailwindRequire("postcss-selector-parser/package.json").version, "7.1.6");
  const selectorPath = tailwindRequire.resolve("postcss-selector-parser");
  const source = `const assert=require('node:assert/strict'); const parser=require(${JSON.stringify(selectorPath)}); const selector='.a'.repeat(200000); const root=parser().astSync(selector); assert.equal(root.nodes[0].nodes.length,200000); assert.equal(root.toString(),selector); console.log('PASS');`;
  const result = spawnSync(process.execPath, ["-e", source], { encoding: "utf8", timeout: 6000, maxBuffer: 100000 });
  assert.equal(result.error, undefined, String(result.error));
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "PASS");
  const parser = tailwindRequire("postcss-selector-parser");
  for (const selector of [".dark .bg-bg:hover", ":is(.a,.b) > [data-state=\"open\"]", ".sm\\:hidden", "#desk .text-fg\\/50", "[aria-selected=true]"]) {
    assert.equal(parser().processSync(selector), selector);
  }
});
