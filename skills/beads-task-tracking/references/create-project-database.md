# Create a project database

Run the setup from the owning Git repository root. Choose a stable Dolt database name and a short issue prefix for that project. Apply [repository-visibility.md](repository-visibility.md), then append `--setup-exclude` only when that reference selects it.

```bash
bd init --shared-server --database <database-name> --prefix <issue-prefix> --skip-agents
bd context
bd where
bd dolt show
```

Set `BEADS_SHARED_SERVER_DIR` from the live account-context discovery in `SKILL.md` before running setup. `--shared-server` uses that directory. After setup, put `BEADS_SHARED_SERVER_DIR=${HOME}/.agents/beads` in the workspace's ignored `.beads/.env` for later commands. Do not start a project-private Dolt server.

Accept the setup only when `bd context` names the owning repository, `bd where` selects its `.beads` directory, and `bd dolt show` reports the intended database in shared-server mode.
