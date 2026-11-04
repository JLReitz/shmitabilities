# LSP and Edit Tools

A Pi extension package that adds five tools to a stock Pi session: a
content-hash-anchored read/edit workflow (`hashline_read` + `hashline_edit`),
structural search and rewrite over a real syntax tree (`ast_grep` +
`ast_edit`), and a language-server client (`lsp`). The hashline core is an npm
dependency with a committed Node-compatibility patch, the LSP subsystem is
vendored from `@oh-my-pi/*` TypeScript, and the ast-grep matcher is a thin
native N-API adapter (`native/`) compiled against a pinned upstream `pi-ast`
Git dependency at install time.

Stock Pi (npm, Node.js v22) ships only `edit`, `read`, `grep`, and
`memory-edit`. It does not bundle `@oh-my-pi/hashline`,
`@oh-my-pi/pi-natives`, or any structural-edit tool. This extension ports
those capabilities to Node and exposes them as Pi tools.

## Prerequisites

- **Node.js v22** (provided by stock Pi).
- **Rust toolchain (`cargo`)** — required for the native ast crate.
  `postinstall` first runs `cargo fetch --locked`, then compiles `native/` via
  `@napi-rs/cli`'s `napi build`, and fails loudly if either step fails. The
  distributed package ships `Cargo.toml`, `Cargo.lock`, `build.rs`, and the
  local adapter source; it does not ship or rely on a prebuilt addon. The build
  accepts upstream `pi-ast`'s full grammar dependency closure. `rustup` is not
  auto-installed.
- **lspmux** (optional) — the postinstall also attempts a best-effort
  `cargo install lspmux --version 0.3.0` into a package-local `bin/` dir for
  LSP server multiplexing. If `cargo` is absent the build skips silently and
  LSP spawns servers directly (transparent fall-through). Set
  `SHMIT_NO_LSPMUX=1` at install time to opt out. See
  `THIRD_PARTY_LICENSES.md` for the EUPL-1.2 license.
- No Bun, no prebuilt binaries, no extra package managers.

## Tools

All five tools are registered in `index.ts` over a shared `NodeFilesystem`
and in-process `InMemorySnapshotStore`. Paths resolve against the session
cwd. Errors are surfaced by **throwing** (the Pi runtime marks a result as
an error only when `execute()` throws); on success every tool returns a
plain `{ content, details }` object.

### `hashline_read` — tag-minting read

Reads a file, normalizes it (strip BOM → LF), records the normalized content
in the snapshot store (minting a content-hash **tag**), and returns a
`[path#TAG]` header followed by `N:line` numbered lines. Copy that header
into the follow-up `hashline_edit` call.

**Parameters**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `path` | `string` | yes | File path to read (relative to the session cwd, or absolute). |

**Result.** `content[0].text` is `[path#TAG]\n` followed by `N:line`
numbered lines.

**TUI rendering.** `hashline_read` ships `renderCall`/`renderResult`
mirroring stock Pi's `read` tool: collapsed rows show
`hashline_read <path> (Ctrl+O to expand)` and hide the body; expanded rows
render the full `[path#TAG]` header + numbered lines. Error results render
in both states. `execute()` always returns the full body — the model
receives the complete file and the minted tag regardless of display state.

### `hashline_edit` — content-hash-anchored edits

Applies a hashline patch. Each section starts with the `[path#TAG]` header
copied from `hashline_read`, followed by edit ops (`SWAP N.=M:`, `DEL N`,
`INS.*`, `MV <dest>`, `REM`). Tags are validated against the snapshot store;
stale or fabricated tags are rejected with a `MismatchError` and **nothing
is written**.

**Batching and anchoring.** A section may carry any number of ops — list
multiple `SWAP`/`DEL` ops under a single `[path#TAG]` header to batch edits
to one file. At most one section per file path per call; the patcher rejects
two sections resolving to the same path with a "merge their ops under one
header" error. Line numbers in every op anchor against the **original file
as read** — ops within a section do not shift each other's anchors (edits
apply bottom-up so earlier indices stay valid), so a multi-op batch needs no
re-numbering between ops. Example:

