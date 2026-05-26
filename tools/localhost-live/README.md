# localhost-live

`localhost-live` is a local-only live viewer service for ordered HTML state snapshots.

## Quick start

From `tools/localhost-live/`:

```bash
PYTHONPATH=src python3 -m localhost_live --help
```

Run tests:

```bash
UV_CACHE_DIR=/tmp/uv-cache uv run --with pytest python -m pytest tests -q
```

## Environment defaults

`localhost-live` supports a small `LOCALHOST_LIVE_*` default surface.

- Precedence is strict and uniform: `CLI options > environment variables > built-in defaults`.
- If a CLI option is provided, it always wins over the corresponding environment variable.
- Environment variables only provide defaults when the CLI option is omitted.

Supported v1 variables:

- `LOCALHOST_LIVE_HOST`
- `LOCALHOST_LIVE_PORT`
- `LOCALHOST_LIVE_RUNTIME_ROOT`
- `LOCALHOST_LIVE_IDLE_TIMEOUT`
- `LOCALHOST_LIVE_OPEN` (`auto`, `always`, `never`)
- `LOCALHOST_LIVE_NO_START` (`1`, `0`, `true`, `false`, `yes`, `no`, `on`, `off`)

`LOCALHOST_LIVE_PORT` is the canonical default-port variable. `LOCALHOST_LIVE_PORT=0` means auto-assign.

Example: environment defaults

```bash
export LOCALHOST_LIVE_PORT=4312
export LOCALHOST_LIVE_OPEN=never
PYTHONPATH=src python3 -m localhost_live start --json
PYTHONPATH=src python3 -m localhost_live view <SESSION_ID>
```

Example: explicit CLI override

```bash
PYTHONPATH=src python3 -m localhost_live --runtime-root /tmp/live-demo start --port 0 --json
PYTHONPATH=src python3 -m localhost_live view <SESSION_ID> --open always
```

## Common workflows

Use `--runtime-root` during testing/automation for isolation.

1. Start the localhost server (loopback-only):

```bash
PYTHONPATH=src python3 -m localhost_live --runtime-root /tmp/live-demo start --port 0 --json
```

2. Create a session from a file or directory:

```bash
PYTHONPATH=src python3 -m localhost_live --runtime-root /tmp/live-demo session create --title "Demo" --from ./index.html --json
```

3. Push updates:

```bash
PYTHONPATH=src python3 -m localhost_live --runtime-root /tmp/live-demo push <SESSION_ID> --from ./next.html --json
```

4. Inspect status and URL:

```bash
PYTHONPATH=src python3 -m localhost_live --runtime-root /tmp/live-demo status --json
PYTHONPATH=src python3 -m localhost_live --runtime-root /tmp/live-demo url <SESSION_ID> --json
```

5. Save a static replayable directory:

```bash
PYTHONPATH=src python3 -m localhost_live --runtime-root /tmp/live-demo save <SESSION_ID> --to ./artifact --json
```

6. Export a replayable archive:

```bash
PYTHONPATH=src python3 -m localhost_live --runtime-root /tmp/live-demo export <SESSION_ID> --to ./artifact.liveview.zip --json
```

7. Stop the server:

```bash
PYTHONPATH=src python3 -m localhost_live --runtime-root /tmp/live-demo stop --json
```

## Runtime and stale descriptor recovery

- Default runtime root is `${XDG_RUNTIME_DIR:-${TMPDIR:-/tmp}}/shmitabilities-live/localhost-live`.
- Runtime control files are:
- `server.json` (active server descriptor)
- `control.token` (control route bearer token)

If `server.json` exists but points to a dead/unhealthy process:

1. Check without auto-start:

```bash
PYTHONPATH=src python3 -m localhost_live --runtime-root <RUNTIME_ROOT> --no-start status --json
```

2. Restart normally; `start` replaces stale metadata automatically:

```bash
PYTHONPATH=src python3 -m localhost_live --runtime-root <RUNTIME_ROOT> start --port 0 --json
```

3. If recovery still fails, stop and clean the specific runtime root:

```bash
PYTHONPATH=src python3 -m localhost_live --runtime-root <RUNTIME_ROOT> stop --json
rm -rf <RUNTIME_ROOT>
```

## Security/regression coverage map

The test suite includes dedicated regression tests for release-hardening concerns:

- Host header validation: `tests/test_browser_routes.py`
- Token-protected mutating routes: `tests/test_control.py`
- Traversal and secret-file rejection: `tests/test_importer.py`, `tests/test_browser_routes.py`, `tests/test_save.py`
- Idle shutdown and lifecycle cleanup: `tests/test_idle.py`
- End-to-end flow (start/create/push/routes/save/export/stop): `tests/test_e2e.py`
- CLI JSON contract smoke coverage: `tests/test_cli.py`

## Vendored asset routes

Bundled local asset routes:

- `/assets/vendor/mermaid/...`
- `/assets/vendor/reveal/...`
- `/assets/vendor/echarts/...`
- `/assets/vendor/LICENSES/...`
- `/assets/vendor/examples/...`

## Deferred features

Not in v1 release scope:

- MCP adapter integration
- watch mode / automatic source repush
- LAN/non-loopback sharing modes
- automatic browser self-launch outside `view` (for example on `start`, `session create`, or `push`)
