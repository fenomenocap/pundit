import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const webRequire = createRequire(new URL("../packages/web/package.json", import.meta.url));
const tailwindRequire = createRequire(webRequire.resolve("tailwindcss"));
const micromatchRequire = createRequire(tailwindRequire.resolve("micromatch"));
const braces = micromatchRequire("braces");
const depthError = { name: "SyntaxError", message: /nesting exceeds max depth \(100\)/ };
const nested = (depth, open = "{", close = "}") => open.repeat(depth) + "a" + close.repeat(depth);

test("advisory-sized nested patterns stop before recursive stack exhaustion", () => {
  const exploit = nested(4500);
  assert.equal(exploit.length, 9001); // Below the upstream 10,000-character cap.
  for (const pattern of [exploit, nested(4500, "(", ")"), "{(".repeat(2200) + "a" + ")}".repeat(2200)]) {
    for (const method of ["parse", "compile", "expand", "stringify"]) {
      assert.throws(() => braces[method](pattern), depthError, method);
    }
    assert.throws(() => braces(pattern), depthError);
    assert.throws(() => braces(pattern, { expand: true }), depthError);
  }
});

test("the nesting boundary cannot be disabled while ordinary and literal syntax survives", () => {
  for (const [open, close] of [["{", "}"], ["(", ")"]]) {
    for (const method of ["parse", "compile", "expand", "stringify"]) {
      assert.doesNotThrow(() => braces[method](nested(100, open, close)));
      assert.throws(() => braces[method](nested(101, open, close), { maxDepth: Infinity }), depthError);
    }
  }
  assert.deepEqual(braces.expand("src/{app,desk}/**/*.{ts,tsx}"), [
    "src/app/**/*.ts", "src/app/**/*.tsx", "src/desk/**/*.ts", "src/desk/**/*.tsx",
  ]);
  assert.deepEqual(braces.expand("file-{1..3}.ts"), ["file-1.ts", "file-2.ts", "file-3.ts"]);
  assert.equal(braces.compile("a/{b,{c,d}}/e"), "a/(b|(c|d))/e");
  for (const literal of ["\\{".repeat(500), '"' + "{".repeat(500) + '"', "[" + "{".repeat(500) + "]"]) {
    assert.doesNotThrow(() => braces.compile(literal));
  }
  assert.throws(() => braces.parse("a".repeat(10001)), /exceeds max characters/);
  assert.throws(() => braces.expand("{1..1001}"), /exceeds range limit/);
});

test("direct AST callers cannot bypass the depth guard with deep or cyclic nodes", () => {
  const ast = { type: "root", nodes: [] };
  let node = ast;
  for (let depth = 0; depth < 4500; depth++) {
    const child = { type: "paren", nodes: [] };
    node.nodes.push(child);
    node = child;
  }
  node.nodes.push({ type: "text", value: "a" });
  for (const method of ["compile", "expand", "stringify"]) {
    assert.throws(() => braces[method](ast), depthError, method);
    const cyclic = { type: "root", nodes: [] };
    cyclic.nodes.push(cyclic);
    assert.throws(() => braces[method](cyclic), depthError, method);
  }
});

test("the patched package works through real micromatch, fast-glob and watcher consumers", async () => {
  const micromatch = tailwindRequire("micromatch");
  const fastGlob = tailwindRequire("fast-glob");
  const chokidar = tailwindRequire("chokidar");
  assert.deepEqual(micromatch(["src/a.ts", "src/b.tsx", "src/c.js"], "src/*.{ts,tsx}"), ["src/a.ts", "src/b.tsx"]);
  assert.throws(() => micromatch.braces(nested(4500)), depthError);
  const directory = await mkdtemp(path.join(os.tmpdir(), "pundit-braces-consumers-"));
  let watcher;
  try {
    await mkdir(path.join(directory, "src"));
    await writeFile(path.join(directory, "src", "a.ts"), "export const value = 1;\n");
    await writeFile(path.join(directory, "src", "b.tsx"), "export const View = null;\n");
    await writeFile(path.join(directory, "src", "c.js"), "module.exports = {};\n");
    assert.deepEqual((await fastGlob("src/*.{ts,tsx}", { cwd: directory })).sort(), ["src/a.ts", "src/b.tsx"]);
    const added = [];
    watcher = chokidar.watch("src/*.{ts,tsx}", { cwd: directory, ignoreInitial: false });
    watcher.on("add", (file) => added.push(file));
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("watcher readiness timed out")), 5000);
      watcher.once("error", (error) => { clearTimeout(timer); reject(error); });
      watcher.once("ready", () => { clearTimeout(timer); resolve(); });
    });
    assert.deepEqual(added.sort(), ["src/a.ts", "src/b.tsx"]);
  } finally {
    await watcher?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
