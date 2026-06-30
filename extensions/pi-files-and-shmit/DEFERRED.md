# Deferred items

This file is the authoritative record of features that were explicitly
declined or deferred during scoping and are still not built. Each entry says
what the deferral is, why it was declined, what implementing it would
entail, and where in the codebase the decision is anchored.

These are known limitations, not bugs. Do not "fix" them without re-reading
the reasoning — they were each considered and deliberately accepted.

---

## `hashline_read` + `hashline_edit`

### 1. Per-call `ctx.cwd` binding in `NodeFilesystem`

**What.** `NodeFilesystem` resolves every path against `process.cwd()`,
not against the `ctx.cwd` argument passed to each `execute()` call. Stock
Pi's built-in tools resolve against `ctx.cwd` so they stay correct when
the SDK drives them non-interactively from a cwd that differs from the
process cwd.

**Why deferred.** In the target deployment — interactive stock Pi launched
from the session directory — `ctx.cwd === process.cwd()`, so the two are
equivalent. Binding to `ctx.cwd` adds plumbing for a divergence that does
not occur in the only deployment this extension targets today.

**Implementation sketch.** Make `NodeFilesystem` cwd-bound via a
`createFilesystem: (cwd: string) => Filesystem` factory and construct one
per `execute()` call. The filesystem is stateless, so per-call construction
is cheap; only the shared `InMemorySnapshotStore` must persist across
calls (it is already injected separately at `index.ts`). `canonicalPath`
and `readText`/`writeText` would each `resolve(path, cwd)` instead of
`resolve(path)`.

**Anchored in.** `src/node-filesystem.ts` (uses `resolve(path)` with no
cwd parameter).

### 2. Transaction / rollback on `hashline_edit` partial commit

**What.** The vendored `Patcher.apply()` prefights all sections, commits
them in order, and does **not** roll back on a mid-commit failure. A write
failure on section N leaves sections 1..N−1 already written; the tool
surfaces `written` / `failed` / `notAttempted` and treats `MV`
(rename/move) as best-effort.

**Why deferred.** Forking `Patcher.apply()` to stage writes (write all
sections to a temp dir, then rename atomically) was explicitly declined.
The model can reconcile from the reported `written`/`failed`/`notAttempted`
sets, and true multi-section atomicity is disproportionate for an
interactive edit tool where the model re-reads and retries.

**Implementation sketch.** Patch `@oh-my-pi/hashline/src/patcher.ts`
`Patcher.apply()`: write each section to a sibling temp file under a
staging dir, then `rename` all into place only after every write succeeds;
on any failure, delete the staged temps and commit nothing. `MV`/`REM`
sections need their own staging (temp-move, then final rename / final
delete) to stay atomic with `SWAP`/`DEL` sections in the same patch.

**Anchored in.** `@oh-my-pi/hashline/src/patcher.ts` (preflight-then-commit,
no rollback); `src/hashline-edit.ts` `renderPartialFailure` (surfaces the
three categories).

### 3. Block resolver, noop-guard, and streaming

**What.** Three upstream hashline features are not shipped:
- **Block resolver** — `replace_block N:` / `delete_block N` /
  `insert_after_block N:` resolve `N` to a tree-sitter block range at apply
  time. Here they throw `BLOCK_RESOLVER_UNAVAILABLE`; the model uses plain
  `SWAP N.=M:` line-range ops instead.
- **Noop-guard** — a guard that detects when a patch is a no-op and skips
  the write entirely.
- **Streaming previews** — emitting a patch preview incrementally as it is
  parsed, before the full input is buffered.

**Why deferred.** All three were declined as not needed for an interactive
tool. The model emits line-anchored `SWAP`/`DEL` ops (no tree-sitter
needed), the patcher already returns a preview before any write syscall,
and inputs are small enough to buffer fully before previewing.

**Implementation sketch.** Block resolver: inject a tree-sitter-backed
`BlockResolver` into `Patcher.apply()` (the `types.ts` `BlockResolver`
interface already documents the contract — the host injects the
implementation); resolve `N` to a concrete line span and rewrite the
block op as a `SWAP`/`DEL` over that span before commit. Noop-guard: diff
the post-patch text against the pre-patch text per section and skip the
write when identical. Streaming: convert `Patch.parse` to a generator
yielding parsed sections as the input streams in, and feed an incremental
preview renderer.

**Anchored in.** `@oh-my-pi/hashline/src/block.ts`
(`BLOCK_RESOLVER_UNAVAILABLE`); the `Patcher` is constructed with
`blockResolver: undefined` in `src/hashline-edit.ts`.

