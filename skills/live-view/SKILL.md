---
name: live-view
description: Use localhost-live to publish local artifacts for browser review, keep a stable local URL across revisions, and push ordered updates in a single session.
license: MIT
metadata:
  hermes:
    tags: [preview, live, localhost-live]
---

# Live View

Use this skill when the user wants a stable browser URL for iterative review of local artifacts.

## Prerequisites

- Use Python 3.11 or newer.
- Expect no third-party Python runtime packages; `localhost-live` uses only the standard library at runtime.
- Use the bundled repo-local launcher at `./bin/localhost-live`; no install or dependency bootstrap step is required from a plugin checkout.
- If developing the standalone tool package itself, the package build backend expects `setuptools>=68` and `wheel`.
- Use `pytest>=8.0.0` only when running `tools/localhost-live/tests`.
- For browser auto-open via `localhost-live view`, rely on a platform opener such as `open` on macOS, `xdg-open` on Linux GUI sessions, or `wslview` on WSL.

## Canonical Commands

From a plugin checkout, run the bundled launcher as `./bin/localhost-live ...`.

- `localhost-live session create`
- `localhost-live push`
- `localhost-live view`
- `localhost-live url`
- `localhost-live status`
- `localhost-live save`
- `localhost-live export`
- `localhost-live stop`

## Best-Practice Workflow

1. Generate or update the artifact to preview.
2. Create one session for the review thread with `localhost-live session create`.
3. Resolve and report the live URL once via `localhost-live view` (use `localhost-live url` when only URL output is needed).
4. Push subsequent revisions in chronological order with `localhost-live push` so state history stays ordered.
5. Use `localhost-live save` or `localhost-live export` only when requested or when persistence/hand-off is useful.
6. End the session lifecycle with `localhost-live stop` when the review is complete.

## Environment-Aware Defaults

- Check applicable `LOCALHOST_LIVE_*` values before choosing defaults for host, port, runtime root, idle timeout, open policy, or no-start behavior.
- Treat environment values as operative defaults unless the user explicitly asks to override them.
- Apply strict precedence: `CLI options > environment variables > built-in defaults`.
- Do not hard-code fallback defaults in examples when a `LOCALHOST_LIVE_*` default is available.
- Keep guidance at the CLI level; do not shift users toward server internals.

Relevant variables:

- `LOCALHOST_LIVE_HOST`
- `LOCALHOST_LIVE_PORT`
- `LOCALHOST_LIVE_RUNTIME_ROOT`
- `LOCALHOST_LIVE_IDLE_TIMEOUT`
- `LOCALHOST_LIVE_OPEN`
- `LOCALHOST_LIVE_NO_START`

## Guardrails

- Do not instruct server internals, internal runtime storage details, or direct manifest editing.
- Do not bypass CLI flows for state management; use the canonical `localhost-live` commands.
- Keep path usage portable and non-user-specific.
