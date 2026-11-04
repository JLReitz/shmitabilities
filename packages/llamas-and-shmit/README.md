# llamas-and-shmit

Connect Pi and DeepSeek Harness (DSH) to one persistent, host-local llama.cpp router.
The runtime host supplies `llama-server` and GGUF model files. Each client retains its native
model registration; the package uses the selected provider and exact model ID to check the
router's reported inventory.

```text
┌───────────────────────────────────┐
│ Pi or DSH selected provider/model │
└─────────────────┬─────────────────┘
                  │ startup, selection, or request
                  ▼
┌───────────────────────────────────┐
│ llamas-and-shmit client interface  │
└─────────────────┬─────────────────┘
                  │ selected model + native provider URL
                  ▼
┌───────────────────────────────────┐   root + shared settings   ┌────────────┐
│ llamas-and-shmit core              │ ◄──────────────────────── │ shmit-core │
│ validates URL and router settings  │                           └────────────┘
└─────────────────┬─────────────────┘
                  │ probe 127.0.0.1:port
                  ▼
┌───────────────────────────────────┐
│ llama.cpp router                  │ ◄── inactive port: start llama-server
└─────────────────┬─────────────────┘          with models.ini
                  │ GET /models inventory
                  ▼
┌───────────────────────────────────┐
│ selected ID present: connect      │
│ invalid response or absent: error │
└───────────────────────────────────┘
```

The [shared package contract](../../docs/packages.md) defines how `shmit-core` supplies the
managed agent root and optional settings to capability packages. This package interprets only
its own `shmit.llamacpp` router settings.

## Local model routing

`llamas-and-shmit` separates the launch catalog, client metadata, and active availability:

| Artifact | Responsibility |
|---|---|
| `~/.config/shmit/models.ini` | Native llama.cpp presets: model files and runtime tuning. |
| Pi `models.json` and DSH profile configuration | Provider URL, exact model ID, display name, capabilities, context, and token limits. |
| Active router `GET /models` response | Models available on the configured port, including unloaded models. |
| `~/.config/shmit/settings.toml` | Optional shared command, INI path, and port. |

