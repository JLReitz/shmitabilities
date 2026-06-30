# pi-headroom

Pi extension that integrates Headroom's local proxy and MCP server with stock
Pi sessions.

This directory contains the implemented v1 extension, its config/routing and
runtime helpers, and focused tests.

## Goals

- Start, reuse, and stop a local `headroom proxy` process for Pi sessions.
- Route Pi provider traffic through that proxy without requiring global shell
  mutations.
- Expose Headroom MCP tools to the active Pi session:
  `headroom_compress`, `headroom_retrieve`, and `headroom_stats`.
- Surface concise runtime status in Pi's extension status area so other UI
  extensions can render Headroom state.
- Keep Headroom state local and explicit: no silent cloud telemetry, no hidden
  global wrapping of unrelated agents, and no unpinned runtime installation.

## Non-Goals

- Do not reimplement Headroom compression in TypeScript.
- Do not call OpenRouter, Anthropic, OpenAI, or any other provider directly
  from this extension. Headroom remains the provider edge.
- Do not run `headroom wrap pi`; Pi extension lifecycle owns the integration.
- Do not treat the Headroom HTTP proxy as an MCP HTTP transport. MCP is a
  separate `headroom mcp serve` process unless a future Headroom release
  documents a combined transport.
- Do not mutate user-level Headroom or Pi configuration files without an
  explicit user action.

## Source Inputs

The adjacent `../headroom` checkout is the source for Headroom behavior.
Relevant contracts observed there:

- `headroom proxy` starts an HTTP proxy. Default bind is
  `127.0.0.1:8787`.
- The proxy handles OpenAI-compatible, Anthropic, Gemini, Bedrock, OpenRouter,
  and other configured backends through Headroom's own provider routing.
- `headroom mcp serve` starts the MCP server. Stdio is the default transport.
- `headroom mcp serve --transport http --host 127.0.0.1 --port 8788 --path /mcp`
  starts Streamable HTTP MCP. The HTTP proxy does not automatically expose
  `/mcp`.
- Headroom writes config under `HEADROOM_CONFIG_DIR` or
  `~/.headroom/config`, and runtime state under `HEADROOM_WORKSPACE_DIR` or
  `~/.headroom`, with some project-scoped `.headroom/` memory paths when memory
  features are enabled.
- Current Headroom proxy defaults include cache-oriented coding behavior and
  telemetry off by default.

## User Flow

1. User installs Headroom separately with a supported Python tool, for example
   `uv tool install "headroom-ai[proxy,mcp]"` or an equivalent pinned install.
2. User loads Pi with this extension enabled.
3. Extension resolves the `headroom` binary and verifies `headroom --version`
   or an equivalent health command before it changes session routing.
4. Extension starts or reuses a loopback proxy matching configured ownership
   rules.
5. Extension starts an MCP bridge for `headroom mcp serve --proxy-url
   <proxy-url>`.
6. Pi model traffic flows through Headroom's proxy. When compressed originals
   are needed, the model can call the Headroom MCP retrieval tool.
7. On session end, extension stops only processes it owns.

## Configuration

Configuration uses JSON files:

- user: `~/.pi/agent/headroom.json`
- project: `<cwd>/.pi/headroom.json`

Project config overrides user config by explicit field path. Scalars replace
scalars, arrays replace arrays, and nested objects merge by key unless a field
documents replacement semantics. `proxy.env` and `routing.upstreamOverrides`
merge by key, with project values replacing only the named environment variable
or provider/selector override. Unknown keys are unsupported and produce a
startup warning. Malformed JSON produces a visible startup error without
changing Pi routing.

Example:

```json
{
  "enabled": true,
  "headroomCommand": "headroom",
  "proxy": {
    "mode": "managed",
    "host": "127.0.0.1",
    "port": 8787,
    "modeArg": "cache",
    "env": {
      "HEADROOM_SAVINGS_PROFILE": "coding"
    },
    "healthPath": "/health",
    "startupTimeoutMs": 10000,
    "shutdownTimeoutMs": 3000
  },
  "mcp": {
    "enabled": true,
    "mode": "stdio",
    "serverName": "headroom",
    "startupTimeoutMs": 10000
  },
  "routing": {
    "autoDetect": true,
    "defaultUpstream": "",
    "upstreamOverrides": {},
    "sessionHeader": true,
    "upstreamHeader": "x-headroom-base-url"
  },
  "state": {
    "configDir": "",
    "workspaceDir": "",
    "stateless": false
  },
  "ui": {
    "statusKey": "headroom",
    "showSavings": true,
    "showProxyHealth": true
  }
}
```

### Fields

| Field | Type | Default | Description |
|---|---:|---|---|
| `enabled` | boolean | `true` | Enables the extension. `false` registers no routing and starts no process. |
| `headroomCommand` | string | `headroom` | Binary or absolute path used for all Headroom subprocesses. |
| `proxy.mode` | enum | `managed` | `managed` starts the proxy if needed; `external` only checks `proxy.url`; `disabled` skips proxy routing. |
| `proxy.url` | string | derived | Base URL Pi should route through. In managed mode this is derived from `proxy.host` and `proxy.port`; in external mode it is required config. |
| `proxy.host` | string | `127.0.0.1` | Host used when launching a managed proxy. Must be loopback in v1. |
| `proxy.port` | number | `8787` | Port used when launching a managed proxy. |
| `proxy.modeArg` | string | `cache` | Safe Headroom proxy mode passed as `--mode <value>`. V1 supports `cache` unless Headroom source confirms another safe value. |
| `proxy.env` | object | `{}` | Extra non-secret environment for the proxy child process. API key values should not be stored here. |
| `proxy.healthPath` | string | `/health` | Origin-relative health path checked before routing traffic. It must begin with one `/` and cannot contain backslashes or newlines. |
| `proxy.startupTimeoutMs` | number | `10000` | Time allowed for managed proxy startup. |
| `proxy.shutdownTimeoutMs` | number | `3000` | Time allowed for owned proxy shutdown. |
| `mcp.enabled` | boolean | `true` | Starts Headroom MCP integration. |
| `mcp.mode` | enum | `stdio` | Only `stdio` is in v1. HTTP MCP is deferred. |
| `mcp.serverName` | string | `headroom` | MCP server registration name inside Pi. |
| `mcp.startupTimeoutMs` | number | `10000` | Time allowed for MCP startup. |
| `routing.autoDetect` | boolean | `true` | Derive Pi provider and Headroom upstream routing from Pi harness model/provider metadata. |
| `routing.defaultUpstream` | string | `""` | Optional upstream selector used instead of the harness-derived selector. Empty means derive from Pi harness metadata, falling back to OpenRouter. |
| `routing.upstreamOverrides.<provider-or-selector>.backend` | string | provider-derived | Optional Headroom proxy backend override for a Pi harness provider name or `routing.defaultUpstream` selector. |
| `routing.upstreamOverrides.<provider-or-selector>.baseUrl` | string | provider-derived | Optional real upstream API base URL override for a Pi harness provider name or `routing.defaultUpstream` selector. |
| `routing.upstreamOverrides.<provider-or-selector>.apiKeyEnv` | string | provider-derived | Optional credential environment variable name override for a Pi harness provider name or `routing.defaultUpstream` selector. The config stores the name, not the secret value. |
| `routing.sessionHeader` | boolean | `true` | Add `x-headroom-session-id` when the Pi provider transport supports custom headers. |
| `routing.upstreamHeader` | string | `x-headroom-base-url` | Header used to select a per-request upstream base URL when needed. |
| `state.configDir` | string | `""` | Optional `HEADROOM_CONFIG_DIR`. Empty uses Headroom default. |
| `state.workspaceDir` | string | `""` | Optional `HEADROOM_WORKSPACE_DIR`. Empty uses Headroom default. |
| `state.stateless` | boolean | `false` | Adds `--stateless` to managed proxy launch. |
| `ui.statusKey` | string | `headroom` | Key passed to `ctx.ui.setStatus`. |
| `ui.showSavings` | boolean | `true` | Include token savings in status when available. |
| `ui.showProxyHealth` | boolean | `true` | Include proxy health in status. |