---

## `ast_grep`

### 4. gitignore support in `ast_grep`

**What.** `ast_grep`'s `glob`-based scanner default-ignores only
`node_modules` and `.git` (plus an opt-in `node_modules` when the `glob`
param mentions it). It does **not** honor `.gitignore` files, so paths
like `dist/` or `build/` are scanned even though git ignores them.
Upstream's `WalkBuilder` honors gitignore via the `ignore` crate.

**Why deferred.** A faithful gitignore reader is another Node dependency
(and the `ignore` crate is Rust-native, not directly portable). For an
interactive search tool where the model typically scopes a glob tightly,
the default-ignore of `node_modules`/`.git` covers the noisy cases.

**Implementation sketch.** Add a Node-side gitignore reader (e.g. the
`ignore` npm package, or a hand-rolled parser of `.gitignore` + parent
chain + global excludesfile), walk the scan root collecting ignore rules,
and pass them to `glob`'s `ignore` option alongside the existing
`node_modules`/`.git` entries. Negation patterns and nested `.gitignore`
files both need handling to match git semantics.

**Anchored in.** `src/scan-utils.ts` `discoverFiles` (ignore list is
hard-coded to `node_modules`/`.git`).

### 5. `timeoutMs` accepted but not enforced

**What.** The `ast_grep` schema accepts a `timeoutMs` field for upstream
surface parity, but the native `ast_match` call is synchronous and
blocking, so the timeout cannot interrupt a scan in progress.

