# Bounded brace-pattern compatibility package

This private build-tool dependency is a maintained fork of [micromatch/braces
3.0.3](https://github.com/micromatch/braces/tree/3.0.3), under its original MIT
license (see LICENSE). The published 3.0.3 tarball integrity is
`sha512-yQbXgO/OSZVD2IsiLlro+7Hf6Q18EJrKSEsdoMzKePKXct3gvD8oLcOQdIzGupr5Fj+EDe8gO/lxc1BzfMpxvA==`. It is not an upstream release. Its package name and version
identify Pundit's implementation; no upstream version is invented.

As checked on 2026-10-06, [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)
affects every published braces version through 3.0.3 and has no patched upstream
release. Tailwind 3, micromatch, fast-glob and Next's ESLint tooling still use it.
The root pnpm override replaces **all** requests for braces with this package.
The former pnpm patch is retired. No advisory is suppressed or ignored.

## Actual security changes

- Compile, stringify and expand traverse ASTs using explicit heap-backed frames;
  flatten and Cartesian concatenation use iterative loops. They do not descend
  recursively through attacker-controlled trees or arrays.
- The already iterative parser enforces an immutable 100-level nesting budget,
  including parentheses, below its original 10,000-character input limit.
- Direct AST entry points validate child cycles, malformed parent links and
  parent cycles before processing. Parser back references (`parent`, `prev`)
  remain supported. AST depth is limited to 101 child edges (root plus 100 input
  nesting levels), and traversal to 20,000 nodes. Shared acyclic children remain
  allowed with finite, structurally valid parent links. Unclosed parser blocks may retain
  a detached brace parent, matching upstream literal behavior.
- Expansion cannot exceed 100,000 results or 16,777,216 UTF-16 code units of accumulated output
  across Cartesian operations, flattened outputs and the top-level pattern array, including when `rangeLimit: false` is
  requested. Numeric range cardinality and padded character bounds are checked
  **before** asking fill-range to allocate. These limits intentionally reject
  pathological expansion; ordinary brace/range/glob options retain their behavior. Compile/stringify
  enforce the same output bound, and direct AST values must be strings.
- The original range default remains 1,000. `fill-range` remains pinned to 7.1.1;
  no new registry dependency, install script, executable or runtime app import is
  introduced. Production API dependencies do not use this package.

## Maintenance and verification

Pundit owns this fork's security and compatibility until its consumers adopt a
reviewed upstream fix or migrate away. Do not refresh it by copying upstream
files over the changes. Check this advisory and upstream changes when updating
micromatch, Tailwind, fast-glob, chokidar or Next ESLint dependencies. Replacing
this package requires both exploit regression tests and consumer parity tests.
A clean package audit is metadata evidence, **not** proof of these guarantees.

`pnpm test:braces-security` checks nesting, direct AST attacks, resource budgets,
installed package identities, standard grammar/options, real fast-glob and
watcher behavior. Release validation additionally compares the original upstream
package on a bounded subprocess, and builds the actual Tailwind/Next application.
MIT attribution must remain with every distributed copy.
