# pi-headroom Agent Instructions

This directory contains the implemented v1 Pi extension, its configuration and
runtime helpers, and focused regression tests.

## Source Of Truth

- Use `README.md` as the public behavior contract for the extension.
- Keep `src/config.ts` and `test/config.test.ts` aligned with the v1
  configuration, routing, and deferred-feature contract in `README.md`.
- Keep `index.ts`, `src/runtime.ts`, and `test/runtime.test.ts` aligned with
  the session lifecycle, proxy ownership, provider routing, health validation,
  and MCP bridge behavior in `README.md`.
- Use the adjacent `../headroom` checkout for current Headroom proxy, MCP,
  filesystem, and CLI behavior.
- Re-check Headroom source before changing protocol, CLI, or path assumptions;
  Headroom is moving quickly.
- Read `DEFERRED.md` before adding features that v1 deliberately leaves
  out.

## Implementation Rules

- Do not auto-install Headroom from the extension. Resolve a configured
  `headroom` binary and fail closed with a visible diagnostic when missing.
- Fail closed means remove only the extension-owned Pi provider override so Pi
  resumes its harness-selected provider route; publish the full non-secret error
  through the TUI when a context is available. Do not terminate Pi or alter its
  harness configuration.
- Do not add arbitrary `proxy.args` or `mcp.args` passthroughs. Expose only
  reviewed config fields so deferred or security-sensitive Headroom flags cannot
  bypass the v1 spec.
- Keep managed proxy binds and external `proxy.url` values loopback-only unless
  the security model is updated in both `README.md` and this file.
- Keep `proxy.healthPath` origin-relative: it must begin with one forward slash
  and must not permit network-path, backslash, or newline URL normalization.
- Do not accept a generic localhost `200` as proof that Headroom is running.
  Health checks must validate a Headroom-specific response.
- Keep proxy and MCP lifecycle separate. `headroom proxy` is not an MCP server;
  `headroom mcp serve` is the MCP process.
- Treat every `session_start` as a lifecycle boundary, including reload and
  resume. Stop extension-owned children and remove the prior provider override
  before applying newly loaded configuration; never overwrite a child reference
  in place.
- On a model route refresh, verify the newly selected upstream credential before
  registering Pi routing. If it is missing, unregister only the Pi provider
  route so a later valid selection can reuse the healthy proxy and MCP bridge.
- Treat MCP startup, exit, and tool-call failures as bridge failures: publish an
  error to the TUI, clean up only the failed bridge when needed, and keep a
  healthy proxy and Pi provider route running. Do not shut down the extension
  because MCP is unavailable.
- Preserve the model-change compatibility handler alongside `model_select` and
  merge partial model metadata over the prior route state.
- When stopping an owned child, wait for its exit after `SIGTERM` or `SIGKILL`
  before starting a replacement. Keep a bounded final fallback so shutdown
  cannot hang indefinitely.
- Preserve Headroom as the provider edge. The extension should not implement
  provider-specific API calls except for Pi routing configuration.
- Derive Pi provider and Headroom upstream routing from Pi harness model/provider
  metadata before applying user overrides. OpenRouter is the fallback upstream
  when that metadata is missing or ambiguous.
- Pi must still route to the local Headroom proxy; do not set Pi's proxy URL
  directly to OpenRouter or any other upstream provider.
- Do not store provider API key values in `headroom.json`, generated docs,
  status text, or logs. Config may name an environment variable such as
  `OPENROUTER_API_KEY`, but the secret value must come from the runtime
  environment or Headroom-supported credential mechanism.
- Do not write to user-level Pi or Headroom config files without explicit user
  action.
- If root package loading changes, keep `pi.extensions`, shipped files, bundled
  dependencies, and postinstall behavior coherent in the same change.

## Validation

- For documentation-only changes, validate by reading `README.md`, `AGENTS.md`, and
  `DEFERRED.md` for consistency.
- For implementation changes, add focused unit tests for config merge,
  malformed-config handling, reload lifecycle ownership, route credential
  recovery, loopback validation, health verification, process teardown, and
  MCP bridging before adding full-host tests.
- Keep reusable child-process primitives in `test/helpers/`; keep JSON-RPC
  framing, request, and response controls in `test/harness/mcp-stdio.ts`.
  Test `McpStdioClient` with that protocol harness rather than embedding MCP
  parsing behavior in lifecycle fixtures.
- Run `npx tsc -p extensions/pi-headroom/tsconfig.test.json --noEmit` and
  `npx vitest run extensions/pi-headroom/test` after implementation or test
  changes.
- For changes that rely on real Headroom behavior, run tests in `../headroom`
  or cite the exact source files inspected.
