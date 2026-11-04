# pi-headroom Deferred Work

Deferred items are deliberate v1 exclusions. Do not implement them without
updating `README.md`, `AGENTS.md`, and the relevant tests.

## Automatic Headroom Installation

**What:** Running `pip`, `pipx`, or `uv tool install` from the extension when
the `headroom` command is missing.

**Why deferred:** Installing Python packages from a Pi extension changes the
host outside the active session and creates version drift. The extension only
resolves the configured binary and reports a visible failure when it is absent.

**What implementation would require:** Explicit user action, version pinning,
installer selection, failure rollback, and documentation for the changed host
state.

**Anchor:** `README.md` sections "User Flow", "Binary Resolution", and
"Security Requirements".

## HTTP MCP Transport

**What:** Running `headroom mcp serve --transport http` and connecting Pi to
the HTTP endpoint.

**Why deferred:** The default Headroom MCP contract is stdio, and the Headroom
HTTP proxy does not expose MCP at `/mcp`. The extension implements one
session-owned stdio bridge and does not own a second MCP listener or port.

**What implementation would require:** Pi-side HTTP MCP client support,
separate port ownership, health checks for the MCP HTTP endpoint, and collision
handling distinct from the proxy port.

**Anchor:** `README.md` sections "Source Inputs" and "MCP Bridge".

## Non-Loopback Proxy URLs

**What:** Allowing managed `headroom proxy` to bind `0.0.0.0` or a LAN address,
or allowing external `proxy.url` to point at a non-loopback host.

**Why deferred:** The proxy handles provider credentials, prompts, compressed
content, and retrieval markers. Exposing it requires an authentication and TLS
model that is outside v1.

**What implementation would require:** Authentication, TLS guidance, firewall
expectations, explicit operator opt-in, and tests that remote exposure is never
the default.

**Anchor:** `README.md` sections "Proxy Ownership" and "Security Requirements".

## Headroom Memory And Learn Controls

**What:** First-class UI/config for `headroom proxy --memory`, `--learn`,
memory DB selection, and learning evidence thresholds.

**Why deferred:** These features write durable project or user memory and need a
clear operator consent model. V1 exposes no generic argument passthrough, and it
should not make memory persistence a default.

**What implementation would require:** Dedicated config fields, consent wording,
path validation, tests for project-scoped `.headroom/` behavior, and docs for
the resulting durable files.

**Anchor:** `README.md` sections "State And Files" and "Configuration".

## Arbitrary Headroom Argument Passthroughs

**What:** Generic `proxy.args` or `mcp.args` arrays that append unchecked CLI
arguments to `headroom proxy` or `headroom mcp serve`.

**Why deferred:** Unchecked passthroughs can bypass v1 security and lifecycle
rules by changing bind hosts, ports, backends, transports, logging, memory,
learn, or state paths without corresponding validation.

**What implementation would require:** A reviewed allowlist, conflict detection
against explicit config fields, validation for every security-sensitive flag, and
tests proving deferred features cannot be enabled accidentally.

**Anchor:** `README.md` sections "Configuration", "Proxy Ownership", and "MCP
Bridge".

## Provider-Specific Direct Clients

**What:** Calling Anthropic, OpenAI, OpenRouter, or other provider APIs directly
from this extension.

**Why deferred:** Headroom already owns provider dispatch. Direct clients in
the Pi extension would duplicate security, request formatting, streaming, and
header-stripping logic.

**What implementation would require:** A new provider abstraction, request and
streaming tests per provider, and proof that direct calls do not bypass
Headroom compression or leak internal headers.

**Anchor:** `README.md` sections "Non-Goals" and "Provider Routing".

## Cross-Session Proxy Pooling And Multi-Upstream Instances

**What:** Sharing, isolating, or launching Headroom proxy instances across
multiple concurrent Pi sessions, agents, models, providers, credentials, state
roots, memory/learn modes, or upstreams.

**Why deferred:** Managed mode may adopt a healthy proxy at its configured
loopback URL, but it does not establish that the process is compatible with a
different session's backend, credentials, or state. The extension owns at most
one child proxy and one MCP bridge for its active session and does not schedule
separate instances when an upstream changes.