```
[path#TAG]
SWAP 5.=8:
+new line 5
+new line 6
DEL 20
```

**Body rows.** Prefix each body row with `+` (`+TEXT`). `+`-prefixed rows are
taken literally and never have read-output line-number prefixes (`N:`) stripped.
Bare rows (no `+`) are tolerated: when every bare row in a hunk carries a
uniform `N:` read-output prefix it is stripped automatically and a
`BARE_BODY_AUTO_PIPED` warning is emitted; if even one bare row lacks the
prefix, nothing is stripped (the `N:` is treated as genuine content). The safe
form is always `+`. A bare `-` row is rejected as a unified-diff deletion
marker; to insert a literal line beginning with `-`, write `+-…`.

**Parameters**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `input` | `string` | yes | Hashline patch text: one or more `[path#TAG]` sections with edit ops. |
| `dryRun` | `boolean` | no | Side-effect-free preview. When `true`, read + validate tags + apply in memory but write nothing. No snapshot is recorded on the success path; a stale-tag mismatch mints a recovery snapshot, same as a real apply. Returns the would-be per-section result (new `[path#TAG]`, op, changed line) marked as a preview. Stale tags, parse errors, duplicate-path sections, and a no-op within a multi-section batch throw with the same errors as a real apply; a single-section no-op returns a `noop` preview. A successful preview means the same input will apply with the same result, barring an intervening write. |

**Result.** `content[0].text` is one block per section:
`[path#TAG]\n<op>: <path> (changed at line N) -> <moveDest>` plus optional
`warnings:` and `diagnostics:` lines.

**Partial-failure semantics.** The vendored `Patcher.apply()` prefights all
sections, commits them in order, and does not roll back if a later section's
commit fails. On a commit failure the error reports three categories:
**written** (committed before the failure), **failed** (the section whose
commit threw), and **notAttempted** (never reached). Do not collapse
`failed` into `notAttempted` — a failed `MV` may have half-written. When the
failed section is an `MV`, the error appends a warning that the source may
still exist on disk and must be checked before retrying.

**Post-write diagnostics.** After a successful apply, a diagnostics-only LSP
pass runs on content-changing sections (`create`/`update` with no
`moveDest`). `MV`/`REM` sections are skipped. Format is off so the returned
`[path#TAG]` headers stay valid. The pass is best-effort: a thrown
writethrough is swallowed per-section so a flaky/missing LSP server never
fails an edit that already landed.

**Preview (dry run).** `dryRun: true` runs a side-effect-free preview:
`Patcher.prepare` reads each section, validates its tag, and applies the
edits in memory, but the tool never calls `commit` — nothing is written. No
snapshot is recorded on the success path; a stale-tag mismatch routes
through the patcher's `#mismatchError`, which records the live content as a
recovery snapshot (same as a real apply's mismatch — the wrapper cannot
suppress it without patching vendored code). The result is one block per
section in the shape
`[path#NEWTAG] (preview — not written)\n<op>: <path> (changed at line N) -> <moveDest>`,
where the new `[path#TAG]` is predicted via `computeFileHash` (exactly what
`SnapshotStore.record` returns, so a follow-up apply emits the same tags
barring an intervening write). The preview mirrors `apply`'s structure:
a single-section fast path skips the no-op throw (a no-op returns `op:"noop"`),
and the multi-section path rejects no-ops and duplicate-canonical-path
sections with the same errors as `apply`. A clean preview means the same
input will apply with the same result, barring an intervening write. The
follow-up apply is a normal (`dryRun`-absent) call that re-validates the
section tag (rejecting on full mismatch, warning on head/tail drift), so no
separate plan digest is needed (unlike `ast_edit`'s two-call
`dryRun`/`previewHashes` flow). The LSP diagnostics pass is skipped (nothing
was written).

