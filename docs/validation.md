# Validation

Run checks for the component changed. Run commands from the repository root unless a section names
another directory. Tests that create files must use a temporary directory.

## Manifests and documentation

Read each affected manifest and skill file. Check that Pi resource paths, packaged agent files,
bootstrap agent names, plugin prompts, published files, and direct dependency groups match their
actual targets. Check that local Markdown links resolve and that pages under `docs/` do not link to
`AGENTS.md`. Run `git diff --check` on the change.

## Root tests

Run `npm run` to inspect the current root script names and commands. Run the relevant test or
coverage script for the changed component. If the manifest does not define a needed check, run the
tool directly only after checking that its configuration applies to the changed files.

## Harness packages

Run the changed package's targeted test file before its full suite. For
`extensions/pi-files-and-shmit`, install its development dependencies and run `npx tsc --noEmit`
from that package directory. Run its test script after inspecting `npm run`. An install builds the
native module and needs `cargo` on `PATH`. Validate shared behavior through the package core and
each implemented client interface. A root manifest check cannot prove runtime behavior. Use the Pi
client reference in `based-harness-dev` for terminal render tests. Add a DSH integration check when
the package exposes a DSH plugin.

## Codex bootstrap

```bash
python3 -m py_compile scripts/codex-bootstrap.py
python3 scripts/codex-bootstrap.py --help
python3 scripts/codex-bootstrap.py --dry-run
```

The dry run prints planned actions. Check the printed agent roster and marketplace target against
[Codex Plugins](codex-plugins.md). The script requires the Codex CLI on `PATH` even during a full
dry run unless `--skip-plugin` is set.
