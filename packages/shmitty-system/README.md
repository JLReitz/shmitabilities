# Shmitty system

`@jlreitz/shmitty-system` supplies the Shmitty workflow skills and the Python `knowledge-cli`
implementation. Pi and DSH add `bin/` to their process `PATH`. Codex loads the same skills and
starts the knowledge implementation as a packaged stdio MCP server.

## Package boundaries

```text
                                      ┌──────────────────────────────┐
Pi package entry ── skills + PATH ──► │                              │
                                      │ skills/                      │
DSH package entry ─ skills + PATH ──► │ bin/knowledge-cli            │
                                      │ bin/knowledge_cli/           │
Codex plugin ─ skills + MCP stdio ──► │                              │
                                      └──────────────────────────────┘
```

`skills/` defines the agent workflows. `bin/knowledge-cli` is the stable command entry point, and
`bin/knowledge_cli/` contains the knowledge operations shared by the CLI and MCP interfaces. The
package contains the pinned Python requirement file. The selected Python environment and
`SHMIT_OWL_JAR` supply the runtime dependencies.

## Filesystem context

Shmitty System reports the current filesystem context through one shared detector and native
Codex, Pi, and DSH adapters.

```text
                                  absolute cwd
                                       │
                                       ▼
                         ┌──────────────────────────┐
                         │ Shared context detector  │
                         └────────────┬─────────────┘
               workspace links        │            Git inspection
       ${HOME}/.agents/workspaces/    │      project root + Git directories
                         ┌────────────┴─────────────┐
                         ▼                          ▼
              matching workspace roots    project checkout kind
                         └────────────┬─────────────┘
                                      │ formatted guidance
                     ┌────────────────┼────────────────┐
                     ▼                ▼                ▼
               Codex hooks      Pi extension      DSH plugin
```

The detector accepts an absolute working directory and `${HOME}`. It compares the working
directory with the absolute target stored by each symbolic link under
`${HOME}/.agents/workspaces/`. Path-component containment defines a match. The result contains
the matching root with the greatest path depth, so a nested workspace takes precedence over each
workspace that contains it. Link aliases to the selected root produce one result.

Each workspace result gives the absolute workspace root and directs the agent to
`{workspace-root}/.agents/tasks` for task documents. The symbolic-link name is registry data and
does not enter model context.

Git supplies the project result. `git rev-parse --show-toplevel` gives the project root. Absolute
`--git-dir` and `--git-common-dir` values classify equal directories as the main checkout and
different directories as a linked worktree. Linked-worktree guidance directs the agent to use
`shmitty-version-control` directly.

When both results exist for a linked worktree, the formatted context is:

```text
Workspace root: {workspace-root}
Find workspace task documents at {workspace-root}/.agents/tasks.

Project root: {project-root}
This is a linked worktree.
Use the `shmitty-version-control` skill for work in this project.
```

When only one result exists, the context contains only its block and does not contain the blank
line between blocks.

Workspace and project results are independent. A successful inspection formats only identified
results; an empty result produces an empty string. Only symbolic links in the workspace registry
are registrations; ordinary files and directories are ignored. An unreadable registry or an
unexpected Git error fails the complete inspection. Every adapter
reports that failure to standard error, emits an empty model-context value, and continues the
client session. A Codex command hook also returns status `0` and writes an empty standard-output
stream.

### Client lifecycle

| Client event | Adapter state | Context action |
|---|---|---|
| Codex `SessionStart` | `${PLUGIN_DATA}/<session_id>` | Inspect, store the working directory, and emit |
| Codex compact `SessionStart` | `${PLUGIN_DATA}/<session_id>` | Inspect and emit |
| Codex `UserPromptSubmit` | Stored working directory comparison | Emit after the working directory changes |
| Pi `session_start` | Extension runtime working directory | Inspect, store the working directory, and emit |
| Pi `session_compact` | Extension runtime working directory | Inspect and emit |
| Pi `before_agent_start` | Runtime working directory comparison | Emit after the working directory changes |
| DSH `session/created` | Cordis session projection | Refresh dynamic context |
| DSH `compaction/end` | Cordis session projection | Restore dynamic context |
| DSH `working-directory/change` | Cordis session projection | Refresh dynamic context |