The package supports Linux and WSL runtime hosts. Install the runtime dependencies through
[Local model routing dependencies](../../docs/dependencies.md#local-model-routing-dependencies).

### Settings

All settings are optional. The capability applies these defaults:

| Setting | Default | Meaning |
|---|---|---|
| `shmit.llamacpp.command` | `llama-server` | Executable name on `PATH` or absolute executable path. |
| `shmit.llamacpp.model_ini` | `${HOME}/.config/shmit/models.ini` | Absolute path to the native llama.cpp preset file. |
| `shmit.llamacpp.port` | `8080` | Router port bound to `127.0.0.1`. |

`agent-root` means the root returned by `shmit-core`. The package passes `command` directly to
process creation without a shell; put model tuning in `models.ini`. `model_ini` must be an
absolute path; the package does not expand shell variables in configured values. `port` must
be an integer from `1` through `65535`. Command must be nonempty.

For example, the shared settings file can select a custom port:

```toml
[shmit.llamacpp]
command = "llama-server"
port = 8081
```

Register each client provider in its native configuration: Pi uses the account's
`.pi/agent/models.json`; DSH uses its selected profile's `cordis.patch.yml` under `$DSH_HOME`.
Set the configured router port in each provider URL. For example, a Pi provider entry sets
`baseUrl` to `http://127.0.0.1:8081/v1`; a DSH `llm-pi-ai` provider sets `baseURL` to the same
endpoint. Each native entry also supplies the exact model ID and client metadata.

The URL must use HTTP, address `127.0.0.1` at that
port, and omit embedded credentials. `localhost` does not satisfy the address check. The
package leaves the API path under client control, so `http://127.0.0.1:8081/v1` is valid.

### Launch catalog

Write a native llama.cpp preset whose section name matches the client model ID:

```ini
[local-model]
model = /absolute/path/to/model.gguf
ctx-size = 8192
```

Relative file paths inside `models.ini` resolve from its parent directory because the package
starts the server with that working directory. Absolute paths also work. The package passes the
INI path through `--models-preset` and does not parse its contents. llama.cpp validates model
options and loads models on request.

### Connection and process lifecycle

A selected model activates routing when its native provider URL addresses the configured router
port. Other provider URLs leave their native client behavior in place.
The package validates settings and the native URL, then probes the configured loopback port.
An active router is compatible when its `/models` inventory contains the exact selected model ID.
Display names may differ. Unloaded models qualify. An absent ID produces an unavailable-model
error for that port.

When the port is inactive, the package starts:

```text
<command> --host 127.0.0.1 --port <port> --models-preset <model_ini>
```

It waits up to 30 seconds for the router inventory before reporting a startup timeout. The port
is the singleton boundary:
concurrent sessions can attempt startup, and a session that loses the bind race waits for the
winning listener and checks its inventory. An occupied port that fails the router check produces
an error.

The active router's inventory controls compatibility even when the local INI file differs.
The package does not restart or replace an active listener, check process ownership, or compare
configuration fingerprints. Treat the loopback listener as a trusted local service.

The router remains active after client exit or extension unload. Stop it explicitly through the
host's process tools; restart it explicitly when launch settings or presets must change. The
package owns processes it starts only through startup and does not maintain a service-manager
registration, PID registry, or model catalog cache.

### Client interfaces

Pi loads `src/pi-llamas-and-shmit/index.ts` through the package's `pi.extensions` manifest
entry. The directory name makes Pi show `pi-llamas-and-shmit` in the startup extension list for
a local checkout. [Pi loads TypeScript extension files directly](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md), so the archive includes `src/`
and local checkouts can load this entry before the package builds `dist/`. It connects at startup
and on model selection. The `model_change`
compatibility event also reaches the same shared operation.

DSH loads `dist/dsh-llamas-and-shmit/index.js` through the package root export. Its shipped
`cordis.patch.yml` mounts the bundle after the `agents`, `llm`, and `loader` services are
available. DSH connects
at `agent/created` startup. Its `session/event` observer handles committed `model/selection`
events; failures are logged because that observer cannot reject the committed selection. The
awaited `llm/stream` hook verifies availability before each request and propagates failures.
ACP model changes therefore connect on the next request. The interface resolves the provider's
native `baseURL` from the configurable-provider registration and its live loader configuration,
including Cordis volatile values, with the native default URL as fallback.

Each interface translates its native selected model and URL into the shared operation. Client
registrations remain under native client configuration. Register all or a subset of server models
with exact IDs; the capability does not generate client registrations or aliases.

The public `@jlreitz/llamas-and-shmit/core` entry exports `loadLlamaConfig()`,
`targetsRouter(baseUrl, config)`, `validateProviderUrl(baseUrl, config)`, and
`ensureRouter(modelId, config)`. Another interface
loads its client configuration, validates the native provider URL, then ensures the selected
model is available. Keep host SDK imports and event translation within that interface. The Pi
entry does not load DSH, and the DSH entry does not load Pi.

## Build and validation

The package builds JavaScript and declarations under `dist/`. Its archive includes the runtime
entries, source required by Pi, the DSH patch, and this README. Run `npm run format` to write
source formatting and `npm run format:check` to verify it. Both packages use the same dprint
configuration and plugin version selected by their manifests and lockfiles.

The current local-checkout installation requires `packages/shmit-core` as a sibling because
the capability declares a `file:../shmit-core` dependency. An archive needs a separately
resolvable or bundled component before it can support standalone distribution.

Use [Shared Node packages](../../docs/dependencies.md#shared-node-packages) for dependency installation,
build checks, package archive inspection, and client loading. Verify startup, model changes, an
existing router, an absent model, an invalid listener, and concurrent startup. A client load confirms
registration; a successful `/models` check confirms availability, and a completion request
separately confirms that the model can load and generate.