**Target behavior:** A process-wide pool serves concurrent extension instances
without allowing a request to cross an incompatible provider, credential, or
state boundary. Each active Pi session acquires one compatible proxy lease and
routes only through that lease's loopback URL. Compatible sessions share the
same proxy; incompatible sessions receive distinct instances. A model or
provider change releases the old lease only after the new compatible lease is
healthy and the Pi provider override has been switched. A session ending,
reloading, or failing closed releases only its own lease.

**Pool key:** The manager must construct an immutable, normalized compatibility
key from every proxy-launch or request-isolation input:

- Headroom binary identity (resolved executable path plus version), proxy mode,
  reviewed proxy arguments, and non-secret `proxy.env` values.
- Headroom backend selector and normalized upstream base URL.
- Credential identity: the credential mechanism and environment-variable name,
  plus a non-reversible fingerprint of the resolved credential value. Never
  retain, print, serialize, or place the secret value in a status/error message.
  An unavailable credential cannot join a pooled instance.
- `HEADROOM_CONFIG_DIR`, `HEADROOM_WORKSPACE_DIR`, `state.stateless`, and each
  future memory/learn setting that changes durable state or request behavior.
- The required transport/wire-format compatibility surface, including any
  provider-specific headers that Headroom must interpret process-wide.

The Pi session ID, model ID, display name, and request-only
`x-headroom-session-id` value are deliberately excluded from the pool key. They
identify traffic within a compatible shared proxy and must not cause one proxy
per conversation. Any setting that cannot be proven request-scoped belongs in
the key and therefore isolates the instance.

**Instance lifecycle and ownership:** A `ProxyPool` must be process-wide rather
than stored in a single `HeadroomRuntime`. It owns records containing the
compatibility key, derived loopback URL, child process or verified external
identity, health state, lease count, pending startup promise, and bounded idle
shutdown timer. Acquiring a key coalesces concurrent startup into one promise;
no caller may register a Pi route until that promise completes with a
Headroom-specific health response. Releasing a lease is idempotent. When the
last lease ends, the pool terminates only a managed child after the configured
grace period, using the existing bounded TERM/KILL-and-wait protocol. It never
stops an external instance.

If an owned child exits, its pool record becomes unhealthy, all leases using it
lose only their extension-owned Pi provider override, and each affected TUI
receives the non-secret failure reason. The pool must evict the record after
notifying leases so a later acquire may start a replacement. A stale or
unreachable record is never reused merely because its port is listening.

**Port allocation:** Managed instances require deterministic loopback-only
allocation. The configured port is reserved for the first compatible key. Each
additional key receives a stable candidate from a configured pool/range derived
from a collision-resistant hash of the key, with probing for occupied ports and
an OS-reserved fallback port. The selected port is held through child launch and
health verification, recorded only in process memory, and released on child
exit. The implementation must reject an occupied port unless it can prove that
the listener is a compatible Headroom instance; it must not adopt an arbitrary
healthy service. The public configuration must expose an explicit bounded port
range and startup-collision policy before this feature is enabled.

**External proxies:** External mode is shareable only when an explicit,
non-secret instance identity endpoint or handshake proves its compatibility key.
The URL and a generic health response are insufficient. Until Headroom exposes
that identity safely, each external proxy URL is an isolated operator-managed
route and is not entered in the managed pool. The extension continues never to
stop an external process.

**Multi-upstream routing:** The pool selects an instance from the complete key,
not just the provider name. Different backend selectors, base URLs, credential
identities, state roots, or process-scoped options always receive separate
instances. Requests for the same compatible instance retain
`x-headroom-session-id` when the Pi transport supports headers. The existing
`x-headroom-base-url` request header may select an upstream only when Headroom
documents that selection as request-scoped and credential-safe; otherwise its
base URL and backend remain part of the pool key. Pi still routes exclusively to
the selected local Headroom proxy, never directly to an upstream.

**MCP binding:** An MCP bridge leases the exact proxy record selected for its Pi
session and launches with that record's `--proxy-url`. It cannot be shared by
two Pi sessions unless the Headroom MCP protocol documents concurrent
session-safe multiplexing and the bridge has its own compatibility key and
request correlation. Initially, every session gets an independent stdio MCP
bridge while compatible sessions may share the proxy. Proxy loss makes only the
bound bridges unavailable; it reports a TUI error and leaves the MCP tools
registered. MCP startup, exit, or call failure must not release a healthy proxy
lease or shut down the extension.