Codex stores one normalized absolute working directory per `session_id` under `${PLUGIN_DATA}` and
uses atomic replacement. Pi keeps the last normalized absolute working directory in its extension
runtime. DSH reads the current session projection through a dynamic system-prompt context provider;
Cordis suppresses unchanged context snapshots.

Pi loads `src/pi-shmitty-system/index.ts` and `skills/` from `package.json`. DSH loads
`dist/dsh/index.js` through `cordis.patch.yml` and registers a filesystem skill provider for
`skills/`. Both entries append `bin/` to their process `PATH` once.

Codex reads `.codex-plugin/plugin.json`, loads the workflows from `skills/`, and loads the MCP
registration from `.mcp.json`. The registration starts `python3` with `bin/knowledge-cli mcp`,
forwards `SHMIT_KNOWLEDGE_ROOT` from the client environment, and sets the installed plugin root as
the server working directory. The relative launcher path selects the cached package copy.

## Knowledge MCP tools

The `shmitty-knowledge` server exposes read-only knowledge operations as named tools.

| Tool | Inputs | Text result |
|---|---|---|
| `knowledge_read` | `documents`: nonempty string array; optional `root` | Complete Markdown read report |
| `knowledge_search` | Optional `tags`, `type`, `subtype`, and `root` | Complete TSV search report |
| `knowledge_connections` | `document`; optional `root` | Complete TSV connection report |
| `knowledge_confidence` | `document`; optional `all` and `root` | Complete TSV confidence report |
| `knowledge_investment` | `document`; optional `as_of` and `root` | Complete TSV investment report |
| `knowledge_verify` | `document`; optional `as_of` and `root` | Complete TSV verification report |
| `knowledge_ontology` | `report`: `terms`, `facts`, or `requirements`; optional `root` | Complete selected TSV ontology report |

Each explicit `root` selects the knowledge tree for that call. When `root` is absent, the server
uses `SHMIT_KNOWLEDGE_ROOT`. A call fails when both are absent. Document paths can be relative to
the selected root or absolute paths inside it. A directory resolves to its `index.md`; a path
outside the selected root fails.

`knowledge_verify` returns completed findings as a normal tool result, including
`result<TAB>invalid`. A failure to run an operation returns its `KnowledgeError` text with
`isError: true`. Malformed MCP requests and unknown tool names return JSON-RPC protocol errors.
Server stdout contains protocol messages; diagnostics use stderr.

The server runs each call in its own thread. A `notifications/cancelled` notification signals the
matching operation. The operation checks the signal during Python work and suppresses its result
when cancellation wins the completion race. Native and Java calls can delay the next check, so
cancellation has no fixed latency.

Migration remains a CLI operation. The MCP interface does not expose preview or apply migration.

## Dependencies

Install the [Knowledge ontology tooling](../../docs/dependencies.md#knowledge-ontology-tooling) in
the `python3` environment that starts Codex. Set `SHMIT_OWL_JAR` before the Codex process starts.
`knowledge_read` and `knowledge_search` use PyYAML; ontology-backed operations also use `rdflib`,
`owlrl`, JPype1, Java 8, and HermiT.

## Build and validation

Run `npm run format:check`, `npm run typecheck`, `npm run typecheck:test`, and `npm test` from
`packages/shmitty-system/`. Build the DSH entry with `npm run build`. The `prepare` script builds
it for source installation.
Check the package payload with `npm pack --dry-run --json`; it must contain `dist/`, `src/`,
`skills/`, `bin/`, `hooks/`, `.codex-plugin/plugin.json`, `.mcp.json`, and `package.json`.

The TypeScript contract tests map the Filesystem context behavior. They exercise startup,
compaction, directory changes, main checkouts, linked worktrees, nested workspaces, absent results,
and inspection failures with a per-test temporary filesystem fixture.

The MCP behaviors in this document map to `tests/test_mcp.py`. Run the mapped tests with:

```bash
python3 -m pytest packages/shmitty-system/tests/test_mcp.py
```

Install or refresh `shmitty-system@shmitabilities`, then start a new Codex session. List the
`shmitty-knowledge` tools and call `knowledge_search` with an explicit test root. This
installed-copy check remains manual because it crosses the Codex plugin cache and a new client
session.
