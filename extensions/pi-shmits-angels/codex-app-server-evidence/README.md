# Codex app-server evidence captures

Raw JSON-RPC captures from a real `codex app-server` (v0.142.5) driven through
representative turns. These back the findings in the parent `README.md`
"Observed app-server item shapes (evidence)" section and the resolved open
questions in `AGENTS.md`.

Treat these as observed-at-this-version, not as a stable protocol contract.
Re-capture when implementation begins or when the Codex CLI version changes.

## Files

| file | what it captures |
| --- | --- |
| `app-server-capture.py` | the working harness for the prompt-drivable app-server scenarios. Starts `codex app-server` on a loopback WebSocket listener, drives the approval-wait, explicit-user-input-wait, failed-tool, active-turn steer, resumed-thread `turn/start`, and web/search/fetch scenarios, and writes one JSON artifact per scenario plus assertion summaries. Each run stages an isolated `CODEX_HOME`, copies auth material from the source home, and installs a hook logger for the configured events so the artifact records both raw app-server traffic and any parsed hook records observed for that run. Uses `gpt-5.4-mini` for every turn. The approval-wait scenario targets the repo-backed workspace cwd instead of a temp dir. The steer scenario sends `turn/steer` with the `expectedTurnId` returned by `turn/start` after a long-running `commandExecution` item opens the mid-turn window. The resume scenario disconnects, reconnects, calls `thread/resume`, then runs `turn/start` and `thread/read(includeTurns=true)` on the resumed thread; it records each resume attempt so the artifact shows whether this Codex build required a rollout-path retry after a `threadId`-only failure. The web/search scenario now enables search with `-c web_search=\"live\"`. |
| `src/config_and_hook_error_capture.py` | isolated harness for the remaining "configuration and harness error/warning notifications" gap. It writes one artifact for a launch-time configuration error and one for an isolated `SessionStart` hook scenario, and each artifact explicitly distinguishes `startup_failure_before_transport` from websocket-visible RPC traffic. The harness now copies auth material into its isolated `CODEX_HOME` so remote auth failures do not dominate the hook scenario. The supported test path on this Linux host is loopback WebSockets; unix-socket listen remains an experiment because `codex app-server --listen unix://...` failed with `EPERM` before transport. Every scenario is pinned to `gpt-5.4-mini`. Remote-endpoint fault injection is intentionally out of scope. |
| `01_initialize.json` | `initialize` response + `remoteControl/status/changed`. |
| `02_thread_start.json` | `thread/start` response, `thread/started`, `mcpServer/startupStatus/updated`. |
| `03_turn_start_plain.json` | plain-reply turn: `turn/started`, `hook/started`+`hook/completed` (sessionStart), `item/started`+`item/completed` for `userMessage`/`reasoning`/`agentMessage`, `item/agentMessage/delta` stream, `thread/tokenUsage/updated`, `thread/status/changed`, `turn/completed`. |
| `04_thread_read.json` | `thread/read` after the plain turn. Note `itemsView: "full"` returns only `userMessage` + `agentMessage`. |
| `05_turn_with_tool.json` | **key file**. Tool-triggering turn. Shows the `commandExecution` item via `item/started`+`item/completed` with `command`, `aggregatedOutput`, `exitCode`, `durationMs`, `commandActions[]`. Also shows a `commentary`-phase `agentMessage` before the tool call. |
| `06_turn_steer.json` | steer attempt. Turn completed before the steer; server returned `error: {code: -32600, message: "no active turn to steer"}`. A successful mid-generation steer is **not** captured. |
| `07_final_thread_read.json` | final `thread/read` with all three turns. Confirms `commandExecution` is omitted from `thread/read` items even for the tool turn. |
| `08_inject_items.json` | `thread/inject_items` returned `{result: {}}`. |
| `11_failed_tool_command_execution.json` | failing shell-tool turn. Shows `commandExecution.status: "failed"`, `exitCode: 127`, `aggregatedOutput` with the shell error text, and the exact failing command string. The paired isolated-home hook log remained empty, so this artifact proves the app-server item shape but not the completed-turn hook path. |
| `12_web_search_fetch.json` | web-search turn captured with `web_search="live"`. Shows a distinct `webSearch` item type in live app-server traffic instead of only shell `commandExecution`. |
| `13_successful_turn_steer.json` | accepted mid-generation `turn/steer`. Shows `turn/steer` returning `result.turnId` equal to the original active turn id and the final assistant output reflecting the steered instruction. The paired isolated-home hook log remained empty. |
| `14_thread_resume_turn_start.json` | reconnect-and-deliver evidence. Shows `thread/resume` failing by `threadId` alone with `no rollout found for thread id ...`, `thread/resume.path` failing with `requires experimentalApi capability`, and a second-connection `turn/start` against the original `threadId` still completing successfully. `thread/read(includeTurns=true)` preserves the resumed turn in stored history. |
| `launch_time_config_error.json` | launch-time config failure. Shows a local bad `config.toml` field surfacing only in process stderr before transport; no websocket connection or JSON-RPC traffic is established. |

