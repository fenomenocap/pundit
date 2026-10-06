// Manual release comparison. Download braces@3.0.3 into /tmp, never the app graph,
// and pass its unpacked package directory. No network calls or install here.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const upstreamPath = path.resolve(process.argv[2] ?? "");
const packageFile = path.join(upstreamPath, "package.json");
const originalPackage = JSON.parse(readFileSync(packageFile, "utf8"));
assert.equal(originalPackage.name, "braces");
assert.equal(originalPackage.version, "3.0.3");
const webRequire = createRequire(new URL("../packages/web/package.json", import.meta.url));
const tailwindRequire = createRequire(webRequire.resolve("tailwindcss"));
const consumerRequire = createRequire(tailwindRequire.resolve("micromatch"));
const original = createRequire(packageFile)("./");
const bounded = consumerRequire("braces");
assert.equal(consumerRequire("braces/package.json").name, "@pundit/brace-patterns");
const patterns = [
  "", "a", "a/b", "{}", "{a,b}", "{a,a,b,}", "{a,{b,c}}", "{{a,b},{c,d}}",
  "src/{app,desk}/**/*.{ts,tsx}", "a/{b,{c,d}}/e", "${a,b}", "\\{a,b\\}", "[a{}]",
  '"{a,b}"', "'{a,b}'", "(a,{b,c})", "{1..3}", "{3..1}", "{01..05..2}",
  "{-3..3}", "{a..f..2}", "{a,}", "{,a}", "a{b", "a}b", "{a..}", "{{}}",
];
for (let i = 1; i <= 120; i++) {
  const choice = i % 4;
  patterns.push(`p${i}/{a${i},{b${i},c${i}}}/${choice === 0 ? "{01..05}" : "{x,y}"}.{ts,tsx}`);
  patterns.push(`x${i}${i % 2 ? "\\{literal\\}" : '"{literal}"'}{a,b}{${i}..${i + 4}..2}`);
}
const options = [{}, { escapeInvalid: true }, { nodupes: true, noempty: true }, { keepEscaping: true }, { rangeLimit: false }, { step: 2 }];
const compactAst = node => Object.fromEntries(Object.entries(node)
  .filter(([key]) => !["parent", "prev", "queue"].includes(key))
  .map(([key, value]) => [key, key === "nodes" ? value.map(compactAst) : value]));
const observe = (implementation, method, input, option) => {
  try {
    const value = method === "call" ? implementation(input, option) : implementation[method](input, option);
    return { ok: true, value: method === "parse" ? compactAst(value) : value };
  } catch (error) {
    return { ok: false, name: error.name, message: error.message };
  }
};
let comparisons = 0;
for (const pattern of patterns) {
  for (const option of options) {
    for (const method of ["call", "parse", "compile", "expand", "stringify"]) {
      assert.deepEqual(observe(bounded, method, pattern, option), observe(original, method, pattern, option), `${method} ${JSON.stringify(pattern)} ${JSON.stringify(option)}`);
      comparisons++;
    }
  }
}
for (const option of options) {
  assert.deepEqual(bounded(patterns.slice(0, 10), { ...option, expand: true }), original(patterns.slice(0, 10), { ...option, expand: true }));
  comparisons++;
}
const controls = [];
for (const method of ["compile", "expand", "stringify"]) {
  const source = `const b=require(${JSON.stringify(upstreamPath)}); try { b[${JSON.stringify(method)}]('{'.repeat(4500)+'a'+'}'.repeat(4500)); console.log('ACCEPTED'); } catch (e) { console.log(e.name+': '+e.message); }`;
  const child = spawnSync(process.execPath, ["-e", source], { timeout: 3000, encoding: "utf8", maxBuffer: 100000 });
  assert.equal(child.status, 0, `${method}: original control must return its captured stack failure`);
  assert.match(child.stdout, /RangeError: Maximum call stack size exceeded/);
  assert.throws(() => bounded[method]("{".repeat(4500) + "a" + "}".repeat(4500)), { name: "SyntaxError", message: /max depth/ });
  controls.push({ method, original: child.stdout.trim(), replacement: "SyntaxError: bounded nesting" });
}
assert.equal(original(["{1..60000}", "{1..60000}"], { expand: true, rangeLimit: false }).length, 120000);
assert.throws(() => bounded(["{1..60000}", "{1..60000}"], { expand: true, rangeLimit: false }), /hard expansion limit/);
console.log(JSON.stringify({ overall: "PASS", upstream: "braces@3.0.3", replacement: "@pundit/brace-patterns@1.0.0", comparisons, controls, aggregateBudgetControl: "original120000 allowed; replacement rejected" }, null, 2));
