# Current-news and dependency repairs

Direct club manager and latest-result questions retain the selected match for
later conversation, but search and filter evidence for the requested club.
They no longer discard an Arsenal result against Brighton merely because
Arsenal–Leeds is pinned. Explicit opponents, fixture availability and team-news
questions retain fixture-specific evidence handling. JSON, desk JSON and SSE
share the dated-claim verifier; streaming does not publish unverified deltas.
Manager identity is requested directly, with a sourced explanation or an
explicit limit when evidence does not establish why. Citation date formatting
is idempotent, including a second delivery/render pass.

The obsolete API `ts-node-dev` watcher is replaced by pinned `tsx`.
The registry still reports GHSA-vfj7-8cjw-p6xm against braces 3.0.3 and provides
no patched upstream release. A checked-in pnpm patch bounds parser and direct
AST traversal depth, stopping the reported stack-exhaustion exploit. Dedicated
CI regression tests exercise the exploit, boundaries, literal syntax and actual
micromatch/fast-glob/chokidar consumers. The advisory is not suppressed. This
mitigates that specific failure; it does not claim a general expansion-output
resource limit or an upstream advisory clearance.

Local evidence includes repeated focused API tests, strict typing, clean frozen
installation, unchanged pinned model goldens, mock web build, and repeated dev
reload/compiled start/stop checks. Final release verification and production chat
certification must bind the merged deployed source; prior certificates do not
certify this change. No prediction-model selector, constants, live ledger or
secret configuration changes are part of this software repair.