### `ast_grep` — structural (AST) search

Searches files with ast-grep patterns over a real syntax tree, so it matches
code structure rather than text. Language is inferred per file from extension
or special filenames (`Makefile`, shell rc files, …) or overridden by `lang`.

**Parameters**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `patterns` | `string[]` | yes | ast-grep patterns to search for (OR across patterns). Non-empty. |
| `path` | `string` | no | Single file or directory to scan. Defaults to the session cwd. |
| `glob` | `string` | no | Glob filter relative to `path` (e.g. `**/*.ts`). `node_modules` and `.git` are ignored by default unless `glob` mentions `node_modules`. |
| `lang` | `string` | no | Language override (e.g. `ts`, `tsx`, `rust`, `python`, `go`, `bash`, `make`). Required when scanning files with unrecognized extensions. |
| `selector` | `string` | no | Rule selector for contextual pattern matching. |
| `strictness` | `enum` | no | Pattern strictness; defaults to `smart`. One of: `cst`, `smart`, `ast`, `relaxed`, `signature`, `template`. |
| `limit` | `number` | no | Max matches to return after `offset`. Positive integer. Default 50. |
| `offset` | `number` | no | Leading matches to skip before applying `limit`. Non-negative integer. Default 0. |
| `includeMeta` | `boolean` | no | When true, include captured meta-variable bindings per match. |
| `timeoutMs` | `number` | no | Advisory wall-clock timeout in ms. Accepted but not enforced — the native match is synchronous and cannot be interrupted mid-scan. |

**Result.** JSON: `{ matches, totalMatches, filesWithMatches, filesSearched,
limitReached, parseErrors? }`. Each match has `path`/`text`/byte range and
1-based `startLine`/`startColumn`/`endLine`/`endColumn`. Paging
(`offset`/`limit`) is applied globally after matches from all files are
sorted. Hidden files are included; only `node_modules`/`.git` are
default-ignored.

### `ast_edit` — structural (AST) rewrite with dryRun preview

Rewrites files with ast-grep pattern→template rules using a **two-call
`dryRun` flow** (stock Pi's `ToolDefinition` exposes no
`deferrable`/resolve gate, so the preview and the apply are separate calls):

1. `ast_edit({ rewrites, dryRun: true, ... })` — scans files, runs
   `astRewrite` per file, returns per-match before/after changes plus a
   `previewHashes` map (path → content hash of each affected file's original
   content) and a `planDigest` (digest of the normalized rewrite plan).
   Writes nothing.
2. `ast_edit({ rewrites, dryRun: false, previewHashes, planDigest, ... })` —
   re-scans the same scope, verifies the `planDigest` matches, re-checks
   each affected file's content hash against the preview (TOCTOU) by
   re-reading each file fresh from disk right before writing, and only then
   writes. If any affected file changed since the preview, the set of
   affected files differs, or the plan digest mismatches, the call fails and
   writes nothing.

Files whose syntax tree contains error nodes are skipped entirely (not
partially rewritten). Writes are sequential; a `writeFile` failure on a later
file leaves earlier files already modified (no staging journal). When LSP is
enabled, `dryRun:false` writes route through the LSP writethrough (format +
diagnostics per settings); when disabled, writes go direct to disk.