**Failure behavior:** Pool acquisition, compatibility comparison, port
allocation, launch, health, or lease-switch failure fails closed per affected
session: remove only that session's extension-owned provider override, publish
the full non-secret error to its TUI when available, and let Pi use the
harness-selected provider route. It must not interrupt other leases, mutate the
harness route, disclose key fingerprints, or terminate the extension. A failed
new lease preserves the old healthy lease until the route switch is committed;
afterward the old lease is released normally.

**Required interfaces and configuration:** Implement explicit, validated
configuration rather than generic CLI passthroughs. At minimum define a pool
enablement mode, loopback port range, idle shutdown duration, maximum managed
instances, and an operator-visible instance label. Define immutable
`ProxyCompatibility`, `ProxyLease`, `ProxyPoolRecord`, and `ProxyPool` interfaces
with testable acquire, release, health-invalidate, and shutdown operations.
Expose non-secret status only: instance label/port, lease count, backend label,
and health. Do not write pool membership, credentials, or selected ports to
user configuration files.

**Open questions before implementation:**

- Is the pool limited to extension instances within one Pi/Node process, or
  must it share proxies between independent Pi processes? The latter requires a
  coordinator, IPC, and crash-recoverable lock/ownership state rather than a
  module-level pool.
- Is Pi provider registration session-local? If it is host-global, concurrent
  sessions with different lease URLs need provider aliases or an equivalent
  namespaced routing mechanism. Confirm the scope of extension instances,
  provider overrides, tool registration, and tool-call session context.
- Which Headroom release is the supported target, and which launch settings are
  process-scoped versus request-scoped? In particular, verify whether
  `x-headroom-base-url` is request-scoped and credential-safe, and whether
  Headroom exposes a non-secret identity/handshake that proves instance
  compatibility beyond generic health.
- Which Headroom configuration, workspace, cache, memory, and learning paths
  are safe to share concurrently? Any path or option without that guarantee
  must isolate an instance or receive a per-instance directory.
- What credential identity and rotation policy applies? Decide whether a
  process-local non-reversible fingerprint of the resolved credential is
  sufficient, and whether a changed environment value creates a new lease for
  new sessions immediately or only after an explicit refresh.
- Is pooling opt-in or enabled by default, and what are the defaults for port
  range, maximum managed instances, idle shutdown, collision handling, and
  status labels? Managed-only pooling is the initial safe boundary; external
  proxies remain unpooled until a compatibility handshake exists.
- May a later Pi process adopt a managed child started by another process? If
  so, specify the verified ownership and identity protocol. Otherwise, a
  coordinator may stop only children it launched.
- What is the route-switch contract for in-flight model requests? Specify the
  commit point between acquiring/health-checking a new lease, changing the Pi
  route, and releasing the old lease.
- Does acceptance require real concurrent Pi hosts and Headroom instances, or
  are deterministic multi-runtime tests plus a focused real-process smoke test
  sufficient?

**Required tests:**

- Concurrent equal keys coalesce into one launch and reference-counted leases;
  final release terminates exactly one owned child after the idle policy.
- Every differing key component above isolates to a new instance, especially
  different credential values with the same environment-variable name.
- Secrets and credential fingerprints never appear in commands, logs, status,
  thrown errors, snapshots, or serialized pool state.
- Port collisions, stale children, duplicate release, startup races, health
  failures, and replacement after unexpected exit leave no leaked leases or
  child references.
- A model/provider switch commits a healthy new route before releasing the old
  lease; an unsuccessful switch retains the old route or fails closed without
  affecting other sessions.
- External URLs cannot be pooled without a compatibility handshake and are
  never terminated by release or shutdown.
- MCP bridges bind to their leased proxy URL; bridge failures preserve healthy
  provider routing and tool visibility; proxy failures notify each affected TUI
  and return affected sessions to harness routing.

**Anchor:** `README.md` sections "Proxy Ownership", "Provider Routing", and
"MCP Bridge"; `src/runtime.ts` `HeadroomRuntime.start()` and
`HeadroomRuntime.refreshRoute()`.