## Runtime Behavior

The extension entrypoint is `index.ts`. It registers the three Headroom MCP tool
names, loads `headroom.json` from user and project scopes, starts or validates
the configured proxy, registers the active Pi provider route to the Headroom
proxy URL, and stops only owned subprocesses on session shutdown. A new,
resumed, or reloaded session first removes its prior provider override and
stops its owned children before loading replacement configuration.

### Binary Resolution

The extension resolves `headroomCommand` without installing packages. If the
binary is not found, startup fails closed: no routing changes are applied, and a
visible status/error reports the missing command.

The extension may print an install hint, but it must not run `pip`, `pipx`, or
`uv tool install` automatically.

### Failure Behavior

For configuration, binary, credential, proxy-health, or unexpected proxy-exit
failures, **fail closed** means that the extension removes only its own Pi
provider override. Pi then resumes its harness-selected provider routing path;
the extension does not terminate Pi, mutate harness configuration, or leave an
unverified Headroom route active. When a Pi UI context is available, the full
non-secret reason is sent as an error notification and the status line shows a
truncated error.

MCP is optional to the provider route. An MCP startup failure cleans up that
bridge only and reports the error in the TUI; a bridge exit likewise reports an
error and marks the bridge unavailable. A healthy proxy and its active Pi route
remain available. Individual MCP tool failures are returned as visible Pi tool
errors and do not shut down the extension.

### Proxy Ownership

`proxy.mode` controls process ownership:

- `managed`: reuse a healthy Headroom proxy at the derived loopback URL, or
  start `headroom proxy --host <host> --port <port> --backend <backend> --mode
  <proxy.modeArg>` when none is healthy. The Pi-facing proxy URL is derived
  from the configured host and port.
- `external`: never start or stop a proxy; only verify `proxy.url`.
- `disabled`: do not route provider traffic through Headroom.

Managed mode only binds loopback hosts in v1. External mode also accepts only a
loopback `proxy.url`. A non-loopback host is a config error because it may expose
provider traffic and compressed content to the network.

V1 does not accept arbitrary proxy or MCP argument arrays. Security-sensitive
flags such as `--host`, `--port`, `--backend`, logging, memory, learn, transport,
or path flags must be represented by explicit config fields before they are
supported. Unknown fields still produce a startup warning.

In managed mode, a configured `proxy.url` is invalid because it can diverge from
the owned process. The extension derives the route URL from `proxy.host` and
`proxy.port` after validating the host is loopback. In external mode, `proxy.url`
is required and `proxy.host` / `proxy.port` are ignored.

Health checks must verify both the configured host/port and a Headroom-specific
health response. A plain HTTP 200 from an arbitrary localhost service is not
enough. `proxy.healthPath` is constrained to the configured proxy origin so it
cannot redirect the health probe to another host.

On shutdown or reload, owned children receive `SIGTERM`; after the configured
timeout they receive `SIGKILL`, and the extension waits for exit before a
replacement can start. A bounded fallback prevents an unresponsive child from
blocking Pi shutdown forever.

Concurrent proxy pooling across multiple sessions, providers, credentials, and
state modes is deferred; see `DEFERRED.md`. V1 owns one active derived route for
the current Pi session.

### Provider Routing

The extension configures two distinct provider layers:

1. **Pi-facing provider route.** Pi sends model requests to `proxy.url`
   (`http://127.0.0.1:8787` by default). This is always a Headroom proxy URL.
2. **Headroom upstream provider.** Headroom forwards compressed requests to the
   upstream profile derived from Pi harness metadata. If the harness does not
   expose enough provider information, the fallback upstream is `openrouter`.

Fallback managed launch when Pi harness metadata is missing or maps to
OpenRouter:

```bash
OPENROUTER_API_KEY=<from environment> \
headroom proxy --host 127.0.0.1 --port 8787 --backend openrouter --mode cache
```

