# Shmitty system

`@jlreitz/shmitty-system` supplies the Shmitty workflow skills and the Python `knowledge-cli` and
`task-cli` implementations. Pi and DSH add `bin/` to their process `PATH`. Codex loads the same
skills and starts the knowledge implementation as a packaged stdio MCP server.

## Package boundaries

```text
                                      ┌──────────────────────────────┐
Pi package entry ── skills + PATH ──► │                              │
                                      │ skills/                      │
DSH package entry ─ skills + PATH ──► │ bin/knowledge-cli            │
                                      │ bin/task-cli                 │
                                      │ bin/shmitty_core/            │
                                      │ bin/knowledge_cli/           │
                                      │ bin/task_cli/                │
Codex plugin ─ skills + MCP stdio ──► │                              │
                                      └──────────────────────────────┘
```

`skills/` defines the agent workflows. `bin/knowledge-cli` and `bin/task-cli` are stable command
entry points. `bin/knowledge_cli/` contains the knowledge operations shared by the CLI and MCP
interfaces. `bin/task_cli/` contains the task graph operations. `bin/shmitty_core/` supplies their
common frontmatter, TSV, error, and workspace-registry primitives without owning either domain
model. The package contains minimal and ontology Python requirement files. The selected Python
environment and `SHMIT_OWL_JAR` supply runtime dependencies.

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

## Markdown task graph

`shmitty-task-tracking` is an optional local tracker selected only by external workspace or project
instructions. Package installation does not select it. `shmitty-project-manager` remains an
independent workflow and does not invoke, defer to, or reference this tracker. Do not apply the
project-manager topic-index layout and the strict task-graph layout to the same `.agents/tasks/`
tree.

The tracker stores each item as an `index.md` in its own directory below the registered workspace's
`.agents/tasks/`. The exact POSIX path relative to that task root, including `index.md`, is the item
identity. `.agents/tasks/index.md` is invalid. The nearest ancestor item directory defines the
parent. Other Markdown files directly in an item directory are supporting documents for that task
level.

```markdown
---
title:
type: epic|feature|story|task|spike|decision
status: created|started|done
tags: []
dependencies:
  - path/to/blocker/index.md
---

Description.

---

Context and Markdown links.
```

The five frontmatter fields are exact. Titles and descriptions are nonempty. Tags and dependencies
are unique string lists. Dependencies are exact root-relative item identities and represent only
blocking edges. Absolute paths, dot segments, root escapes, self edges, duplicate edges, missing
items, symlink traversal, and cycles are invalid. Markdown links in context carry sources,
evidence, decisions, and other nonblocking relationships.

The item types preserve the same work model as the Beads integration:

- An `epic` spans planning through implementation.
- A `feature` contains multiple independently acceptable outcomes.
- A `story` is one coherent, actor-observable usable outcome.
- A `task` is a concrete implementation or evidence-gathering action. An implementation step is a
  task tagged `step`.
- A `spike` asks one open question. Runnable evidence tasks can be its children, and its context
  links the resolving evidence and decision.
- A `decision` records one settled answer, its rationale, and its consequences in context.

Directory nesting supplies parent-child structure. `dependencies` supplies ordering and blocking.
Context links supply evidence and nonblocking relations. `created` is open work, `started` is work
in progress, and `done` is closed work. Agents change status manually in the item file. Normal
progression is `created` to `started` to `done`; reopening changes `done` to `started`. Parent
completion remains a workflow judgment after its required children and outcome are complete; it is
not derived automatically from child statuses.

Every command scans and validates the complete live graph before producing normal output. One
invalid item or edge produces deterministic diagnostics on stderr, no normal stdout, and status
`1`. Python argument errors use status `2`. Help succeeds on stdout. The command never creates or
modifies task files.

Operational diagnostics use
`task-cli <operation>: <item-or-workspace-path>: <field-or-edge>: observed <value-or-condition>; expected <condition>; <manual-action>`.
Multiple diagnostics use item-path then field order. Discovery, unreadable input, and a missing
requested item follow the same operation, observed, expected, and manual-action structure.

