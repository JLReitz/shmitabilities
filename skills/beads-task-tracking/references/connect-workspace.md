# Connect a workspace to a project database

Run the setup from the Git repository root. Obtain the existing Dolt database name and the project's issue prefix from another configured workspace or the project owner. Apply [repository-visibility.md](repository-visibility.md), then append `--setup-exclude` only when that reference selects it.

```bash
bd init --shared-server --database <existing-database-name> --prefix <issue-prefix> --skip-agents
bd context
bd where
bd dolt show
```

Set `BEADS_SHARED_SERVER_DIR` from the live account-context discovery in `SKILL.md` before running setup. The setup writes workspace-local routing under `.beads/` and connects through that shared server. After setup, put `BEADS_SHARED_SERVER_DIR=${HOME}/.agents/beads` in the workspace's ignored `.beads/.env` for later commands.

Accept the setup only when `bd context` names the owning repository, `bd where` selects its `.beads` directory, and `bd dolt show` reports the existing database in shared-server mode. Do not use `--global` as a project database fallback.
