# pi-shmits-angels — Agent Notes

Agent instructions for `extensions/pi-shmits-angels/`.

This directory is currently docs-only. Read [README.md](README.md) before
making changes. The live contract is that file plus this one.

## File layout

```text
README.md   — user-facing contract and v1 scope
AGENTS.md   — implementation and maintenance notes for contributors/agents
codex-app-server-evidence/ — raw app-server JSON-RPC captures + the harness that
  produced them. See codex-app-server-evidence/README.md for the file index.
  Backs the "Observed app-server item shapes" findings in README.md and the
  resolved open questions below.
```

If implementation files are added later, extend this section in the same change.

For evidence maintenance on this host/version, treat
`codex-app-server-evidence/app-server-capture.py` as a loopback-WebSocket
harness. Do not switch it back to unix-socket app-server listen as the default
capture path unless the unix-socket permission question is resolved with fresh
evidence.
Keep the harness on its isolated `CODEX_HOME` flow so each scenario records the
paired hook log path and parsed completed-turn hook artifacts alongside the raw
app-server traffic. Do not fall back to inheriting the live home directly as
the only capture path.
Keep the web-search scenario on the current Codex config surface:
`-c web_search="live"`, not `--enable search`.
Keep the config/hook error harness copying auth material into its isolated
`CODEX_HOME`; otherwise the SessionStart scenario can collapse into upstream
401 reconnect noise instead of local hook evidence.
Keep the approval-wait scenario on the repo-backed workspace cwd, not the temp
scenario directory, so it exercises a real approval gate instead of writing to
`/tmp`.
Keep the active-turn steering scenario on the documented app-server contract:
send `turn/steer` with the `expectedTurnId` returned by `turn/start`, and only
after the target turn is visibly active. The current harness uses the start of
a long-running `commandExecution` item as that mid-turn steer window.
For resumed-thread evidence on this host/version, the harness now disconnects
after `thread/start`, reconnects, and retries `thread/resume` with the rollout
`path` from the original thread metadata if `threadId` alone returns
`no rollout found for thread id ...`. Keep both attempts in the artifact until
the `threadId`-only behavior is verified on a newer Codex build.
If an out-of-sandbox rerun is rejected by approval review with a Codex usage
limit notice, record that blocker in the evidence docs and stop. Do not treat
the usage-limit rejection as app-server protocol behavior.

## Design contract

The authoritative v1 contract lives in [README.md](README.md). Do not restate
its rules here; when a rule changes, change README and update the validation
checklist below.

README sections that define the contract:

- [Purpose](README.md#purpose)
- [Planned Settings](README.md#planned-settings)
- [Agent Definitions](README.md#agent-definitions)
- [Agent Model And Harness Contract](README.md#agent-model-and-harness-contract)
- [Spawn Command Contract](README.md#spawn-command-contract) — including
  harness-specific launch patterns and the output-capture contract
- [Native Transcript UI](README.md#native-transcript-ui) — including tab bar,
  transcript area, overlay hotkeys, projection rules, Codex app-server
  delivery/event/attachment contracts, and the observed item-shape evidence
- [Transcript And Handoff Model](README.md#transcript-and-handoff-model)
- [Coordination Model](README.md#coordination-model)
- [Session Logs](README.md#session-logs)
- [Process Termination And Crash Recovery](README.md#process-termination-and-crash-recovery)
- [UI Integration](README.md#ui-integration)
- [Explicit v1 Scope](README.md#explicit-v1-scope)

## Open questions

These are unresolved design/verification questions. Do not silently treat them
as settled behavior. Questions marked [resolved] have evidence-backed answers
from the `codex-app-server-evidence/` captures; the resolution is summarized
here and detailed in the README "Observed app-server item shapes" section.

- [resolved] Do current Codex app-server items already expose structured
  tool-call and tool-result artifacts with enough detail to back native
  `• tool(...)` rows?
  - Partially. Streaming `commandExecution` items expose `command` (args),
    `aggregatedOutput` (result), `exitCode` (outcome), and `durationMs` —
    sufficient for live `• bash(...)` rows. A separate `webSearch` item type is
    also now observed. `functionCall`/`computerCall` item types still were not
    seen, and `reasoning` items carry no usable content.
- [resolved] If Codex app-server items do expose that structure, is the
  coverage complete enough to reduce hook capture to a redundancy layer rather
  than the required primary capture path?
  - No. `thread/read` omits `commandExecution` items even with
    `itemsView: "full"`, so a late-attaching view or post-hoc reconstruction
    cannot recover tool artifacts from the app-server. Hook capture remains the
    required authoritative source for completed-turn tool artifacts.
- [resolved] If both hook artifacts and app-server tool items are available
  for the same turn, what exact merge/deduplication rule should the
  implementation use?
  - Correlate by `threadId` + `turnId` + command string. The practical merge is
    between live streaming items (only if subscribed during the turn) and
    hook artifacts (always available post-turn); `thread/read` is not a party
    to the merge because it drops `commandExecution`. Hook artifacts stay
    primary; streaming `commandExecution` may pre-fill a live row before the
    hook fires, then the hook finalizes outcome and error text.
- [resolved] What does a failed shell-tool `commandExecution` look like?
  - The checked-in failure capture shows `status: "failed"`, `exitCode: 127`,
    and `aggregatedOutput` carrying the shell error text.
- [resolved] Does successful mid-generation `turn/steer` work on this build?
  - Yes. The checked-in steer capture shows `turn/steer` returning
    `result.turnId` equal to the active turn id, and the final assistant output
    follows the steered instruction.
- [resolved] What is the resumed delivery path on this build?
  - A second-connection `turn/start` against the original `threadId` succeeds
    and is preserved by `thread/read(includeTurns=true)` even when
    `thread/resume` fails by `threadId` and by `path`.
- [resolved] Is web search/fetch shell-backed or a distinct item type?
  - Distinct. The checked-in web-search capture includes a `webSearch` item
    type when the app-server is started with `-c web_search="live"`.
- Still open — item-shape and delivery gaps:
  - approval-wait item shape
  - explicit user-input-wait item shape
  - successful `thread/resume` reattachment payload
  - isolated-home hook capture for tool turns
- Still open — protocol surface beyond item shapes:
  - unix socket listen permissions: on this Linux host, isolated
    `codex app-server --listen unix://...` runs failed with `EPERM` before the
    websocket transport came up, including runs with candidate unix-socket
    allow overrides. Keep the evidence harness on loopback WebSockets until
    Codex's unix-socket permission model is verified for this host/version.
  - configuration/harness error and warning notifications: the checked-in
    launch-time config error proves one local failure path stays entirely in
    startup stderr before transport. The isolated SessionStart hook scenario
    still did not emit hook notifications or dedicated error/warning
    notifications, so that notification surface remains undecided.

The capture workflow for those remaining gaps is defined in
[README.md](README.md#remaining-evidence-capture-plan). When a gap is closed,
update the raw evidence inventory, the README evidence section, and the open
question here in the same change.

## Upstream sources to stay aligned with

When implementation starts, verify behavior against the actual source trees,
not just their READMEs:

- `../../../pi-extensions/pi-messenger`
- `../../../pi-extensions/pi-subagents`
- `../../../pi-extensions/pi-interactive-shell`

Use them for:

- mesh presence and messaging
- session/log artifact patterns and child-run lifecycle
- overlay embedding and configurable spawn-command defaults

Do not cargo-cult source details that conflict with this extension's own
contract. This extension is intentionally selective, not a wholesale port.

## Scope guardrails

The v1 limits listed in README's
[Explicit v1 Scope](README.md#explicit-v1-scope) are intentional, not
omissions to "fix" casually. If you widen scope, update both `README.md` and
this file in the same change.

## Validation

There is no extension-local test harness yet. For doc-only changes, validate by
reading the docs for internal consistency:

- settings paths match the intended filenames exactly
- settings files are not described as agent-definition files
- settings key spellings match the documented v1 contract exactly
- the harness executable is fixed (`codex`/`pi`) and not user-configurable; no
  `spawn.commands` key is documented, and `spawn.default_args` is described as
  appended right after the fixed executable
- `codex.app_server.listen` is described as an optional listen address only
- `agentPaths` is described as additive to the default roots unless the design
  itself changes
- agent discovery roots match the documented defaults
- harness/model examples match the documented grammar
- interactive and monitored harness launch patterns stay aligned
- Codex app-server ownership is described as extension-owned for v1, with no
  `mode` selector or externally-provided endpoint
- Codex app-server lifetime and startup/teardown semantics stay aligned
- native-only and custom-view hostings are described consistently
- native-only hosting is described as transcript projection, not full TUI
  embedding
- the native transcript tab is described as presented in both hostings,
  coexisting with the external TUI in custom-view hosting
- Codex tool rows are described as hook-backed rather than optional best-effort
- every spawned process is described as running in its own process group
- graceful teardown escalates `SIGINT` -> `SIGTERM` -> `SIGKILL` per agent group
- hard-crash teardown layers stay aligned: pipe-death-notice supervisor
  (primary, portable), `PR_SET_PDEATHSIG` (Linux backstop), stale-PID
  reconciler (safety net at next startup)
- the Codex app-server is described as having exactly one supervisor, not one
  per Codex agent
- custom-view daemon members are described as reached by the stale-PID
  reconciler, not by the pipe-death-notice supervisor
- Codex attachment semantics stay aligned with the shared-thread model
- the launch template fully owns view configuration; the documented v1
  launch-template placeholders are `{{agent_name}}` and `{{agent_tag}}`
- "runtime name" terminology is normalized to "runtime tag"; tags are two
  human-readable words (adjective + noun) joined with a hyphen in kebab-case
  (e.g. `calm-reef`), matching the `pi-interactive-shell` convention
- codex `exec --json` and pi `-p --mode json` are injected by the extension
  only in native-only hosting; in custom-view hosting they come from
  `default_args` when used
- fallback plain-`pi` behavior is described consistently
- mention-detection/output-capture requirements are described consistently
- Codex delivery semantics match the app-server contract
- native-mode event classes and harness-specific event sources stay aligned
- the remaining-evidence capture plan stays aligned with the current open-gap
  list and evidence inventory
- implicit mention-routing semantics are described consistently
- the unified overlay is described with left-side tab bar, no per-agent overlays
- tab bar states are described: active highlight, unread badge, working dot, idle dot
- transcript messages are described as unbordered — no box/border decoration
- `/agents` command, `ctrl+a` keybinding, and spawn-only auto-open are documented
- auto-open is documented as spawn-only: `/agents spawn <name>` opens the overlay
  with the new agent focused; routed messages do not trigger auto-open
- agent indicator widget format matches the spec
  (`⚡ @calm-reef (codex) · @warm-mist (pi) · ●2 unread`)
- footer indicator format matches the spec
  (`agents: @calm-reef(codex/4o) idle · @warm-mist(pi/sonnet) working`)
- footer state labels and theme colors match the spec
- widget is set via `ctx.ui.setWidget("shmits-angels", ...)`, footer via
  `ctx.ui.setStatus("shmits-angels", ...)`
- subcommands table is consistent with the spawn/kill/msg/list/logs contract
- empty state message in transcript area is documented
- overlay hotkey section is documented with the persistent footer legend format
  (`↑/k up · ↓/j down · Enter switch · x close · Esc back · ^A reopen`)
- `x` keybinding for killing the focused agent is documented
- tab navigation bullets in the Tab bar section reference the Overlay hotkeys section
  instead of duplicating keybindings inline
If code is added later, replace this section with the real validation commands
and only claim checks you actually ran.