The extension should read the active model and provider metadata from the Pi
harness before applying routing. The derived route has two parts:

- **Pi provider route:** the Pi provider family that already knows how to speak
  the model's wire format, such as Anthropic Messages or OpenAI-compatible chat.
- **Headroom upstream profile:** the real provider/backend Headroom should use
  after compression, derived from the Pi harness provider name and model
  metadata.

When `routing.autoDetect` is true, the extension derives both pieces at session
startup and whenever Pi changes the active model/provider. Static
`routing.piProviders` and `routing.upstreams` config are not required in v1.
The derived values should be materialized in memory as the active route and
included in debug/status output, but they do not need to be written back to
`headroom.json`.

Minimum Pi harness inputs:

| Harness value | Purpose |
|---|---|
| provider name | Selects the Headroom upstream profile and credential environment. |
| model ID | Preserved for diagnostics and used when provider aliases need model-specific routing. |
| wire-format/provider family | Selects the Pi-facing provider route to repoint at `proxy.url`. |
| provider base URL | Preserved as the upstream `baseUrl` when available. |

#### Fetching Harness Metadata

The extension should collect metadata from Pi in this order:

1. On `session_start`, read the live extension context:
   - `ctx.model.id`
   - `ctx.model.name`
   - `ctx.model.provider`
   - `ctx.model.contextWindow`
   - `ctx.model.maxTokens`
   - `ctx.thinkingLevel`
   - `ctx.sessionManager.getSessionId()`
   - `ctx.sessionManager.getSessionName()`
   - `ctx.cwd`
2. Subscribe to model lifecycle events and refresh the derived route when Pi
   emits:
   - `model_select` with `event.model`
   - `model_change` with `event.modelId`
3. When an event is partial, merge it over the last complete route snapshot
   instead of dropping known metadata. For example, a `model_change` event with
   only `modelId` updates `model` but keeps the previous provider until
   `ctx.model.provider` or a richer `model_select` event is available.
4. If Pi exposes provider configuration or model registry APIs in a future
   release, prefer those structured APIs for provider base URL and wire-format
   family. Until then, derive conservatively from `ctx.model.provider`,
   `ctx.model.id`, and the current Pi provider family selected by the harness.

The extension should treat the fetched metadata as runtime state. It can expose
the derived route in debug logs or status text, but it should not write the
auto-detected route back to `headroom.json`.

#### Credential Resolution

API key values do not need to be provided through `headroom.json`, and should
not be stored there. The config may name the expected environment variable with
`routing.upstreamOverrides.<provider-or-selector>.apiKeyEnv`, but the secret
value must come from the process environment inherited by the managed proxy or
from a provider-specific credential mechanism Headroom already supports.

Resolution order for a managed proxy:

1. Derive `apiKeyEnv` from the Pi harness provider name. For OpenRouter this is
   `OPENROUTER_API_KEY`.
2. Apply `routing.upstreamOverrides.<provider-or-selector>.apiKeyEnv` if present.
3. Verify that the named variable is present in the extension process
   environment before launching the proxy.
4. Pass the existing environment through to the proxy child process. Do not copy
   the secret into logs, status text, `headroom.json`, or generated command
   strings.

If the key is missing at startup, the extension fails closed before changing Pi
routing and surfaces a short diagnostic such as `headroom: missing
OPENROUTER_API_KEY`. If it becomes missing during a model change, the extension
removes the active Pi provider override but keeps a healthy local proxy and MCP
bridge running so a later valid model selection can recover without restarting
them.
`proxy.env` remains available for non-secret Headroom knobs such as
`HEADROOM_SAVINGS_PROFILE`; it is not the required path for provider API keys.

The extension should prefer Pi's provider-level base URL and header hooks when
available. The Pi provider remains the family Pi selected for the active model,
but its base URL is rewritten to the local Headroom proxy. If Pi exposes only
environment-based provider routing, the extension may set session-scoped child
environment variables for the active Pi process, not global shell profile files.

Routing must preserve the real upstream provider URL as Headroom configuration,
not as Pi's direct base URL. For the OpenRouter fallback profile:

- `proxy.url` stays `http://127.0.0.1:8787`.
- managed proxy args include `--backend openrouter`.
- `OPENROUTER_API_KEY` must be present in the proxy child environment.
- the derived upstream profile's `baseUrl` records
  `https://openrouter.ai/api/v1` for diagnostics and any Headroom feature that
  needs an explicit upstream base.

#### Derived Upstream Profile

The extension builds an in-memory upstream profile from Pi harness metadata:

```ts
interface DerivedUpstreamProfile {
  name: string;
  piProvider: string;
  model: string;
  backend: string;
  baseUrl: string | null;
  apiKeyEnv: string | null;
}
```

`backend` is the Headroom proxy backend selector. For a managed proxy, the
extension passes it directly to `headroom proxy --backend <backend>`.

It is not necessarily the Pi provider name and it is never the model ID. Pi
selects a wire-format provider for the active model, then points that provider
at `proxy.url`. Headroom receives the request and uses `backend` to decide which
upstream adapter forwards the compressed request.

Examples:

| Upstream profile | `backend` | Managed proxy argument | Credential source |
|---|---|---|---|
| `openrouter` | `openrouter` | `--backend openrouter` | `OPENROUTER_API_KEY` |
| `anthropic-direct` | `anthropic` | `--backend anthropic` | Anthropic provider environment |
| `bedrock-prod` | `bedrock` | `--backend bedrock` | AWS environment/profile |
| `litellm-openai` | `litellm-openai` | `--backend litellm-openai` | LiteLLM/OpenAI environment |

When Pi reports an OpenRouter provider, or when provider metadata is missing or
ambiguous, the derived profile is:

```json
{
  "name": "openrouter",
  "backend": "openrouter",
  "baseUrl": "https://openrouter.ai/api/v1",
  "apiKeyEnv": "OPENROUTER_API_KEY"
}
```

So the fallback managed proxy launch uses `--backend openrouter`.

`routing.defaultUpstream` and `routing.upstreamOverrides` are escape hatches:

- `routing.defaultUpstream` forces an upstream selector such as `openrouter` when
  auto-detection is insufficient or the user wants every model routed through one
  upstream. It does not define a separate static `routing.upstreams` registry.
- `routing.upstreamOverrides.<provider-or-selector>` patches the derived profile
  for a Pi harness provider name or default selector without disabling
  auto-detection globally.

If the provider transport supports custom headers and a non-default upstream is
selected, the extension sends the upstream base with `x-headroom-base-url`;
otherwise v1 must decline routing for that provider with a visible warning.
Launching separate proxy instances for different upstreams is deferred with
concurrent proxy pooling.

The only built-in v1 default selector is `openrouter`, which maps to backend
`openrouter`, base URL `https://openrouter.ai/api/v1`, and credential variable
`OPENROUTER_API_KEY`. Other selector names are valid only when
`routing.upstreamOverrides.<selector>` supplies enough information to build a
complete `DerivedUpstreamProfile`.

OpenRouter is the default upstream, but it is still indirect: Pi routes to
Headroom, and Headroom uses OpenRouter as the upstream backend. `proxy.url` must
not be set directly to `https://openrouter.ai/api/v1` because OpenRouter is not
a Headroom proxy and does not implement Headroom health or compression
endpoints.

### MCP Bridge

MCP starts as:

```bash
headroom mcp serve --proxy-url http://127.0.0.1:8787
```

The extension registers the MCP tools with Pi when the extension loads, before
proxy or MCP startup is attempted. Tool names exposed to the model remain
Headroom's own names:

- `headroom_compress`
- `headroom_retrieve`
- `headroom_stats`

The tools remain exposed if proxy or MCP startup fails. Calls made while the MCP
bridge is unavailable return a visible Pi tool error (`headroom MCP bridge is
not running`) rather than starting a process, changing provider routing, or
shutting down the extension.

If Pi has no generic MCP-host API, v1 should implement a narrow stdio bridge
for these tools rather than shelling out per tool call. The bridge owns one MCP
server process, sends JSON-RPC over stdio, and tears it down with the session.

