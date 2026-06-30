# LSP and Edit Tools — Agent Notes

Agent instructions for `extensions/pi-files-and-shmit/`. Shared context
(what the package is, every tool and parameter, configuration, file layout)
lives in `README.md`. Deferred features and the reasons they are not built
live in `DEFERRED.md`. Read both before editing.

## Tool execution model

- **Errors are surfaced by throwing.** The Pi runtime marks a tool result as
  an error only when `execute()` throws (`agent-loop.js` hardcodes
  `isError: false` on any non-throwing return and builds the error result
  from the thrown message). Returning `{ isError: true }` is silently
  ignored. Every tool here `throw`s on errors (not-found, `MismatchError`,
  partial-commit failure) and returns a plain `{ content, details }` on
  success. Do not reintroduce an `isError` flag on returned results; if a
  new error path is added, throw.
- **There is no `approval` field.** Stock pi's `ToolDefinition` has no
  per-tool approval/permission tier. Do not add `approval: "read"` or
  `approval: "write"` to any tool — it is silently ignored. Concurrency is
  controlled by `executionMode: "sequential" | "parallel"`; runtime
  permission-gating (if ever needed) is done by registering a `tool_call`
  handler that returns `{ block: true, reason }`.
- **Write-tier safety for the `lsp` tool** is enforced inside `runLspAction`
  (`src/vendor/lsp/index.ts`), not at the tool boundary: writes are gated on
  the `action` + the `apply` flag; `apply:false` returns a preview before
  any write syscall.

## Imported and vendored cores — update rules

- **`@oh-my-pi/hashline`** is an exact npm dependency, not copied source.
  `patches/@oh-my-pi+hashline+16.2.9.patch` is applied by `patch-package`
  before the native postinstall build. It replaces `Bun.hash.xxHash32`, removes
  the Bun-backed filesystem implementation (the extension owns
  `NodeFilesystem` in `src/node-filesystem.ts`), and carries the local
  `+N`/`.+N` tokenizer extension. Import hashline APIs from the package root.
  When updating the package, regenerate and review the patch, run the hashline
  tests, and verify a clean `npm install`; do not edit installed
  `node_modules` without capturing the result in the committed patch.
- **`src/vendor/lsp/`** is the oh-my-pi LSP subsystem with linter CLI
  clients intentionally not vendored. `config.ts` returns catalog entries in
  default order (linter sorting via `isLinter` is not applicable — no linter
  servers ship). Do not add a `clients/` directory or `LinterClient` types.
- **`native/`** exports only `ast_match`, `ast_rewrite`, `resolveLanguage`
  (all sync). The dependency restriction is specific to Bun runtime APIs; it
  does **not** prohibit normal JavaScript, Rust, or Cargo dependencies. The
  crate uses an exact-revision Git dependency on upstream `pi-ast`, locked
  through `Cargo.lock`, plus a thin local N-API adapter. Accept upstream `pi-ast`'s
  larger grammar dependency closure. Preserve C, C++, and CMake as required
  languages, including explicit `c`/`cpp`/`cmake` aliases, normal source-file
  inference, and `CMakeLists.txt` inference. Keep locally owned code only for
  the N-API contract, synchronous exposure, extension-specific match/rewrite
  result shaping, and behavior that upstream's public API cannot provide; do
  not copy upstream Rust modules merely to avoid dependencies. File discovery
  and orchestration remain in TypeScript (`src/ast-grep.ts`,
  `src/ast-edit.ts`, `src/scan-utils.ts`). The native match is synchronous and
  blocks the JS main thread; cancellation is owned by the JS side (not calling
  further). `timeoutMs` is accepted for upstream surface parity but not
  enforced.

## Patched hashline: body-row prefix stripping

The edit path strips read-output `N:` prefixes from `SWAP`/`INS` bodies
**per hunk, at flush time** in `parser.ts` `#stripBarePrefixesIfUniform` —
which imports only `stripOneLeadingHashlinePrefix` (single-pass,
non-looping) from `prefixes.ts` and applies the two guards (uniform-prefix
+ lone-literal exception via `BARE_LITERAL_VALUE_RE`). `+`-prefixed body
rows are `bare: false` and are never touched. The user-facing body-row
rule lives in `README.md` (`hashline_edit` → **Body rows.**).