**Why deferred.** Honoring `timeoutMs` would require moving the match off
the JS main thread (a worker-thread task runner port — see #7). On the JS
side, `Promise.all` cannot parallelize or cancel a synchronous native call.

**Implementation sketch.** Port `pi-ast/task.rs` (the worker-thread task
runner) to NAPI, spawn `ast_match` on a worker via `napi-rs`'s
`ThreadsafeFunction` / `tokio` runtime, and have the JS side race the
worker promise against a `setTimeout` that rejects with a timeout error.
Cancellation requires the worker to poll an abort flag between files.

**Anchored in.** `src/ast-grep.ts` (`timeoutMs` schema field; not read in
`execute`); `native/src/lib.rs` (the `#[napi]` sync entry points for
`astMatch`/`astRewrite`/`resolveLanguage`; operations delegated to the pinned
upstream `pi-ast` dependency).

### 6. Serial, not parallel, scanning

**What.** `ast_match` runs on the JS main thread and blocks it for the
duration of the scan. `ast_grep` does not parallelize across files.

**Why deferred.** Same root cause as #5: the native match is synchronous
and main-threaded. `Promise.all` over per-file matches would still execute
them serially on the main thread, so it buys nothing. Acceptable for
interactive use where file counts are modest.

**Implementation sketch.** Same worker-thread port as #5; once `ast_match`
runs off-thread, shard the file list across N workers and `Promise.all`
the per-shard matches.

**Anchored in.** `src/ast-grep.ts` `execute` (serial `for (const file of
files)` loop).

### 7. No native `ast_grep` / `ast_edit` exports

**What.** The native ast crate exports only `ast_match` and `ast_rewrite`.
`ast_grep` and `ast_edit` are TypeScript tools layered over those two
primitives. There is no native `ast_grep` / `ast_edit` binding.

**Why deferred.** Keeping the local native surface to a thin adapter over
upstream `pi-ast` leaves scan orchestration, file walking, and dryRun/apply
flow in auditable TypeScript. Native `ast_grep`/`ast_edit` exports would add
the upstream cache, glob, and worker-task layers with no behavioral win for
this extension.

**Implementation sketch.** Reuse the relevant upstream cache, glob, and
worker-task APIs and expose `ast_grep` / `ast_edit` as NAPI exports that own
the whole scan-then-match / scan-then-rewrite pipeline natively. The JS tools
would then become thin shims.

**Anchored in.** `native/src/lib.rs` (exports `astMatch`, `astRewrite`,
`resolveLanguage` only — camelCase JS-facing names per `native/index.d.ts`);
`src/ast-grep.ts` / `src/ast-edit.ts` (TS-side orchestration).

### 8. No pure-JS tree-sitter WASM fallback

**What.** When the native ast crate fails to build or load, there is no
pure-JS fallback — the `ast_grep` and `ast_edit` tools are unavailable.
Upstream's fallback path (tree-sitter WASM) is not ported.

**Why deferred.** A tree-sitter WASM build is a separate project: it needs
the WASM grammar binaries for every supported language, a WASM runtime,
and a parallel match implementation. The native crate compiles in seconds
on any target with `cargo`, so the fallback's complexity is not justified.

**Implementation sketch.** Vendor `tree-sitter-wasms` for the supported
languages, pull a WASM runtime, and port `ast_match`'s match logic to query
the WASM parser. Wire a build-time probe in `src/native.ts` (or a runtime
`require` try/catch) that falls back to the WASM path when the `.node`
binary is absent.

**Anchored in.** `native/index.js` (generated loader for the `.node`
binding, imported as `"../native"` from `src/ast-grep.ts`, `src/ast-edit.ts`,
`src/scan-utils.ts`, `src/vendor/shims/lang-from-path.ts` — no `src/native.ts`
exists, and there is no fallback path); `native/Cargo.toml` (no WASM build
target).

---

## `ast_edit`

### 9. `deferrable` / resolve gate

**What.** `ast_edit` uses a two-call `dryRun` flow (preview with
`dryRun:true` returns `previewHashes` + a `planDigest`; apply with
`dryRun:false` verifies both before writing) instead of a
`deferrable`/resolve gate that would let the model preview and confirm in
one round trip.

**Why deferred.** Stock Pi's `ToolDefinition`
(`dist/core/extensions/types.d.ts`) exposes no `deferrable` or
pending-action API. The `dryRun` two-call flow is the stock-Pi-compatible
replacement. Do not cite the oh-my-pi source monorepo as evidence of
stock-Pi capability.

**Implementation sketch.** Not portable until stock Pi exposes
`deferrable` on `ToolDefinition`. If it does, `ast_edit`'s `execute()`
would return a preview + a deferred handle on `dryRun:true`, and Pi would
call back to resolve/commit or cancel — collapsing the two round trips
into one. The TOCTOU re-check would move from the apply call into the
resolve callback.

**Anchored in.** `src/ast-edit.ts` (`computePlanDigest`, `previewHashes`
re-check); `AGENTS.md` "Tool execution model".

### 10. Multi-file atomicity / staging journal for `ast_edit`

**What.** `ast_edit`'s apply step writes affected files sequentially. A
`writeFile` failure (ENOSPC, permissions) on a later file leaves earlier
files already modified. There is no staging journal or
temp-file-then-rename-all.

**Why deferred.** Same posture as #2. The drift/plan/set checks all happen
**before** any write, so drift never causes a partial write — only actual
I/O failures can. The model re-reads and reconciles.

**Implementation sketch.** Before writing, write each affected file's new
content to a sibling temp file; only after all temps are written
successfully, `rename` them all into place. A `rename` failure on a later
file leaves earlier files renamed (still a partial commit) unless wrapped
in a journal that records intended renames and replays/rolls back on
retry — a true journal is the larger build.

**Anchored in.** `src/ast-edit.ts` `execute` (sequential write loop with
the no-atomicity comment).

---

## `lsp` tool, writethrough, lspmux

### 11. `lsp` tool TUI renderer

**What.** The `lsp` tool returns plain text and lets stock Pi render it.
There is no `renderCall` / `renderResult` for the `lsp` tool.

**Why deferred.** The `lsp` tool returns structured JSON / formatted text
that does not flood the transcript, so the compact/expand affordance
`hashline_read` uses is not needed. (`hashline_read` ships a renderer
because it dumps full file contents.)

**Implementation sketch.** Port upstream's `lsp/render.ts` (a
`renderCall`/`renderResult` pair formatting diagnostics, hover, references
etc. into TUI components), importing `Text`/`Component` from
`@earendil-works/pi-tui` and `Theme` from `@earendil-works/pi-coding-agent`
(the same pattern `hashline_read` uses — see `AGENTS.md` "`hashline_read`
TUI rendering").

**Anchored in.** `src/lsp-tool.ts` (no `renderCall`/`renderResult` fields).

### 12. Linter integration (Biome / ESLint / Ruff / basedpyright / Deno)

**What.** The server catalog is restricted to the six ast-crate languages
that have an upstream LSP server: typescript-language-server, bashls,
pyright, rust-analyzer, gopls, clangd. Linter CLI clients (the upstream
`clients/` directory, `createClient`/`isLinter`/`LinterClient` types) are
not vendored. Users wanting a linter configure its LSP-server form in
`shmit.json`.

**Why deferred.** Linter CLI clients are a separate integration surface
(spawning a CLI, parsing its output, mapping diagnostics to LSP shapes)
that duplicates what an LSP-server form of the same linter already
provides. Shipping both expands the attack surface and the maintenance
burden for no behavioral gain.

**Implementation sketch.** Vendor upstream's `clients/` directory
(`LinterClient` + per-linter adapters), port `createClient`/`isLinter`,
extend `src/vendor/lsp/config.ts` to resolve linter entries from
`shmit.json`, and wire `runLspAction` to spawn the CLI client and parse
its diagnostics output into `PublishDiagnosticsNotification` shapes.

**Anchored in.** `src/vendor/lsp/config.ts` (catalog has no linter entries;
sort-by-`isLinter` is a no-op); `README.md` "LSP server catalog".

### 13. Manual integration test against a real LSP server

**What.** The `lsp` tool and writethrough are unit-tested with stubbed
`LspClient` / `runAction` (no real server). The manual integration test
against a live `typescript-language-server` (and live lspmux +
rust-analyzer for the multiplexer path) is not part of the automated
suite.

**Why deferred.** A real integration test requires a language server on
`PATH` at test time — a runtime prereq that would make `npm test`
environment-dependent and slow. The unit suite covers the dispatch contract
(param validation, `file:"*"` rejection, readonly gate, write-tier
`apply` gating) with stubs.

**Implementation sketch.** Add a `test/integration/` suite (gated behind
an env var like `SHMIT_INTEGRATION=1` so it is skipped by default) that
spawns a real `typescript-language-server`, opens a temp project, and
asserts on `hover` / `diagnostics` / `definition` / `rename` round trips;
extend to lspmux + rust-analyzer for the multiplexer path.

**Anchored in.** `test/lsp-tool.test.ts` (stubbed runner);
`test/vendor/lsp/lspmux.test.ts` (stubbed spawn).

---

## Cross-cutting — dependency reintegration

### 14. `env-paths` npm package (durable cache / data locations)

**What.** The vendored shims intentionally reimplement small pieces of
`env-paths` (cache/data directory resolution). The maintained `env-paths`
package is not pulled in.

**Why deferred.** No durable cache exists today — the LSP subsystem and
ast tools are stateless across runs. Pulling `env-paths` with nothing to
store is not justified.

**Implementation sketch.** `npm i env-paths`, replace the hand-rolled
`os.tmpdir()` + `path.join` cache paths in `src/vendor/shims/` with
`envPaths("pi-files-and-shmit", { suffix: "" })`, and route any future
persistent state (LSP diagnostics ledger, ast scan cache) through the
returned `cache`/`data`/`log` dirs. The hand-rolled paths are known to be
wrong on macOS/Windows for the cache location, so this becomes load-bearing
the moment a real cache lands.

**Anchored in.** `src/vendor/shims/` (hand-rolled path resolution);
`package.json` (no `env-paths` dependency).

### 15. `debug` logger package

**What.** The vendored logger is a silenced shim — it drops all log output.
The maintained `debug` npm package is not pulled in.

**Why deferred.** The logger is silenced by design: the extension runs
inside an interactive TUI where stray log output would corrupt the render.
There is no verbosity setting today, so a real logger would have nowhere to
emit. Revisit if verbosity becomes a setting (e.g. a `shmit.json`
`logLevel` or a `PI_FILES_DEBUG` env var).

**Implementation sketch.** `npm i debug`, replace the silenced shim's
`logger.debug`/`logger.info` call sites with
`createDebug("pi-files-and-shmit:<area>")` instances, and gate emission on
a namespace env var (`DEBUG=pi-files-and-shmit:*`) or a `shmit.json`
`logLevel`. Output should go to a file (not stdout) to avoid corrupting the
TUI, or via Pi's own logging extension surface if one exists by then.

**Anchored in.** `src/vendor/shims/pi-utils.ts` (silenced logger shim);
`package.json` (no `debug` dependency).

---

## Note on `which` / `find-up` (not deferred)

The dependency-reintegration table that defers `env-paths` (#14) and `debug`
(#15) also originally listed `which` and `find-up`. Those are **not**
deferred — both shipped as runtime dependencies (`which` fixes a real
Windows `accessSync(X_OK)` bug in the hand-rolled `$which` shim; `find-up`
replaces `hasRustWorkspaceAncestor`'s upward walk with a symlink-safe one).
They are listed here only to disambiguate them from the genuinely-deferred
rows they appear alongside.
