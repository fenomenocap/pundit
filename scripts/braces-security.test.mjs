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
    assert.throws(() => braces[method](cyclic), { name: "SyntaxError", message: /child cycle/ }, method);
  }
});

test("nonfinite input-limit options cannot bypass the immutable parser cap", () => {
  const atLimit = "a".repeat(10000);
  const overLimit = atLimit + "a";
  for (const maxLength of [NaN, Infinity, -Infinity, 10000, 20000]) {
    for (const method of ["parse", "compile", "expand", "stringify"]) {
      assert.doesNotThrow(() => braces[method](atLimit, { maxLength }));
      assert.throws(() => braces[method](overLimit, { maxLength }), {
        name: "SyntaxError", message: /exceeds max characters \(10000\)/,
      });
    }
    assert.throws(() => braces(overLimit, { maxLength }), /exceeds max characters \(10000\)/);
    assert.throws(() => braces(overLimit, { maxLength, expand: true }), /exceeds max characters \(10000\)/);
  }
  for (const maxLength of [0, 1, 7]) {
    assert.doesNotThrow(() => braces.parse("a".repeat(maxLength), { maxLength }));
    assert.throws(() => braces.parse("a".repeat(maxLength + 1), { maxLength }), /exceeds max characters/);
  }
  for (const maxLength of [-1, -10000]) {
    assert.throws(() => braces.parse("", { maxLength }), { name: "SyntaxError" });
    assert.throws(() => braces.parse("a", { maxLength }), { name: "SyntaxError" });
  }
});

test("the bounded compatibility package works through real micromatch, fast-glob and watcher consumers", async () => {
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

const forkName = "@pundit/brace-patterns";

test("every installed glob and watcher dependency resolves the maintained local package", () => {
  const chokidarRequire = createRequire(tailwindRequire.resolve("chokidar"));
  const fastGlobRequire = createRequire(tailwindRequire.resolve("fast-glob"));
  const fastGlobMicromatchRequire = createRequire(fastGlobRequire.resolve("micromatch"));
  const eslintRequire = createRequire(webRequire.resolve("eslint-config-next"));
  const nextPluginRequire = createRequire(eslintRequire.resolve("@next/eslint-plugin-next"));
  const nextGlobRequire = createRequire(nextPluginRequire.resolve("fast-glob"));
  const nextMicromatchRequire = createRequire(nextGlobRequire.resolve("micromatch"));
  for (const consumer of [micromatchRequire, chokidarRequire, fastGlobMicromatchRequire, nextMicromatchRequire]) {
    const installed = consumer("braces/package.json");
    assert.equal(installed.name, forkName);
    assert.equal(installed.version, "1.0.0");
    assert.equal(installed.private, true);
    assert.equal(consumer("braces"), braces);
  }
});

test("direct AST parent attacks and wide trees are rejected before traversal", () => {
  for (const method of ["compile", "expand", "stringify"]) {
    const root = { type: "root", nodes: [] };
    root.parent = root;
    assert.throws(() => braces[method](root), { name: "SyntaxError", message: /parent link/ });
    const invalidParent = { type: "root", nodes: [{ type: "text", value: "a", parent: {} }] };
    assert.throws(() => braces[method](invalidParent), { name: "SyntaxError", message: /parent link/ });
    const wide = { type: "root", nodes: Array.from({ length: 20000 }, () => ({ type: "text", value: "a" })) };
    assert.throws(() => braces[method](wide), { name: "SyntaxError", message: /max nodes/ });
    const shared = { type: "text", value: "a" };
    if (method !== "expand") assert.equal(braces[method]({ type: "root", nodes: [shared, shared] }), "aa");
  }
});

test("disabled range limits cannot bypass cumulative expansion budgets", () => {
  assert.throws(() => braces.expand("{1..100001}", { rangeLimit: false }), /hard expansion limit/);
  assert.throws(() => braces.expand("{100001..1}", { rangeLimit: false }), /hard expansion limit/);
  assert.throws(() => braces.expand("{1..1000}{1..1000}"), /hard expansion limit/);
  assert.throws(() => braces.expand("{a,b}".repeat(17)), /hard expansion limit/);
  const padded = "0".repeat(5000) + "1";
  assert.throws(() => braces.expand(`{${padded}..100000}`, { maxLength: 20000, rangeLimit: false }), /hard character limit/);
  assert.deepEqual(braces.expand("{10..1..3}", { rangeLimit: false }), ["10", "7", "4", "1"]);
  assert.equal(braces.expand("{1..100000}", { rangeLimit: false }).length, 100000);
});

test("ordinary options, quoted literals and nested brace grammar keep consumer semantics", () => {
  assert.deepEqual(braces.expand("{a,a,b,}", { nodupes: true, noempty: true }), ["a", "b"]);
  assert.deepEqual(braces(["src/{a,b}.ts", "src/{a,b}.ts"], { expand: true, nodupes: true }), ["src/a.ts", "src/b.ts"]);
  assert.deepEqual(braces.expand("{01..05..2}"), ["01", "03", "05"]);
  assert.deepEqual(braces.expand("{e..a..2}"), ["e", "c", "a"]);
  assert.deepEqual(braces.expand("${a,b}"), ["${a,b}"]);
  assert.deepEqual(braces.expand("a/{b,{c,d}}/e"), ["a/b/e", "a/c/e", "a/d/e"]);
  assert.deepEqual(braces.expand("a/{}"), ["a/{}"]);
  const ast = braces.parse("a/{b,{c,d}}/e");
  assert.equal(braces.stringify(ast), "a/{b,{c,d}}/e");
  assert.equal(braces.compile(ast), "a/(b|(c|d))/e");
});


test("direct AST output cannot multiply shared long text beyond the hard bound", () => {
  const shared = { type: "text", value: "a".repeat(1000) };
  const large = { type: "root", nodes: Array.from({ length: 17000 }, () => shared) };
  for (const method of ["compile", "expand", "stringify"]) {
    assert.throws(() => braces[method](large), /hard character limit/);
    assert.throws(() => braces[method]({ type: "text", value: 12 }), /values must be strings/);
  }
});


test("multiple patterns and comma branches share cumulative output budgets", () => {
  assert.throws(() => braces(["{1..60000}", "{1..60000}"], { expand: true, rangeLimit: false }), /hard expansion limit/);
  assert.throws(() => braces(Array.from({ length: 100001 }, () => "a")), /hard expansion limit/);
  const long = "a".repeat(9000);
  assert.throws(() => braces(Array.from({ length: 2000 }, () => long)), /hard character limit/);
  const ast = braces.parse("{a,b}");
  ast.nodes[1].nodes = [{ type: "open", value: "{" }];
  for (let i = 0; i < 2000; i++) {
    if (i) ast.nodes[1].nodes.push({ type: "comma", value: "," });
    ast.nodes[1].nodes.push({ type: "text", value: long });
  }
  ast.nodes[1].nodes.push({ type: "close", value: "}" });
  assert.throws(() => braces.expand(ast), /hard character limit/);
});


test("shared wide DAGs reject scheduled work before queuing all descendant frames", () => {
  const text = { type: "text", value: "a" };
  const branch = { type: "paren", nodes: Array.from({ length: 15000 }, () => text) };
  const ast = { type: "root", nodes: Array.from({ length: 15000 }, () => branch) };
  for (const method of ["compile", "expand", "stringify"]) {
    assert.throws(() => braces[method](ast), /max nodes/);
  }
});