`prefixes.ts` also exports three **whole-input** strippers —
`stripNewLinePrefixes` (opportunistic), `stripHashlinePrefixes` (strict),
and the `hashlineParseText` wrapper — that operate on a line array before
tokenizing. They are re-exported via `index.ts` but have **no call sites**
in this extension. They are the superseded earlier design (a pre-tokenizer
whole-input pass); the per-hunk deferred strip replaced them because it
runs with full hunk context and has the lone-literal guard they lack.

- Do **not** wire the whole-input strippers into `Patch.parse` — that
  would re-introduce a coarser pass (looping `stripLeadingHashlinePrefixes`,
  50% diff-`+` heuristic, no lone-literal guard) ahead of the careful
  per-hunk one.
- Do **not** delete them either — they are public API for programmatic
  consumers of the patched dependency (e.g. `hashlineParseText` for a caller
  building a patch from a multiline string). The `hashline_edit` tool is
  not such a consumer.
- If re-syncing `prefixes.ts` from upstream, the live surface for this
  extension is `stripOneLeadingHashlinePrefix` only; the whole-input trio
  + `collectLinePrefixStats` + the looping `stripLeadingHashlinePrefixes`
  are API-only here.

## Patched hashline: `dryRun` preview path

`hashline_edit` `dryRun: true` is a preview implemented in the wrapper
(`src/hashline-edit.ts` `previewPatch`), not in the upstream patcher. It calls
the public `Patcher.prepare` (read + validate tag + apply in memory) per
section, then reconstructs the would-be `PatchSectionResult` without calling
`commit` — so nothing is written. Predicted tags come from `computeFileHash`,
which is exactly what `SnapshotStore.record` returns (`snapshots.ts`), so a
follow-up apply emits the same `[path#TAG]` headers barring an intervening
write.

`previewPatch` mirrors `Patcher.apply`'s structure exactly: a single-section
fast path (prepare → format, no no-op throw, no unique-path check — a no-op
returns `op:"noop"`), and a multi-section path (prepare-all → unique-path
assertion → no-op rejection → format). The wrapper replicates two
module-private patcher checks because they are not exported:
`assertUniqueCanonicalPaths` and the `isNoop` "resulted in no changes"
rejection. Both live in `previewPatch`/`assertUniquePreviewPaths`.

- `Patcher.prepare` is side-effect-free on **success** only. On a stale-tag
  mismatch it routes through `#mismatchError` → `#recordFullSnapshot` →
  `SnapshotStore.record`, minting a recovery snapshot for the live content.
  This is the patcher's own mismatch behavior (a real `apply` does the same),
  so the preview has parity with apply — but it is **not** snapshot-side-
  effect-free on the mismatch path. The FILESYSTEM is never written on any
  path. Do not attempt to suppress the mismatch record by pre-hashing in the
  wrapper (it would duplicate the patcher's read/normalize/BOM/line-ending
  logic — fragile, and forbidden by the re-sync rules). Document it; do not
  expand the dependency patch to fix it.
- Do **not** call `Patcher.commit` or `Patcher.apply` from the preview path —
  both write and record snapshots. `Patcher.preflight` is also unsuitable: it
  validates but returns `void` and discards the prepared sections, so the
  predicted tags would be lost. `prepare` is the only side-effect-free
  primitive (on success).
- Keep `assertUniquePreviewPaths` + the `isNoop` message in lockstep with
  `patcher.ts` (`assertUniqueCanonicalPaths` and the `isNoop` loop in
  `apply`/`preflight`). If upstream changes those messages, mirror them here.
- Keep the single-section fast path split in lockstep with `Patcher.apply`:
  single-section must **not** throw on a no-op (commit returns `op:"noop"`);
  only the multi-section path rejects no-ops. `formatPreviewSection` must emit
  `noop:` for `p.isNoop`, mirroring `commit`'s noop branch.