```text
task-cli show <item-path> [--scope <scope-path>]
task-cli ready [--scope <scope-path>]
task-cli search <query>
task-cli previous [--scope <scope-path>]
```

`show` renders the selected item and its parent, children, dependencies, and dependents as
Markdown. Scope admits the target item but does not hide relationships that cross the scope
boundary. Its stable report shape is:

```markdown
# <title>

- Path: `<item-path>`
- Type: `<type>`
- Status: `<status>`
- Tags: <comma-separated tags or `(none)`>
- Parent: `<parent-path>` or `(none)`

## Children

- `<child-path>` or `(none)`

## Dependencies

- `<dependency-path>` or `(none)`

## Dependents

- `<dependent-path>` or `(none)`

## Description

<description>

## Context

<context>
```

Relationship lists use ascending item-path order. `ready` emits path-ordered TSV for `created`
items whose direct dependencies are all `done`; parent and child status do not affect readiness.
Scope limits returned items but dependency evaluation still uses the complete graph.

`search` case-folds one nonempty literal query and matches it as a substring of the title or any
tag. It emits each match once as TSV, ordered by case-folded title and then item path, and identifies
whether title, tags, or both matched. Search is unscoped.

`previous` defines one task level as one item directory. Its touch time is the newest filesystem
modification time among regular Markdown files directly in that directory; child item directories
are separate levels. It emits every item tied for the latest time inside the optional scope in
ascending path order. Each unchanged `index.md` body is preceded by
`<!-- task-cli previous: <item-path> -->`.

The Python resolver reproduces the TypeScript context detector's workspace half: inspect direct
symbolic links under `${HOME}/.agents/workspaces`, lexically resolve their targets, retain roots
that contain the current directory, deduplicate aliases, and select the deepest root. There is no
root option, environment-variable override, or ancestor-marker fallback. Shared conformance cases
keep the two language implementations aligned.

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

Install the [Shmitty Python CLI tooling](../../docs/dependencies.md#shmitty-python-cli-tooling) for
frontmatter-backed commands. Install the
[Knowledge ontology tooling](../../docs/dependencies.md#knowledge-ontology-tooling) in
the `python3` environment that starts Codex. Set `SHMIT_OWL_JAR` before the Codex process starts.
`task-cli`, `knowledge_read`, and `knowledge_search` use PyYAML; ontology-backed operations also use
`rdflib`, `owlrl`, JPype1, Java 8, and HermiT.

## Build and validation

Run `npm run format:check`, `npm run typecheck`, `npm run typecheck:test`, and `npm test` from
`packages/shmitty-system/`. Build the DSH entry with `npm run build`. The `prepare` script builds
it for source installation.
Check changed Python source with `ruff check` and `ruff format --check` under the package's
`pyproject.toml`, then run the complete Python tests with the declared ontology environment.
Check the package payload with `npm pack --dry-run --json`; it must contain `dist/`, `src/`,
`skills/`, both command launchers, all three Python packages, both requirements files, `hooks/`,
`.codex-plugin/plugin.json`, `.mcp.json`, `pyproject.toml`, and `package.json`.

The TypeScript contract tests map the Filesystem context behavior. They exercise startup,
compaction, directory changes, main checkouts, linked worktrees, nested workspaces, absent results,
and inspection failures with a per-test temporary filesystem fixture.

Shared Python behavior maps to `tests/test_shmitty_core.py`; task graph behavior maps to
`tests/test_task_cli.py`; MCP behavior maps to `tests/test_mcp.py`. Run the mapped tests with:

```bash
python3 -m pytest packages/shmitty-system/tests
```

Install or refresh `shmitty-system@shmitabilities`, then start a new Codex session. List the
`shmitty-knowledge` tools and call `knowledge_search` with an explicit test root. This
installed-copy check remains manual because it crosses the Codex plugin cache and a new client
session.

For `task-cli`, create an isolated temporary home with a workspace-registration symlink and strict
task fixtures, then run each command from inside that workspace through the installed launcher.
Verify discovery, stdout, stderr, and statuses without changing the user's selected tracker or
existing task tree.
