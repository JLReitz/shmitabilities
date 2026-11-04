# pi-shmits-angels

`pi-shmits-angels` is a planned Pi extension for spawning and coordinating
named helper agents alongside the main Pi session. It is meant to combine the
flat, visible agent mesh from `pi-messenger` with the
agent-launching and per-agent model control ideas from `pi-subagents`.

This directory currently contains design docs only. Do not treat this README as
evidence that the extension is already implemented.

## Purpose

The target behavior is:

- named, messenger-style participants instead of hidden child workers
- agent process lifetime owned by the parent session
- fresh transcript seeded with an orchestrator-authored handoff prompt
- shared cwd/tools/config behavior by default, with isolation as an opt-in
  compatibility mode
- no bundled builtin agents; user and project config define the roster
- no crew/chains/workflow engine in v1

Agents are session-bound. When the parent Pi session exits or crashes, spawned
agents are torn down as well; see
[Process Termination And Crash Recovery](#process-termination-and-crash-recovery)
for how the hard-crash path works when the extension cannot send the kill signal
itself.

## Source Pickings

The design intentionally pulls from these local source repos:

- `../../../pi-extensions/pi-messenger` — visible participants, `join` / `list` /
  `status` / `send`, overlay idioms, file-based coordination
- `../../../pi-extensions/pi-subagents` — per-agent model selection, child-session
  spawning, session/log artifacts, foreground/background launch mechanics
- `../../../pi-extensions/pi-interactive-shell` — embedding external CLI/TUI sessions
  inside a Pi overlay and configurable spawn-command defaults

## Planned Settings

v1 uses JSON settings files only for extension-level behavior:

- user: `~/.pi/agent/shmits-angels.json`
- project: `<cwd>/.pi/shmits-angels.json`

Project config overrides user config. Only the fields present in project config
override the user file.

These settings are not agent definitions. Named agents live in markdown files.

Example shape:

```json
{
  "ui": {
    "launch_template": "tmux new-window -n '{{agent_name}}'"
  },
  "agentPaths": [
    "~/team-agents",
    "/opt/shared/pi-agents"
  ],
  "spawn": {
    "default_args": {
      "codex": ["--ask-for-permission", "never"],
      "pi": []
    }
  }
}
```

Codex app-server settings are extension-level, not agent-specific.

Documented v1 settings keys:

- `ui.launch_template` (optional)
- `codex.app_server.listen` (optional) — explicit listen address for the
  extension-owned Codex app-server
- `agentPaths`
- `spawn.default_args.<harness>`

Settings ownership rules:

- These JSON files configure extension behavior only. They do not define named
  agents.
- `spawn.*` and `codex.app_server.*` are extension-wide defaults, not per-agent
  frontmatter.
- `agentPaths` augments the default discovery roots. It does not replace them
  unless a future design change says so explicitly.
- Unknown keys should be treated as unsupported rather than silently becoming
  part of the contract through examples alone.

In v1 the extension always owns the Codex app-server lifecycle. There is no
`mode` selector and no externally-provided endpoint: the extension launches and
manages the app-server process itself. The extension uses the app-server
control protocol for Codex message delivery. It does not mutate stored session
files directly.

### Codex app-server lifetime

The app-server lifetime is extension-scoped, not agent-scoped. The extension
owns it for v1.

- The extension starts one Codex app-server process for the parent Pi session
  the first time a Codex agent is spawned or attached.
- All Codex agents for that parent session share that one app-server endpoint.
- The app-server remains alive even if every Codex TUI view is detached,
  because the hosted threads remain the source of truth for agent state and
  message delivery.
- The extension stops the app-server when the parent session tears down its
  last Codex agent or when the parent Pi session exits. The hard-crash path is
  covered in
  [Process Termination And Crash Recovery](#process-termination-and-crash-recovery).
- `codex.app_server.listen`, when set, supplies the listen address for the
  extension-owned process. When unset, the extension derives a default listen
  address.

Implementation note from local verification: the extension should launch a
direct `codex app-server --listen ...` child process rather than depending on
`codex remote-control start` or `codex app-server daemon start`. Those
wrappers can require a standalone installer-managed Codex layout that may not
exist in npm-managed environments.

External (user-provided) app-server endpoints are deferred out of v1. If
re-introduced later, add a `mode`/`remote` surface back as a documented
contract change to both `README.md` and `AGENTS.md`.

## Agent Definitions

Named agent configurations are markdown files with YAML frontmatter.

v1 frontmatter fields:

- `name`
- `description`
- `model`
- `command_args` (optional)
- `env` (optional)

Discovery roots:

- user default: `~/.pi/agents/`
- project default: `<cwd>/.pi/agents/`
- optional extra roots: `agentPaths` from `shmits-angels.json`

The extension ships no builtin agent roster. Any reusable named behavior comes
from discovered markdown configs in those roots.

Example:

```md
---
name: reviewer
description: Review current work and challenge risky assumptions.
model: codex/gpt-5.4
command_args:
  - -a
  - never
env:
  REVIEW_MODE: strict
  BRANCH_NAME:
    command: git branch --show-current
---

You are a careful reviewer. Challenge assumptions, identify regressions, and
keep the review scoped to the requested change.
```

`env` is a dictionary keyed by environment variable name. Each value is either:

- a literal value
- an object with `command: <shell command>` to evaluate at launch time

Example:

```yaml
env:
  MODE: review
  API_BASE: https://example.internal
  BRANCH_NAME:
    command: git branch --show-current
```

Each spawn has two identities:

- config identity: the discovered named agent definition
- runtime identity: the explicit unique tag passed by the orchestrator for that
  main session

Duplicate spawns of the same config are valid as long as the runtime tags are
different.

## Agent Model And Harness Contract

Each agent chooses its harness through the `model` field prefix.

Supported v1 formats:

- `codex/<model-id>`
- `pi/<model-id>`
- `pi/<provider>/<model-id>`

Examples:

- `codex/gpt-5.4`
- `codex/gpt-5-mini`
- `pi/claude-sonnet-4`
- `pi/openai/gpt-5-mini`

Notes:

- v1 supports only `codex` and `pi` harnesses.
- For `pi/...`, the provider segment is optional and exists only to disambiguate
  same-named models across providers.
- The harness prefix is part of the stored config value, not derived later.
- Locked v1 frontmatter fields are `name`, `description`, `model`, optional
  `command_args`, and optional `env`.

## Spawn Command Contract

The executable is fixed per harness and is not user-configurable: `codex` for
the codex harness and `pi` for the pi harness. Users configure only default
args per harness.

- `spawn.default_args.<harness>` defines args appended right after the fixed
  executable, before any extension-resolved or agent args
- the extension resolves harness-specific args (model, cwd, app-server remote,
  structured-output flags) from the agent config and appends them after the
  default args
- agent frontmatter `command_args` are appended after the harness-resolved args
- agent frontmatter `env` contributes per-launch environment variables

The effective launch shape is:

```text
<harness-executable> <spawn.default_args[harness]...> <harness-resolved-args...> <agent.command_args...> "<handoff>"
```

where `<harness-executable>` is `codex` for the codex harness and `pi` for the
pi harness. For example, `spawn.default_args.codex` of
`["exec", "--ask-for-permission", "never"]` yields a launch beginning
`codex exec --ask-for-permission never …` followed by the harness-resolved and
agent args.

The extension implementation is expected to translate the configured
`model` value into the harness-specific CLI arguments at launch time and append
the orchestrator-authored handoff prompt in a harness-appropriate way.

The effective environment is the parent environment plus any variables resolved
from frontmatter `env`. Literal values are passed through directly. Entries with
`command` are evaluated at launch time and their stdout-derived value is passed
to the spawned process.

Launch construction also needs to preserve an output-capture path. The
extension must be able to observe agent output so `@agent-name` mentions can be
detected and routed as messages.

### Harness-specific launch patterns

The stored frontmatter `model` value is translated into harness-native CLI
arguments by stripping the harness prefix:

- `codex/gpt-5.4` -> `codex ... -m gpt-5.4`
- `pi/claude-sonnet-4` -> `pi ... --model claude-sonnet-4`
- `pi/openai/gpt-5-mini` -> `pi ... --model openai/gpt-5-mini`

Recommended v1 patterns, split by hosting (see
[UI Integration](#ui-integration) for how hosting is chosen):

```text
native-only hosting (no launch template) — the extension injects the
structured-output invocation itself; default_args must not include it:

  codex:  codex <default-args...> exec --json -C <cwd> -m <codex-model> <agent-command-args...> "<handoff>"
  pi:     pi <default-args...> -p --mode json --session-dir <agent-session-dir> --name <runtime-tag> --model <pi-model> <agent-command-args...> "<handoff>"

custom-view hosting (launch template configured) — the extension does not inject
the codex subcommand or the pi structured-output flags; they come from
default_args when used:

  codex (interactive TUI, default_args omit exec):
    codex <default-args...> --remote <codex-remote> --no-alt-screen -C <cwd> -m <codex-model> <agent-command-args...> "<handoff>"
  codex (headless exec, default_args include exec):
    codex <default-args...> -C <cwd> -m <codex-model> <agent-command-args...> "<handoff>"
  pi (interactive):
    pi <default-args...> --session-dir <agent-session-dir> --name <runtime-tag> --model <pi-model> <agent-command-args...> "<handoff>"
```

Notes:

- In native-only hosting the extension runs the agent as a monitored process
  and the native transcript tab is the only user-facing surface.
- In custom-view hosting the extension opens the external view via the launch
  template and runs the agent inside it; the native transcript tab coexists.
- The extension injects `exec --json` (codex) and `-p --mode json` (pi) only in
  native-only hosting. In custom-view hosting these come from `default_args`.
- Interactive Codex sessions that must receive routed messages are launched
  against the managed app-server endpoint (`--remote`).
- `codex exec --json` and `pi -p --mode json` are the structured-output forms.
- Fresh transcript means launching a new session, not `resume` or `fork`.
- Mention delivery for Codex is turn-bound rather than token-stream-bound.

If a spawn does not prescribe a named agent configuration, the extension falls
back to launching a plain `pi` session. That fallback is intended to preserve
ordinary `pi` behavior at the current cwd under the user's normal settings,
rather than synthesizing a fake named config.

### Output-capture contract

`@name` routing must not depend on the user manually reading another terminal.

- Codex mention routing is completed-turn-driven. The accepted v1 design may
  use Codex `Stop` / `SubagentStop` hooks, app-server turn notifications, or
  both, as long as the extension inspects completed assistant-turn output.
- Codex native transcript capture must also install a hook path that records
  completed-turn tool usage for each managed Codex thread.
- Pi mention routing is extension-driven. The accepted v1 design inspects
  completed assistant turns from inside the spawned Pi session and routes
  messages through the extension runtime.
- The extension may supervise harness processes for capture and lifecycle
  management, but PTY text is not the authority for Codex mention routing,
  delivery, or transcript rendering.
- Mention scanning should operate on assistant-authored text, not raw
  keystrokes or arbitrary terminal output. ANSI/control-sequence stripping or
  terminal-buffer snapshots are acceptable only where the harness lacks a more
  structured turn-output surface.
- The extension spawns and owns the agent process in both hostings, so it can
  observe agent output directly for `@agent-name` mention detection. In
  custom-view hosting the agent's TTY is hosted in the external view opened by
  the launch template; the extension still captures from the agent process. A
  PTY-preserving recorder such as `script` or `tmux pipe-pane` is acceptable
  when the external view intermediates the TTY.
- Plain shell pipes such as `<launch> | tee capture.log` are not sufficient for
  TUI launches because they usually remove TTY semantics from the child.
- For Codex, completed assistant-turn output obtained from hooks or app-server
  notifications is the authority for mention detection. For Pi, the
  extension's own per-turn assistant message handling is the authority.

## Native Transcript UI

The extension presents one unified overlay with left-aligned agent tabs. Each
agent gets a native transcript tab, and the overlay manages switching between
them. This view is presented in both hostings; it is the only surface in
native-only hosting and coexists with the external TUI in custom-view hosting.

### Tab bar (left side)

Agent tabs are stacked vertically on the left edge of the overlay. Each tab
shows the agent's runtime tag and an optional unread badge:

```text
┌────────────────────────────────────────────────────┐
│ @calm-reef ● │                                     │
│ @warm-mist   │ @calm-reef transcript               │
│              │ area                                │
│              │                                     │
└────────────────────────────────────────────────────┘
```

- The active tab is highlighted with the accent theme color.
- Tabs with unread messages show an unread badge `● ` in the accent
  color.
- Tabs show a dim `•` dot when the agent is actively streaming or working.
- Tab and overlay navigation keys are documented in
  [Overlay hotkeys](#overlay-hotkeys) below.

### Transcript area (right side)

The selected agent's transcript fills the remaining width:

- Assistant and user messages render as plain text blocks with word-boundary
  wrapping. **Messages do not have a border or box decoration.** They are
  visually distinguished by indentation and theme colors only:
  - Assistant messages: `theme.fg("accent", ...)` for the `@calm-reef:` label,
    then plain text.
  - User messages (delivered via routing): `theme.fg("userMessageText", ...)`.
- Long message text wraps within the transcript area rather than scrolling
  horizontally or truncating. Wrapping must preserve word boundaries; do not
  split a token mid-word across lines.
- Tool calls, delivery state changes, wait states, and runtime failures render
  inline as compact notification rows prefixed with `•`.
- Example compact rows:
  - `• bash(command="git status")`
  - `• waiting for approval`
  - `• tool failed: permission denied`
- A delivery notification follows the full assistant message that contained the
  routed `@` tag. For example, an assistant message ending in
  `@reviewer please re-check the diff` is followed by a compact
  `• message queued for @reviewer` row once the extension writes the envelope.
- The native view must not display the full live TUI stream or require the user
  to parse raw terminal output.
- Configuring `ui.launch_template` opens an external view (tmux, etc.) that
  hosts each agent's interactive TUI; the extension still runs the agent
  process, and the native transcript view remains presented alongside that
  custom view.
- When no agent is selected and no agents are spawned, the transcript area
  shows a centered empty state: `No agents running. Use /agents spawn <name>
  or the spawn tool to start one.`

### Overlay hotkeys

A hotkey legend is rendered as a persistent footer row at the bottom of the
overlay. The legend is always visible, regardless of which tab is selected or
how many agents are running:

```text
↑/k up · ↓/j down · Enter switch · x close · Esc back · ^A reopen
```

Key actions:

- `j`/`↓` — next tab
- `k`/`↑` — previous tab
- `Enter` — switch to the selected tab
- `x` — kill (shut down) the focused agent's process and remove its tab from the bar
- `Esc` — close the overlay and return to the main Pi session
- `ctrl+a` — re-open or focus the overlay

### Native transcript projection rules

- Project runtime events into two UI classes only:
  - transcript messages: user and assistant conversational content
  - compact event rows: lifecycle, tool, queue, wait, and error notifications
- Prefer structured runtime events over PTY text whenever the harness exposes
  them.
- Collapse noisy streaming into stable transcript artifacts:
  - text deltas become one in-progress assistant message, then one finalized
    assistant message
  - toolcall deltas become one compact `• tool(args...)` row once arguments are
    parseable or finalized
  - tool progress updates may update an existing compact row rather than append
    one new row per chunk
- Do not render hidden reasoning/thinking content as transcript text in v1.
  If surfaced at all, reduce it to a compact status row such as
  `• thinking…`.
- Raw shell output is not a first-class transcript artifact for this mode.
  Unstructured stderr or monitor text should appear only as compact error or
  status rows.

## Agent Dashboard Access

The agent overlay is opened by:

- **Slash command:** `/agents` — opens the unified overlay with all active agent
  tabs.
- **Keybinding:** `ctrl+a` — opens or focuses the unified overlay.
- **Spawn:** `/agents spawn <name>` — spawns a new agent and opens the overlay
  with the new agent's tab selected.

When the overlay is open, the main Pi session continues running in the
background. The user can switch between the overlay and the main session with
`Esc` (close overlay) and `ctrl+a` (re-open overlay).

### Agent indicator widget

When the overlay is closed, the extension sets a widget above the input editor
showing a compact agent roster:

```text
⚡ @calm-reef (codex) · @warm-mist (pi) · ●2 unread
```

Format rules:

- Each agent is listed with its runtime tag and harness.
- The harness is shown in `theme.fg("dim", ...)`.
- A dim `⚡` prefix appears when at least one agent is actively working.
- Unread messages appear as `● <count>` in `theme.fg("accent", ...)`, last in
  the line. The badge is omitted when there are zero unread messages.
- Agents are ordered by spawn time (oldest first). There is no reordering in v1.
- Agents that have terminated are removed from the widget within one status
  heartbeat cycle.
- The widget is set via `ctx.ui.setWidget("shmits-angels", ...)` and cleared
  when all agents have terminated.

### Footer indicator

The extension sets a persistent footer status line showing per-agent state:

```text
agents: @calm-reef(codex/4o) idle · @warm-mist(pi/sonnet) working
```

Format rules:

- Each agent shows runtime tag, harness **and model** in parentheses:
  `<harness>/<model-id>`, then a human-readable state label.
- State labels (mapped from compact event classes):
  - `idle` — agent process is alive, no active turn
  - `working` — agent is actively streaming or executing a tool
  - `waiting` — agent is blocked on approval or user input
  - `routed <N>` — agent has N unsent routed messages in its delivery queue
- The state label is colored with the matching theme role:
  `theme.fg("success", "idle")`, `theme.fg("warning", "waiting")`,
  `theme.fg("accent", "working")`, `theme.fg("error", "routed")`.
- The line is set via `ctx.ui.setStatus("shmits-angels", ...)` and updated
  on any agent state transition or status heartbeat (every 15s).
- When no agents are active, the status line is cleared.

### Subcommands

`/agents` accepts subcommands for direct management:

| Subcommand | Effect |
|---|---|
| `/agents` | Open the unified overlay |
| `/agents list` | Print a text roster to the main transcript and show the widget |
| `/agents spawn <name>` | Spawn a named agent from discovered configs and open the overlay |
| `/agents kill <tag>` | Terminate the agent with the given runtime tag |
| `/agents kill --all` | Terminate all active agents |
| `/agents msg <tag> <text>` | Send a message directly to an agent by runtime tag |
| `/agents logs` | List all symlinked agent session log paths |
### Codex app-server delivery contract

App-server integration is the accepted v1 receive path for interactive Codex
sessions.

For Codex, the app-server-hosted thread is the primary runtime object. TUI
surfaces are attachments to that thread, not separate session copies.

The extension should retain, per spawned Codex agent:

- `threadId`
- app-server remote endpoint
- latest known thread status
- latest known active turn id, when any
- rollout/log path if available

The extension should also maintain a per-thread delivery queue so routed
messages can be serialized and retried without depending on any particular TUI
being open.

Routed delivery rules:

- If the target Codex thread is active and the current turn is steerable, the
  extension sends the message with `turn/steer`.
- If the target Codex thread is loaded but idle, the extension starts a fresh
  delivery turn with `turn/start`.
- If the target Codex thread is not loaded but has a known `threadId`, the
  extension reloads it with `thread/resume` and then starts the delivery turn.
- If the target thread is active but not steerable, or is waiting on approval
  or explicit user input, the extension leaves the message queued and retries
  after the next relevant thread-status or turn-completion update.
- `thread/inject_items` is not the primary delivery mechanism in v1 because it
  appends history without starting a user turn.
- Delivery is protocol-driven. The extension must not edit Codex rollout JSONL
  files or SQLite state files directly to inject a message.

This keeps interactive Codex compatibility while giving the extension a real
message ingress path that does not depend on shelling out to `codex resume`.

### Codex native transcript event surface

For Codex, the native UI should be driven by app-server thread/turn state plus
completed-turn content, not by embedding the Codex TUI.

Codex hook capture requirement:

- The extension must install a Codex hook for each managed Codex agent thread
  so completed turns emit structured tool-call artifacts into an extension-owned
  capture path.
- The hook output is part of the native transcript input surface, not a debug
  log only.
- At minimum, each captured tool artifact should preserve:
  - thread identity
  - turn identity or another stable completed-turn correlation key
  - tool name
  - serialized arguments
  - success/error outcome
  - compact error text when the tool fails
- The hook must capture tool calls after argument construction is stable,
  without depending on PTY scraping.

Reliable v1 event classes to capture and display:

- thread/session lifecycle:
  - agent spawned
  - thread attached
  - thread resumed
  - thread detached
- delivery lifecycle:
  - message queued
  - message delivered with `turn/start`
  - message delivered with `turn/steer`
  - delivery retry deferred because the thread is busy
- wait states:
  - waiting on approval
  - waiting on explicit user input
  - active but not steerable
- transcript content:
  - generated user-input delivery envelope
  - completed assistant turn text
- failure/status:
  - attachment failure
  - delivery failure
  - thread/update or resume failure

Codex tool/event detail tiers:

- Preferred:
  - hook-captured completed-turn artifacts that let the extension reconstruct
    compact rows for tool usage deterministically
  - structured assistant items or app-server turn notifications that identify
    tool calls, tool results, and errors
- Acceptable fallback:
  - completed-turn conversational content plus delivery/thread-state events when
    a given turn has no tool artifacts
- Not acceptable as primary authority:
  - scraping arbitrary PTY frames from an attached TUI

How to identify app-server items that are worth documenting:

- Drive a known Codex thread through representative turns:
  - plain assistant reply
  - tool call success
  - tool call failure
  - approval wait
  - explicit user-input wait
  - `turn/steer`, `turn/start`, and `thread/resume` delivery paths
- Capture the raw app-server thread items and turn/status notifications for
  those turns without normalizing them first.
- Capture the required hook artifacts for the same turns.
- Correlate by `threadId` plus turn identity, or another stable completed-turn
  key, and compare what the app-server exposed against what the hook captured.
- Promote an app-server item shape into the documented native-event surface only
  when it is observed directly and repeatably with stable identifying fields.
- For each documented item shape, record:
  - where it arrived from: thread items vs status/turn notification
  - the discriminating fields that identify it
  - whether it is sufficient on its own, or only additive to hook capture
- If an app-server payload cannot be correlated to a completed turn or does not
  expose stable fields for tool name, arguments, or outcome, do not treat it as
  authoritative for per-tool transcript rows.

### Observed app-server item shapes (evidence)

The raw captures backing these findings live under
`codex-app-server-evidence/` in this directory. They were produced by driving a
real `codex app-server` (v0.142.5) through representative turns over loopback
WebSockets. Treat them as observed-at-this-version, not as a stable protocol
contract; re-capture when implementation begins.

Observed item types, all delivered via `item/started` + `item/completed`
streaming notifications:

- `userMessage` — `content[]` of `{type:"text", text, text_elements:[]}`.
- `agentMessage` — `text`, `phase` (`final_answer` | `commentary`),
  `memoryCitation`. Streamed token-by-token via `item/agentMessage/delta` with
  `itemId` + `delta`.
- `reasoning` — `summary: []` and `content: []`, both empty in the captures.
  No `encrypted_content` field was observed. Reasoning detail is not exposed
  via app-server items in this configuration, so it cannot back any transcript
  row from app-server data alone.
- `commandExecution` — the only tool-shaped item type observed. Fields:
  `command` (full bash invocation), `cwd`, `processId`, `source`
  (`unifiedExecStartup`), `status` (`inProgress` -> `completed`),
  `commandActions[]` of `{type:"unknown", command}` (weakly typed),
  `aggregatedOutput` (result text, null until completed), `exitCode`,
  `durationMs`.
- `webSearch` — observed in the live web-search capture when the app-server was
  started with `-c web_search="live"`. This proves web lookup is not forced
  through shell `commandExecution` items on this build.

No `functionCall`, `functionCallOutput`, `computerCall`, or similar item types
were emitted in the captured turns. Shell tool calls surface as
`commandExecution`, not `functionCall`. Do not assume the README's
`• read(path=...)` example maps to a distinct app-server item type until that
non-shell tool turn is captured.

Critical `thread/read` finding:

- `thread/read` with `includeTurns: true` returns `itemsView: "full"` but
  **omits `commandExecution` items** from each turn's `items[]`. A completed
  tool turn resurfaces in `thread/read` as only `userMessage` + `agentMessage`
  items. Tool artifacts are therefore reachable only through live
  `item/started` / `item/completed` subscriptions during the turn, plus
  hook-captured completed-turn artifacts. `thread/read` is not a source for
  per-tool rows.
- `turn/completed` notifications carry `items: []` and `itemsView: "notLoaded"`;
  the turn-completion event does not embed items either.

Delivery-path evidence:

- Successful mid-generation `turn/steer` is now captured. When sent against an
  active turn with `expectedTurnId`, the server returned `result.turnId`
  matching the original active turn, and the final answer reflected the later
  steered instruction.
- On this build, reconnecting to a thread does not require a successful
  `thread/resume` response before a second-connection `turn/start` can
  complete. The captured `thread-resume-turn-start` run showed
  `thread/resume` by `threadId` failing with `no rollout found for thread id
  ...`, `thread/resume.path` failing with `requires experimentalApi
  capability`, and a subsequent `turn/start` against the original `threadId`
  still completing. `thread/read(includeTurns=true)` preserved the completed
  resumed turn in stored history.
- `thread/inject_items` returned `{result: {}}` (accepted, empty). It appends
  history without starting a user turn, confirming it is not the primary
  delivery path.

Still unverified by these captures (remain open):

- approval-wait item shape
- explicit user-input-wait item shape
- isolated-home hook capture for tool turns. The failed-tool and successful
  steer captures both recorded zero parsed hook records, so app-server items
  are evidenced but the intended paired hook path is still not.
- successful `thread/resume` reattachment payload. The delivery path after
  reconnect is evidenced, but a successful `thread/resume` response is not.
- unix socket listen permissions: isolated `codex app-server --listen
  unix://...` runs on this Linux host failed with `EPERM` before transport,
  including runs with candidate unix-socket allow overrides. Keep the
  configuration/harness evidence harness on loopback WebSockets until Codex's
  unix-socket permission model is verified for this host/version.
- configuration/harness error and warning notifications: the launch-time
  config error is now captured as a pre-transport stderr failure with no JSON-
  RPC traffic. The isolated `SessionStart` hook scenario still did not emit
  hook notifications or dedicated error/warning notifications, so the hook-
  failure surface remains undecided.

### Remaining evidence capture plan

When implementation work begins, collect the remaining Codex app-server
evidence with one capture run per target behavior. Keep each run narrow enough
that its resulting JSON file proves one behavior clearly.

Common capture rules:

- Re-run the harness in `codex-app-server-evidence/app-server-capture.py`
  against the active Codex CLI version and store raw JSON-RPC output without
  post-processing.
- The current harness implementation already covers the prompt-driven setup for
  `approval-wait`, `explicit user-input-wait`, failed-tool
  `commandExecution`, successful mid-generation `turn/steer`,
  `thread/resume` plus resumed `turn/start`, and `web/search/fetch`. It
  writes the exact prompt, raw traffic, enabled app-server features or config
  overrides,
  per-scenario assertion results, and the per-run isolated hook-capture output
  into each artifact. The remaining harness work is now specific: the
  isolated-home hook path still fails to emit parsed tool-hook records for the
  tool scenarios, and the explicit wait-state scenarios still need better
  triggers.
- For every scenario, capture both app-server traffic and the extension-owned
  hook artifact for the same thread/turn.
- Record the exact prompt or operator action used to trigger the scenario in
  the evidence README so the run is reproducible.
- Treat a shape as established only when the payload exposes stable
  discriminators for event class, turn/thread correlation, and any tool or
  wait-state detail the native transcript would need to render.

Planned scenarios:

- `approval-wait` item shape
  - Trigger: start a Codex turn that attempts a tool call requiring approval.
  - Capture goal: identify the raw notification or item payload that marks the
    thread as approval-blocked, plus the corresponding recovery event after the
    approval is granted or denied.
  - Minimum assertions:
    - whether the state appears as an item, a status notification, or both
    - the stable fields that distinguish approval wait from generic busy/active
      state
    - whether the hook artifact adds anything required for transcript display

- explicit user-input-wait item shape
  - Trigger: drive a turn that asks the harness to stop for explicit user input
    rather than continuing autonomously.
  - Capture goal: identify the payload that proves the thread is waiting for
    user input and the payload that clears that state after input arrives.
  - Minimum assertions:
    - whether the wait state is distinguishable from approval wait
    - whether the state is visible through thread items, notifications, or only
      through status transitions
    - whether `thread/read` preserves any evidence of the wait after the fact

- failed-tool `commandExecution` shape
  - Trigger: run a deterministic failing command from within a Codex turn, such
    as a non-existent executable or a guaranteed non-zero shell exit.
  - Capture goal: observe the completed `commandExecution` payload for failure.
  - Minimum assertions:
    - shape and presence of `exitCode`, `aggregatedOutput`, and any error text
    - whether failure-specific fields exist beyond the success-case shape
    - whether the hook artifact is required to render the compact failure row
  - Status:
    checked-in evidence now captures `status: "failed"`, `exitCode: 127`, and
    `aggregatedOutput` for a deterministic shell failure. The remaining gap is
    the missing paired isolated-home hook artifact.

- successful mid-generation `turn/steer`
  - Trigger: start a deliberately long-running Codex turn, then send
    `turn/steer` while that turn is still active.
  - Capture goal: prove the accepted delivery path for active-thread routing.
  - Minimum assertions:
    - the exact success response payload for `turn/steer`
    - which notifications show the steer being accepted and reflected in the
      active turn
    - whether a later `turn/completed` or thread read makes the steer visible
      post hoc
  - Harness status:
    `codex-app-server-evidence/app-server-capture.py --scenario
    successful-turn-steer` now sends `turn/steer` with the active turn's
    `expectedTurnId` after a long-running `commandExecution` item starts.
  - Status:
    checked-in evidence now captures the accepted `turn/steer` response and
    steered final answer. The remaining gap is the missing paired isolated-home
    hook artifact.

- `thread/resume` plus `turn/start` delivery path
  - Trigger: resume a known existing thread with no active attachment, then
    deliver a routed message with `turn/start`.
  - Capture goal: prove the idle-thread delivery path after reload.
  - Minimum assertions:
    - exact `thread/resume` success payload and any follow-on status
      notifications
    - exact `turn/start` success payload on the resumed thread
    - whether resumed-thread delivery leaves enough evidence in later
      `thread/read` output to correlate the delivered message
  - Harness status:
    `codex-app-server-evidence/app-server-capture.py --scenario
    thread-resume-turn-start` now starts a thread on one connection,
    disconnects, reconnects, retries `thread/resume` with the rollout path if
    `threadId` alone fails, then runs `turn/start` and
    `thread/read(includeTurns=true)`.
  - Status:
    checked-in evidence now proves second-connection `turn/start` delivery and
    stored-history preservation on the original thread id even when
    `thread/resume` itself fails. The remaining gap is a successful
    `thread/resume` response payload on this or a newer build.

- web/search/fetch tool shape
  - Trigger: drive a Codex turn that uses a web/search/fetch capability.
  - Capture goal: determine whether the tool appears as `commandExecution` or a
    distinct app-server item type.
  - Minimum assertions:
    - observed item type name and discriminating fields
    - whether tool arguments/results are present in app-server payloads,
      hook artifacts, or both
    - whether `thread/read` omits the tool artifact the same way it omits
      shell `commandExecution`
  - Status:
    checked-in evidence now captures a distinct `webSearch` item type when the
    app-server is launched with `-c web_search="live"`.

- configuration and harness error/warning notifications
  - Trigger: run the isolated local scenarios in
    `codex-app-server-evidence/src/config_and_hook_error_capture.py`: a
    launch-time configuration error and a hook failure in an isolated test
    environment over loopback WebSockets. Remote-endpoint fault injection is
    out of scope for this scenario because the app-server containment model
    treats remote attachment errors as a separate boundary. Unix-socket listen
    remains a separate open question on this host because the local app-server
    process failed with `EPERM` before transport.
  - Capture goal: determine whether Codex emits dedicated error/warning
    notifications, only request-level JSON-RPC errors / lifecycle changes, or
    only pre-transport startup stderr. The harness must record which of those
    evidence bases actually occurred for each scenario instead of assuming
    websocket notification coverage.
  - Minimum assertions:
    - exact notification or error response shape
    - whether the failure is thread-scoped, process-scoped, or request-scoped
    - whether any lifecycle notifications need to be promoted into the native
      transcript projection for operator clarity
  - Status:
    checked-in evidence now proves that a bad launch-time config can fail
    entirely before transport. The remaining gap is the dedicated notification
    shape, if any, for an isolated hook failure.

Acceptance bar for closing an evidence gap:

- A raw capture file exists for the scenario.
- `codex-app-server-evidence/README.md` indexes that file and states what it
  proves.
- This section and the extension-local `AGENTS.md` open-questions list are
  updated to mark the scenario resolved or to narrow the remaining unknown.

Codex native transcript display rules:

- Render completed assistant/user content as transcript messages.
- Render non-conversational state changes inline as compact `•` rows.
- Use hook-captured tool artifacts to display compact rows such as:
  - `• bash(command="git status")`
  - `• read(path="src/index.ts")`
  - `• tool failed: command exited 1`
- If app-server items also expose tool structure for the same turn (via live
  `commandExecution` streaming, not `thread/read`), the extension may merge
  them with hook-captured artifacts, but the hook path is the minimum required
  source for Codex tool rows because `thread/read` omits `commandExecution`
  items entirely.
- If a Codex turn has no captured tool artifacts, the UI may omit per-tool rows
  for that turn rather than inventing fake detail.

### Codex view attachment contract

Codex custom views attach to an existing app-server-hosted thread.

- When a launch template is configured, the extension opens the external view
  via the template and then launches the Codex agent inside it attached to the
  existing thread (via the known remote endpoint and `threadId`), not as a
  fresh session.
- Reattaching a Codex TUI must target the existing thread rather than creating
  a fresh session.
- Multiple attached TUIs may observe the same thread. They are concurrent views
  onto shared thread state, not separate exec-like runs.
- Message delivery does not require any TUI to be attached. A later attachment
  should reveal the already-updated thread transcript.

The launch template fully owns view configuration. When a launch template is
configured, the documented v1 launch-template placeholders are:

- `{{agent_name}}` — the agent's human-facing label
- `{{agent_tag}}` — the agent's unique runtime tag (the `@<tag>` routable
  identifier)

If additional view-context placeholders are introduced later, document them here
and in the extension-local `AGENTS.md` validation rules in the same change.

### Implicit Mention Routing

There is no explicit send-message tool in this extension. Message passing is
implicit through tagged assistant output.

Accepted v1 contract:

- Routable targets are `@<registered-runtime-tag>`, `@main`, and `@all`.
- The sender must use an explicit runtime tag. Routing is based on runtime
  tags, not only config names.
- A runtime tag is two human-readable words (an adjective and a noun) joined
  with a hyphen in kebab-case, e.g. `calm-reef`. This mirrors the tag
  convention used by `pi-interactive-shell`.
- The first recognized routed mention starts the delivered message body. The
  message content is taken from that mention position to the end of the same
  assistant message.
- Routing should parse assistant-authored text only, not shell/tool output.
- `@all` broadcasts to all registered agents except the sender and includes the
  main session.
- Duplicate deliveries must be suppressed with per-message ids or equivalent
  deduplication state.
- Delivery ordering is FIFO per recipient thread.

Suggested envelope fields:

- delivery id
- sender runtime tag
- recipient runtime tag
- sender harness
- created-at timestamp
- message body

Harness-specific delivery model:

- Codex sender: a completed-turn observer inspects the just-completed assistant
  turn, resolves routed mentions, writes envelopes to the routing store, and
  wakes recipients as needed. Hook-driven capture remains acceptable; an
  app-server turn-completion subscriber is also acceptable.
- Codex recipient: the extension delivers through the app-server control
  protocol, using `turn/steer`, `turn/start`, or `thread/resume` plus
  `turn/start` depending on the target thread state.
- Pi sender: the spawned Pi session inspects completed assistant turns and
  emits envelopes through the extension runtime.
- Pi recipient: the extension delivers the message internally as a steering
  prompt that wakes the target session.

This means interactive Codex is still compatible in v1, but mention delivery is
not mid-generation. The routed message becomes visible to the recipient after
the sender's current assistant turn completes.

For Codex recipients, the delivered message should be framed as a generated user
input turn or steer input, displayed verbatim in the recipient's view as:

```text
Message from @<sender>: <content>
```

The receiving agent's own `@` tag is omitted from the front of `<content>`. The
message body is taken from the first recognized routed mention to the end of
the sender's assistant message, so the routing `@` tag itself is not part of
the delivered content. For example, if `@coder` authored
`@reviewer please re-check the diff`, the receiving agent `reviewer` sees:

```text
Message from @coder: please re-check the diff
```

The delivery envelope may carry a reply hint (e.g. "Respond in-thread if needed.
Use @<runtime-tag>, @main, or @all to route a reply.") as envelope metadata,
not as part of the verbatim message body.

If the recipient thread is detached when the message arrives, the delivery still
lands in the thread. The next opened native or custom view should show that
message in the shared transcript and the UI may surface an unread badge until
the user visits that agent view.

## Transcript And Handoff Model

Spawned agents do not inherit the parent's live transcript.

Instead each agent starts with:

- a fresh transcript
- an orchestrator-authored brief/handoff prompt

That handoff is the primary vehicle for task scoping, context transfer, and
coordination instructions.

## Coordination Model

Each spawned agent is expected to behave like a visible participant in the same
mesh as the parent session:

- it can appear in agent listings and status views
- it can send and receive direct messages
- it shares the project by default instead of automatically forking into a
  separate worktree/session

There are no hidden/internal workers in v1. Every spawned agent is meant to be
user-visible.

The extension does not implement reservation or resource-claim mechanics.
Coordination is the orchestrator's responsibility.

## Session Logs

Each spawned agent keeps its own session log, and that log is symlinked into the
main session log directory so the parent session can discover all agent sessions
from one place.

The important v1 contract is the symlinked visibility, not a fixed filename
scheme. If implementation choices later force a naming decision, document that
decision here and keep it stable.

## Process Termination And Crash Recovery

Every spawned agent and the Codex app-server run in their own process group
(`setsid` / detached) so a group signal reaches the agent plus any helper
subprocesses it spawned. Teardown has two paths.

### Graceful teardown

When the parent session shuts down normally, the extension sends each agent
group `SIGINT`, then `SIGTERM` after a short grace period, then `SIGKILL` — the
same escalation `pi-subagents` uses. The shared Codex app-server is stopped
once the last Codex agent it owns is torn down or the parent session exits.

### Hard-crash teardown

When the parent Pi process dies hard (crash, `SIGKILL`, OOM), the extension
cannot run its normal kill path. Three layers bring agents down anyway, in
order of preference:

1. **Pipe-death-notice supervisor (primary, portable).** For each spawned
   process the extension creates an anonymous pipe, keeps the write end in the
   parent, and passes the read end to a small supervisor wrapper that is the
   parent of the agent. The supervisor blocks on `read()`; when the parent dies
   the kernel closes the write end, `read()` returns `EOF`, and the supervisor
   kills the agent's process group (`SIGTERM` then `SIGKILL`) and exits. One
   supervisor per agent and one for the app-server. This works on Linux and
   macOS with no polling and no cooperation from the extension at death time.
2. **`PR_SET_PDEATHSIG` backstop (Linux only).** The supervisor also calls
   `prctl(PR_SET_PDEATHSIG, SIGKILL)` so the kernel `SIGKILL`s the supervisor
   the instant its parent dies, in case the supervisor itself is killed or the
   pipe `EOF` is missed. Linux-only; on macOS the pipe-death-notice alone
   applies. The `prctl` must be set immediately after fork to avoid the
   re-parenting race.
3. **Stale-PID reconciler (safety net, portable).** At spawn the extension
   records each agent's PID, process-group id, runtime tag, and the app-server
   PID in a registry under the session log directory. On the next extension
   startup a reconciler scans the registry, probes `kill(pid, 0)`, and for
   entries whose owning parent Pi PID is dead it kills the orphan group and
   marks the run stale. This catches anything the primary layers missed
   (supervisor killed, `SIGKILL` race, whole-machine reboot before the
   supervisor fired) — but only at next launch, so it is a backstop, not the
   primary.

### Codex app-server

The app-server is one shared process, so it gets exactly one supervisor, not
one per Codex agent. Its process group is killed by the same three layers. The
app-server's own `remoteControl/status/changed` notifications do not help on
crash because the extension must be alive to receive them.

### Custom-view hosting

The supervised process is the agent process the extension spawns, not the
launch-template command. The launch template only opens the external view
(e.g. a tmux window) that hosts the agent's TUI. If opening that view spins up
a long-lived daemon such as a tmux server, that daemon's members are reached by
the stale-PID reconciler rather than by the pipe-death-notice supervisor.

## UI Integration

Agent hosting is fixed at extension startup by whether `ui.launch_template` is
configured, and an agent session cannot transfer between hostings for its
lifetime. The launch template is read once at startup; mid-session settings
changes do not move an agent between hostings.

- If `ui.launch_template` is empty or missing, agents are **native-only**: the
  extension hosts each agent itself, and the native transcript tab is the only
  user-facing surface.
- If `ui.launch_template` is configured, agents are **hosted in a custom view**:
  the extension uses the configured launch template to open an external view
  (tmux, etc.), runs the agent launch command inside that view, and stays
  connected to the agent through the extension runtime for capture, delivery,
  and lifecycle.

The native transcript tab is presented in both hostings. In custom-view hosting
it coexists with the external TUI; both read the same underlying agent state.
The extension's hooks, app-server subscription, delivery queue, and mention
capture feed the native transcript projection in either hosting, which is how the
native view stays live even while the agent's interactive surface is hosted
externally.

When no launch template is configured, the extension provides a Pi-native
overlay with a unified multi-tab layout: agent tabs are stacked vertically on
the left side and the selected agent's structured transcript fills the remaining
width. The overlay is the only user-facing surface for the agent.

### Custom-view hosting

When a launch template is configured, the extension still spawns and owns the
agent process. The launch template only opens the external view — a pane, tab,
or window (e.g. a tmux window) — that hosts the agent's interactive TUI; it
must not contain the agent launch command itself. The extension runs the agent
launch command inside that view and stays connected for capture, delivery, and
lifecycle, and still presents the native transcript tab alongside the external
TUI.

v1 uses a single launch-template system, not separate focus/open subcommands.

For Codex agents, the extension launches the agent attached to the existing
app-server-hosted thread (via the known remote endpoint and `threadId`), not a
fresh session that would create a second thread.

### Native transcript event sources

The native transcript tab is a live projection of agent state. It is presented
in both native-only and custom-view hostings and is fed by the same event
sources in either case.

For Codex agents, the tab is a live projection of the existing app-server-hosted
thread state used by message delivery. For Pi agents, the tab is a projection of
the Pi runtime's structured agent/tool/message events.

Event sources by harness:

- Codex:
  - app-server thread status updates
  - app-server turn-completion notifications
  - delivery queue state maintained by the extension
  - required hook-captured tool artifacts for completed-turn tool usage
- Pi:
  - `message_update`
  - `turn_end`
  - `tool_execution_start`
  - `tool_execution_update`
  - `tool_execution_end`
  - `agent_end`

Pi-specific transcript projection details:

- `message_update.text_delta` contributes to the in-progress assistant message.
- `message_update.thinking_start|thinking_delta|thinking_end` may drive a
  transient compact status row but should not render hidden reasoning text.
- `message_update.toolcall_start|toolcall_delta|toolcall_end` can provide an
  early compact `• tool(args...)` row before tool execution begins.
- `tool_execution_start` should create a compact tool row.
- `tool_execution_update` may update that row with compact progress text.
- `tool_execution_end` should finalize the row as success or error.
- `turn_end` finalizes the assistant message and any ordered tool-result
  artifacts for the turn.
- `agent_end` should surface completion, retry, or terminal failure state as a
  compact row when useful.

## Explicit v1 Scope

Included:

- visible named agents
- parent-owned spawn / monitor / teardown
- messenger-style presence and messaging
- markdown + YAML frontmatter agent definitions
- explicit runtime tags unique within the main session
- fresh-transcript startup with orchestrator-authored handoff
- per-agent harness and model selection
- configurable harness default args plus appended `command_args`
- plain-`pi` fallback when no named config is prescribed
- unified overlay with left-side agent tabs, presented in both hostings
- transcript messages rendered without border or box decoration, distinguished
  by indentation and theme colors only
- `/agents` command and `ctrl+a` keybinding for overlay access
- editor widget showing compact agent roster (`ctx.ui.setWidget("shmits-angels", ...)`)
- footer indicator showing per-agent state with harness and model
  (`ctx.ui.setStatus("shmits-angels", ...)`)
- `/agents spawn`, `/agents kill`, `/agents msg`, `/agents list`, `/agents logs`
  subcommands
- overlay hotkey footer listing all keyboard shortcuts for tab navigation and
  overlay actions (`↑/k up · ↓/j down · Enter switch · x close · Esc back · ^A reopen`)
- `x` keybinding to kill the focused agent and remove its tab

Excluded:
- builtin packaged agents
- hidden workers
- reservation/resource-claim mechanics
- crew planning
- chain orchestration
- autonomous multi-step workflow engines

## Status

This extension is not implemented in this repo yet. Use this README as the
current contract for future implementation and doc review work.