**Parameters**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `rewrites` | `Record<string,string>` | yes | Pattern→rewrite map. At least one non-empty pattern. e.g. `{ "foo($X)": "bar($X)" }`. Templates may reference captured meta-variables (`$VAR`, `$$$MULTI`). |
| `path` | `string` | no | Single file or directory to rewrite. Defaults to the session cwd. |
| `glob` | `string` | no | Glob filter relative to `path` (e.g. `**/*.ts`). Same ignore rules as `ast_grep`. |
| `lang` | `string` | no | Language override. Required when rewriting files with unrecognized extensions. |
| `selector` | `string` | no | Rule selector for contextual pattern matching. |
| `strictness` | `enum` | no | Pattern strictness; defaults to `smart`. One of: `cst`, `smart`, `ast`, `relaxed`, `signature`, `template`. |
| `dryRun` | `boolean` | no | When `true` (default), compute changes and return a preview without writing. When `false`, apply the rewrites (requires `previewHashes` + `planDigest`). |
| `maxReplacements` | `number` | no | Cap on total replacements across all files. Positive integer. Default: no cap. |
| `maxFiles` | `number` | no | Cap on distinct files that may be modified. Positive integer. Default: no cap. |
| `previewHashes` | `Record<string,string>` | no | Required when `dryRun: false`: the `previewHashes` map returned by the prior `dryRun: true` call. Used for the TOCTOU re-check. |
| `planDigest` | `string` | no | Required when `dryRun: false`: the `planDigest` returned by the prior `dryRun: true` call. Proves the rewrite plan was not changed between preview and apply. |

**Result.** JSON: `{ changes, fileChanges, totalReplacements, filesTouched,
filesSearched, applied, limitReached, parseErrors?, previewHashes?,
planDigest? }`. `changes` is per-match before/after; `fileChanges` is
per-file path+count. The preview result includes `previewHashes` +
`planDigest`; the apply result does not.

### `lsp` — language server queries and write actions

Runs LSP actions against the language servers configured for the session
cwd. Ships **14 actions** — 9 read-only and 5 write-tier:

- **Read-only**: `status`, `capabilities`, `diagnostics` (per-file/glob),
  `hover`, `definition`, `type_definition`, `implementation`, `references`,
  and `symbols` (document symbols with `file`, or workspace symbols with
  `query`, bounded by a 200-result cap).
- **Write-tier**: `rename` (symbol rename at a position), `rename_file`
  (file/directory move with cross-server edit fan-out), `code_actions` (list
  available actions; `apply:true` selects by title substring or index and
  applies via `workspace/applyEdit` / `workspace/executeCommand`), `reload`
  (`*` or no file = workspace config re-read + all servers; single file =
  reload that server), and `request` (raw escape hatch: `query` = method
  name, `payload` = raw JSON params).

Stock pi's `ToolDefinition` has no `approval` field — read-only and
write-tier actions are indistinguishable to the harness. Write safety is
enforced inside the dispatcher: writes are gated on the action and the
`apply` flag; `apply:false` returns a preview before any write. The
`diagnostics` `file:"*"` workspace shell-out mode is not supported (use
`bash` for project builds). Project-aware servers (rust-analyzer, gopls,
pyright) require `symbol` for position-based actions to avoid pointing at
the wrong identifier.

**Parameters**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `action` | `enum` | yes | One of: `status`, `capabilities`, `diagnostics`, `hover`, `definition`, `type_definition`, `implementation`, `references`, `symbols`, `rename`, `rename_file`, `code_actions`, `reload`, `request`. |
| `file` | `string` | conditional | Target file path (absolute or relative to cwd). Required for position/symbol actions. Omit (or use `*`) with `query` for workspace `symbols`. `*` is valid for `symbols` (workspace scope) and `reload` (workspace config re-read); rejected for `diagnostics`. |
| `line` | `number` | conditional | 1-based line number for position-based actions (`hover`, `definition`, `type_definition`, `implementation`, `references`, `rename`, `code_actions`). |
| `symbol` | `string` | conditional | Symbol name to resolve the character column (e.g. `foo`, or `foo#2` for the 2nd occurrence on the line). Required for `definition`/`references`/`rename` on project-aware servers (rust-analyzer, gopls, pyright). |
| `query` | `string` | conditional | Workspace symbol search query (for `symbols` without a `file`). For `request`, the LSP method name. For `code_actions` with `apply:true`, the action selector (title substring or 0-based index). |
| `new_name` | `string` | conditional | New name for `rename` (symbol rename) and `rename_file` (destination path). Required for both. |
| `apply` | `boolean` | no | Whether to apply (vs preview) for `rename`, `rename_file`, and `code_actions`. Default: apply. Pass `false` to preview the LSP edits without writing. |
| `payload` | `string` | no | Raw JSON payload for `request`. When set, overrides the default `{ textDocument, position }` params and is sent verbatim. |
| `timeout` | `number` | no | Wall-clock budget in seconds (default 30, max 600). The server may still be indexing on cold starts; raise if a lookup times out. |