### Status

The extension sets `ctx.ui.setStatus("headroom", text)` when possible.
Recommended status forms:

- `headroom: disabled`
- `headroom: proxy starting`
- `headroom: proxy ok`
- `headroom: proxy ok, mcp ok`
- `headroom: saved 12.4k`
- `headroom: error: <short reason>`

The status string must stay short; detailed diagnostics belong in logs or an
explicit tool result.

### State And Files

The extension does not own Headroom's storage format. It only supplies
environment variables or CLI arguments:

- `HEADROOM_CONFIG_DIR` from `state.configDir`
- `HEADROOM_WORKSPACE_DIR` from `state.workspaceDir`
- `--stateless` from `state.stateless`

Default v1 behavior leaves these unset so Headroom uses its own defaults.

## Security Requirements

- Managed proxy host must be loopback.
- The extension must fail closed when health verification is ambiguous.
- The extension must not auto-install or upgrade Headroom.
- If a future install helper is added, it must support pinned versions and an
  explicit user action.
- The extension must not trust `HEADROOM_URL` or similar environment variables
  over explicit config.
- Internal `x-headroom-*` headers must remain internal to Headroom and must not
  be forwarded by custom Pi code to upstream providers.
- Proxy logs with message content are opt-in only.

## Current Guarantees

- Configuration is merged from user and project scopes, validated before use,
  and rejected visibly when JSON is malformed or a supported field is invalid.
- Managed and external proxy URLs are loopback-only, and health probes require a
  Headroom-specific response at an origin-relative path.
- Reload and shutdown remove the active Pi provider override and stop only the
  child proxy and MCP processes owned by the extension.
- The active provider route is updated from complete `model_select` metadata or
  partial `model_change` metadata. A missing credential clears routing until a
  valid model selection restores it.
- The extension exposes `headroom_compress`, `headroom_retrieve`, and
  `headroom_stats` through one stdio MCP bridge when MCP is enabled.

## Validation

Run the focused implementation checks:

```bash
npx tsc -p extensions/pi-headroom/tsconfig.test.json --noEmit
npx vitest run extensions/pi-headroom/test
npm run test:coverage:headroom
```

The tests cover configuration merge and parse failures, loopback and
health-path validation, managed/external proxy behavior, provider-route
credential handling and recovery, MCP JSON-RPC initialization, framing, parser
recovery, RPC errors, pending-request cleanup, and owned-process teardown.
The coverage command uses Vitest's V8 provider and reports only this extension's
entrypoint and runtime/config source files.

The generic fake child process lives in `test/helpers/fake-child.ts`. The
MCP-specific JSON-RPC control surface lives in `test/harness/mcp-stdio.ts`; it
captures newline-delimited requests and can emit chunked responses, errors, and
process exits. Keep lifecycle fixtures dependent on the generic helper and
protocol assertions dependent on the MCP harness.

## Further Validation

- Type-check new TypeScript surfaces with `npx tsc --noEmit` or the
  extension-specific tsconfig.
- Unit-test config merge, loopback validation, process ownership, and health
  response validation.
- Unit-test that managed mode derives `proxy.url` from `proxy.host` and
  `proxy.port` and rejects direct `proxy.url` overrides.
- Unit-test that arbitrary proxy/MCP argument arrays and deferred flags are
  rejected.
- Unit-test that `external` mode never starts or stops a proxy.
- Unit-test route derivation from mocked Pi harness provider/model metadata.
- Unit-test that missing or ambiguous harness metadata falls back to
  `--backend openrouter` and requires `OPENROUTER_API_KEY`.
- Unit-test that OpenRouter direct `proxy.url` is rejected unless it points to a
  Headroom proxy.
- Integration-test MCP over stdio with a fake MCP server before using real
  Headroom.
- Smoke-test real `headroom proxy` and `headroom mcp serve` only when the
  `headroom` binary is available; otherwise skip with a clear reason.
- Full-host Pi render test should use the repo-level tmux procedure and verify
  the Headroom status is visible without submitting a prompt.