## What this evidence does not cover yet in checked-in JSON artifacts

- approval-wait item shape
- explicit user-input-wait item shape
- isolated-home hook capture for tool turns. The failed-tool and successful-steer artifacts both recorded zero parsed hook records even after switching the harness to per-tool hook events.
- successful `thread/resume` reattachment. The checked-in resume artifact proves resumed delivery on a second connection, but it does not include a successful `thread/resume` response payload.
- `SessionStart` hook failure notification shape. The launch-time config error is captured, but the isolated hook scenario still did not emit hook notifications or dedicated error/warning notifications on this host/version.
- unix-socket transport remains an open question until Codex's unix-socket permission model is verified for this host.

## Re-capturing

```sh
python3 codex-app-server-evidence/app-server-capture.py
```

To run only one prompt-driven scenario:

```sh
python3 codex-app-server-evidence/app-server-capture.py --scenario successful-turn-steer
```

For the configuration/harness error surface:

```sh
python3 codex-app-server-evidence/src/config_and_hook_error_capture.py
```

`app-server-capture.py` writes to `/tmp/codex-app-test2/` by default and
creates per-scenario temporary working directories under
`/tmp/codex-app-test2/.scenario-workspaces/`. Each scenario also stages an
isolated `CODEX_HOME` under that temp tree, copies auth material from the
current `CODEX_HOME` (or `--codex-home`), writes trusted-project entries for
the repo/workspace paths involved in the run, and installs the configured hook
logger. The resulting artifact records the isolated `codex_home`, the hook log
path, and any parsed hook records so app-server traffic can be correlated with
same-run hook output when Codex actually loads those hooks.

In one live `thread-resume-turn-start` run on Codex CLI `0.142.5`,
`thread/resume` by `threadId` alone returned
`error: {code: -32600, message: "no rollout found for thread id ..."}` even
though the thread path from `thread/start` still existed and a subsequent
`turn/start` against that `threadId` succeeded. The harness now retries
`thread/resume` with the rollout `path` recorded in the original
`thread/start` response and writes every attempt into `thread_resume_attempts`
for later evidence review.
One immediate rerun of that scenario was blocked before execution by the
approval-review service, which rejected the out-of-sandbox command with a
usage-limit notice: `You've hit your usage limit. Upgrade to Pro
(https://chatgpt.com/explore/pro), visit
https://chatgpt.com/codex/settings/usage to purchase more credits or try again
at 12:57 AM.` Treat it as an external execution blocker, not as app-server
protocol evidence or a harness regression.
`src/config_and_hook_error_capture.py` writes to
`/tmp/pi-shmits-angels-codex-app-server-errors/` by default and stages its
isolated `CODEX_HOME` sandboxes under
`/tmp/pi-shmits-angels-codex-app-server-evidence/`. The harness also writes
project trust entries into each temporary `config.toml` for any ancestor path
that already carries a `.codex` marker, so hooks and exec policies can run
without manual trust prompts in the isolated temp tree.

Both harnesses require `codex` on PATH. `app-server-capture.py` uses loopback
WebSockets on this host, not unix sockets. The web/search scenario requires a
Codex build that accepts `web_search="live"`. The hook-failure turn in
`src/config_and_hook_error_capture.py` additionally requires usable Codex auth
in the isolated `CODEX_HOME`; without that, the websocket capture may reflect
upstream provider/auth errors before the run reaches the intended hook surface.