**Result.** `{ content:[{type:"text",text}], details }` where `details` is
`{ action, success, request? }`.

### The read → edit workflow

1. Call `hashline_read({ path })` → receive `[path#TAG]` + numbered lines.
2. Author a patch using that exact header (re-read if the file changes).
3. Call `hashline_edit({ input })` → receive a per-section result summary.

Tags are process-local: they are only ever produced by `hashline_read` and
consumed by `hashline_edit` through the shared in-memory snapshot store.
There is no on-disk tag store and no cross-process tag sharing.

## Configuration

### Config files

Behavior is configured via JSON files (no environment variables), resolved in
this order (first source that defines a field wins):

1. **Project** `<cwd>/.pi/shmit.json`
2. **User** `~/.pi/shmit.json`
3. **Defaults** (below)

Malformed JSON, a non-object `lsp` value, or non-boolean field values are
ignored — a broken user config never hard-fails a tool call; the
lower-priority source fills in. YAML is not supported.

### `lsp` settings

Settings live under a top-level `lsp` key so future extension settings can
coexist in the same file.

```json
{
  "lsp": {
    "enabled": true,
    "formatOnWrite": false,
    "diagnosticsOnWrite": true,
    "deduplicate": false
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | `boolean` | `true` | Master switch. `false` disables LSP entirely (writethrough becomes a no-op; writes go direct to disk). |
| `formatOnWrite` | `boolean` | `false` | Format-on-write via `textDocument/formatting`. Off by default — formatting would invalidate the content-hash tags `hashline_edit` returns. Only safe for `ast_edit` (which returns a summary, not tags). `hashline_edit` always runs a diagnostics-only pass with format off. |
| `diagnosticsOnWrite` | `boolean` | `true` | Collect diagnostics after a write and append to the tool result. |
| `deduplicate` | `boolean` | `false` | Enable the diagnostics ledger (dedup diagnostics across runs). |

### LSP server catalog

The extension ships a minimal catalog covering only the native ast crate's
languages that have an upstream LSP server:

| Server | Languages | Command |
|--------|-----------|---------|
| `typescript-language-server` | TS/TSX/JS/JSX/MJS/CJS | `typescript-language-server --stdio` |
| `bashls` | Bash/Zsh | `bash-language-server start` |
| `pyright` | Python | `pyright-langserver --stdio` |
| `rust-analyzer` | Rust | `rust-analyzer` |
| `gopls` | Go | `gopls serve` |
| `clangd` | C/C++/ObjC | `clangd --background-index --clang-tidy --header-insertion=iwyu` |

Make/CMake have ast support (`ast_grep`/`ast_edit`/`resolveLanguage`) but no
LSP server — they remain ast-only. Linter CLI clients are not shipped; users
wanting a linter configure its LSP-server form in `shmit.json`. Server
binaries must be on `PATH` (or in a project-local bin dir like
`node_modules/.bin`); the extension does not install language servers.

When no `lsp.servers` override is present in any `shmit.json`, the catalog is
auto-detected: a server is enabled only if its `rootMarkers` are present in
the cwd **and** its binary resolves on `PATH`.

### Server overrides

Add or override LSP servers in `shmit.json` under `lsp.servers` (a top-level
`servers` key is also accepted):

```json
{
  "lsp": {
    "servers": {
      "typescript-language-server": { "disabled": false },
      "my-custom-server": {
        "command": "/path/to/server",
        "args": ["--stdio"],
        "fileTypes": [".xyz"],
        "rootMarkers": [".xyz-project"]
      }
    },
    "idleTimeoutMs": 300000
  }
}
```

Each server entry has this shape:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `command` | `string` | yes | Server binary (resolved via `$which`, honoring `PATHEXT` on Windows; a package-local `bin/` is searched before `PATH`). |
| `args` | `string[]` | no | Command-line arguments. |
| `fileTypes` | `string[]` | yes | File extensions this server handles (e.g. `[".ts", ".tsx"]`). |
| `rootMarkers` | `string[]` | yes | Project root marker files (e.g. `["package.json", "tsconfig.json"]`). |
| `initOptions` | `object` | no | `initializationOptions` sent to the server. |
| `settings` | `object` | no | Workspace settings sent to the server. |
| `disabled` | `boolean` | no | When `true`, the server is skipped during catalog resolution. |
| `idleTimeoutMs` | `number` | no | Per-config idle timeout (top-level under `lsp`): idle servers are shut down after this many ms. |

Overrides merge with the default catalog by server name; a partial override
augments the default entry, and `disabled: true` removes a server.

## File conventions

```
extensions/pi-files-and-shmit/
├── package.json             # pi.extensions: ["./src/index.ts"]
├── tsconfig.json            # includes src/**/*.ts + test/**/*.ts
├── vitest.config.ts         # includes test/**/*.test.ts
├── src/
│   ├── index.ts                     # Extension entry point (registers all 5 tools)
│   ├── hashline-read.ts     # hashline_read tool + renderCall/renderResult
│   ├── hashline-edit.ts     # hashline_edit tool
│   ├── ast-grep.ts          # ast_grep tool (JS scan + native ast_match)
│   ├── ast-edit.ts          # ast_edit tool (dryRun/apply + TOCTOU)
│   ├── lsp-tool.ts          # lsp tool (14 actions)
│   ├── lsp-settings.ts      # shmit.json lsp settings resolution
│   ├── lsp-writethrough.ts  # shared writethrough factory
│   ├── node-filesystem.ts   # NodeFilesystem (fs adapter)
│   ├── scan-utils.ts        # shared file discovery + strictness schema
│   └── vendor/              # vendored LSP subsystem (see below)
│       ├── lsp/             # oh-my-pi LSP subsystem (+ defaults.json catalog)
│       ├── jsonrpc/         # JSON-RPC message framing
│       └── shims/           # bespoke Node shims (proc, pi-utils, theme, …)
├── test/                    # mirrors src/ tree; tests are NOT colocated with source
│   └── vendor/{lsp,shims}/  # mirrors src/vendor/*
├── native/                  # N-API ast-grep crate (Cargo.toml, src/, build.rs)
├── patches/                 # patch-package diffs for npm dependencies
├── scripts/postinstall.cjs  # builds native crate + optional lspmux
├── bin/                     # gitignored; postinstall-built lspmux binary
├── AGENTS.md                # agent instructions
├── DEFERRED.md              # authoritative record of deferred features
├── THIRD_PARTY_LICENSES.md  # vendored component licenses
└── LICENSE-lspmux.txt       # EUPL-1.2 full text
```

**Tests** live in `test/` mirroring `src/` (matching the sibling
`pi-shmitline` extension and the `pi-mono/coding-agent` convention), not
colocated with source. Test imports go up-and-over to root source
(`test/X.test.ts` → `../src/X`; `test/vendor/<d>/Y.test.ts` →
`../../../src/vendor/<d>/Y`).

**Build outputs** are gitignored: `node_modules/`, `native/index.js`,
`native/index.d.ts`, `native/*.node`, `native/*.d.ts.map`, `native/target/`,
`bin/`. Rebuild the native addon without a full `npm install` via
`npm run build:native`.

### Supported languages (native ast crate)

`ast_grep`, `ast_edit`, and `resolveLanguage` use the full language registry
from the pinned upstream `pi-ast` revision. C, C++, and CMake are required
compatibility targets: `c`, `cpp`, and `cmake` are explicit aliases; normal
C/C++/`.cmake` extensions are inferred; and `CMakeLists.txt` infers CMake.

### Imported and vendored cores

- **`@oh-my-pi/hashline@16.2.9`** — imported from npm and patched
  automatically by `patch-package` from
  `patches/@oh-my-pi+hashline+16.2.9.patch`. `format.ts` `computeFileHash` uses
  `node:crypto` `createHash("sha1")` low-16 bits instead of
  `Bun.hash.xxHash32`; `fs.ts`'s `Bun.file`/`Bun.write` are stripped (this
  extension owns a clean `NodeFilesystem`); and `tokenizer.ts` adds the local
  `+N`/`.+N` range-length syntax. Pi's TypeScript loader and the test/build
  toolchain load the package's published TypeScript sources after patching.
- **`src/vendor/lsp/` + `src/vendor/jsonrpc/`** — the oh-my-pi LSP subsystem
  (client, config, diagnostics ledger, edits, lspmux wrapper). Linter CLI
  clients are not vendored.
- **`native/`** — a minimal N-API crate exporting `ast_match`,
  `ast_rewrite`, and `resolveLanguage` (all sync). Cargo imports upstream
  `pi-ast` at exact revision
  `3047c27c332c5629c8e063283d349384c10c9a56` and `Cargo.lock` fixes the
  complete transitive graph. The local Rust code owns the N-API contract and
  extension-specific match/rewrite result shaping; file discovery, globbing,
  and result aggregation remain in TypeScript.

### Tag format

Tags use `node:crypto` `createHash("sha1")` low-16 bits
(`readUInt16BE(0)`), not upstream's `Bun.hash.xxHash32`. The resulting tags
do not match upstream's xxHash32 format. Tags are never exchanged with any
external consumer, so internal consistency (same `computeFileHash` on the
read and edit sides) is all that matters. The Node patch exists because Bun
runtime APIs, rather than dependency count, are the compatibility boundary.

## Runtime dependencies

- `@oh-my-pi/hashline` — hashline parser, patcher, snapshots, and recovery;
  installed at an exact version and patched during `postinstall` to remove
  Bun runtime calls.
- `patch-package` — applies the committed hashline compatibility diff before
  the native build runs.
- `diff`, `lru-cache` — direct extension dependencies also used by hashline.
- `glob`, `minimatch` — JS-side file scanning for `ast_grep` and `ast_edit`
  (stock Pi's loader does not alias these to extensions).
- `editorconfig` — `.editorconfig` parsing for LSP `FormattingOptions`
  resolution (`src/vendor/lsp/format-options.ts`), so the LSP formatter uses
  the project's declared indent rather than sniffing/falling back.
- `find-up`, `which` — path and binary resolution (fixes a Windows
  `accessSync(X_OK)` bug in the hand-rolled `$which` shim; symlink-safe
  upward walk for root-marker detection).
- `@napi-rs/cli` — provides the `napi` binary used by `postinstall`. A
  runtime (not dev) dependency because `devDependencies` are not installed
  for consumers.

## Testing

```
npm install
npx tsc --noEmit
npm test
```

`npm install` runs `postinstall`, which applies the hashline patch, fetches the
locked Rust dependency graph, and compiles every native dependency from source
(requires `cargo` on PATH). Tests use vitest and cover every tool:
`hashline_read`/`hashline_edit` (parse/apply, fabricated-tag rejection,
partial-failure surfacing, `MV` warning), `ast_grep` (matching,
meta-variables, strictness, paging, parse errors, language inference),
`ast_edit` (`dryRun` preview + apply, TOCTOU failure on drift,
affected-set drift, `previewHashes`/`planDigest` requirement, caps), `lsp`
(dispatch contract, `file:"*"` rejection, readonly gate, write-tier `apply`
gating), the writethrough factory, the lspmux wrapper, the postinstall
cargo-detection logic, and the native bindings.

Type-check with `npx tsc --noEmit`. Rebuild the native addon via
`npm run build:native`.
