# Codex Bootstrap

`scripts/codex-bootstrap.py` installs the repository's custom agent definitions and local Codex
plugin into a selected Codex home. It reads `agents/*.toml` and `.codex-plugin/plugin.json` at run
time, so the installed roster and plugin identity follow the checked-out files.

## Installation

Run the dry run from the repository root, review its target paths, then run the same command without
`--dry-run` when those targets are correct. The full plugin path requires the Codex CLI on `PATH`.

```bash
python3 scripts/codex-bootstrap.py --dry-run
python3 scripts/codex-bootstrap.py
```

Use `--codex-home` to select a different Codex home. Use `--config-file` and `--agents-dir` for a
specific global or profile config and its agent directory. `--copy` copies source files and the
checkout in place of symlinks. `--force` replaces conflicting installed paths. `--skip-plugin`
limits the run to agents; `--skip-agents` limits it to the plugin. Inspect all flags with
`python3 scripts/codex-bootstrap.py --help`.

## Mechanism

The script reads each packaged agent's `name` and `description`. It installs each agent file next to
the selected config and as a profile in the selected Codex home. A marked block in the config
registers the agents with relative config paths. An existing agent section outside that block
remains in place, and the script omits its duplicate registration. The script removes known older
packaged agent files and profiles when they are no longer in the repository roster.

The plugin stage is a local copy or symlink under the selected Codex home. The script uses a
marketplace under the user's home when the staged plugin is there; otherwise it uses the selected
Codex home. It updates the matching plugin entry in that marketplace file and preserves other
entries. The Codex CLI registers the marketplace root and installs the plugin if it is not already
installed. A registration collision at another root stops the script with an error.

The installation path is:

```text
agents/*.toml ──read──> agent files + profiles ──register──> selected config
plugin.json  ──read──> staged checkout ──list in──> marketplace.json
marketplace.json ──register through Codex CLI──> installed plugin
```

`--dry-run` prints proposed writes and Codex commands without applying them. An existing
conflicting file or symlink requires `--force`; inspect the target before using it. Keep the source
agent roster and manifest in sync with [Codex Plugins](codex-plugins.md).