- Do **not** wire the preview to `snapshots.record` for tag prediction — that
  is a side effect on the success path the preview exists to avoid. Use
  `computeFileHash` on the prepared `after` text (or `normalized` for the REM
  branch, mirroring `commit`). If upstream ever decouples `record`'s return
  from `computeFileHash`, the preview's predicted tags would diverge; update.
- Do **not** claim in docs that the tag "enforces freshness" unconditionally —
  the patcher allows head/tail-only drift to apply with a warning
  (`HEADTAIL_DRIFT_WARNING`). The follow-up apply re-validates the tag
  (rejecting on full mismatch, warning on head/tail drift); that is the
  accurate wording.
- If upstream ever exports a public preview/preflight that returns prepared
  sections + predicted tags, prefer it over the wrapper's replicated checks.

## `hashline_read` TUI rendering

`hashline_read` ships `renderCall`/`renderResult` (the only tool that does —
it dumps full file contents; the other four use stock Pi's default
rendering). `execute()` always returns the full file body + `[path#TAG]`
header regardless of display state; the renderers control only the
human-facing transcript (collapsed = compact call line + hidden body,
expanded = full header + numbered lines, error = renders in both states).

- The renderers import `Text`/`Component` from `@earendil-works/pi-tui` and
  `keyText`/`type Theme` from `@earendil-works/pi-coding-agent`. Both resolve
  at Pi runtime via the loader's module aliases; both are devDependencies
  for `tsc`/`vitest` resolution.
- `ToolRenderContext` is not re-exported from the public barrel, so the
  renderers declare a local `HashlineRenderContext` supertype (a subset of
  its fields). Do not replace it with `any` — the field subset documents
  what the renderer reads.
- `reuseText()` recasts `context.lastComponent ?? new Text("", 0, 0)` to
  `Text` before `setText`; safe because the renderer only ever returns
  `Text` from prior renders (stock `read` makes the same assumption).

## Validation

```
npm install
npx tsc --noEmit
npm test
```

`npm install` runs `postinstall`, which compiles the native crate via
an explicit `cargo fetch --locked` followed by `@napi-rs/cli`'s `napi build`
(requires `cargo` on PATH), then attempts a
best-effort `cargo install lspmux` (skipped silently if `cargo` is absent;
opt out with `SHMIT_NO_LSPMUX=1`). No npm lint script is configured. `npm
test` requires the postinstall build to have produced `native/index.js` +
`index.d.ts` + the `.node`.

The distributed package must include `native/Cargo.toml`, `native/Cargo.lock`,
`native/build.rs`, `native/src/`, and the N-API package/smoke-test files. Do
not add generated native bindings or `.node` files to `files`; every Rust
dependency and the addon itself are built during the consumer's postinstall.

After changing the native dependency boundary or language registry, verify
basic match and rewrite behavior for `.c`, `.cpp`, `.cmake`, and
`CMakeLists.txt`; C, C++, and CMake support is a required compatibility gate,
not an optional consequence of the selected grammar closure.

### Test layout

Tests live in a top-level `test/` directory mirroring the `src/` tree
(`test/vendor/lsp/` ↔ `src/vendor/lsp/`), matching the sibling `pi-shmitline`
extension and the `pi-mono/coding-agent` convention. Tests are **not**
colocated with source. `vitest.config.ts` includes `test/**/*.test.ts`;
`tsconfig.json` includes `test/**/*.ts` for type-checking. Test imports go
up-and-over to root source (`test/X.test.ts` → `../src/X`;
`test/vendor/<d>/Y.test.ts` → `../../../src/vendor/<d>/Y`). When adding a
test, place it at the mirrored path and follow the same import convention.

## Deferred features

Known limitations that are deliberately not built are recorded in
`DEFERRED.md` with the reasoning and an implementation sketch for each. Do
not "fix" any of them without reading `DEFERRED.md` first — each was
considered and accepted. In particular: no per-call `ctx.cwd` binding, no
transaction/rollback on partial commit, no multi-file atomicity for
`ast_edit`, no `deferrable`/resolve gate (not in stock Pi's API), no
gitignore support in `ast_grep`, no tree-sitter WASM fallback, no `lsp` TUI
renderer, and no linter CLI clients.
