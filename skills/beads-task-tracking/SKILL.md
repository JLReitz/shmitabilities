---
name: beads-task-tracking
description: Use beads with the centralized shared Dolt server for durable issue tracking, work modeling, shared server setup, project database setup, workspace connection, and workspace discovery on this host. Use when work needs coordination across steps, agents, or sessions, or when a beads server or workspace must be created, connected, or located.
---

# Beads task tracking

Use beads from the root of the project that owns the work. Use the centralized shared Dolt server on this host.

## Locate the shared server

1. Search knowledge for References tagged `host-context` and `account`. Read the account and filesystem discovery computation, then run and attest it to resolve the managed agent root for this session.
2. Set `BEADS_SHARED_SERVER_DIR` to `<resolved-agent-root>/beads` for setup. If that directory has no `dolt/`, follow [references/create-shared-server.md](references/create-shared-server.md). For an existing workspace, put `BEADS_SHARED_SERVER_DIR=${HOME}/.agents/beads` in its ignored `.beads/.env` so Beads selects the server on each invocation.
3. Run `bd dolt status` from a configured project to check the server endpoint and database. If the server is unreachable, follow [references/restart-shared-server.md](references/restart-shared-server.md). Keep the resolved root and server status in session evidence.

## Select the project

1. Change to the owning repository root, then run `bd context`, `bd where`, and `bd dolt show` before the first read or write. Run `bd context` from that directory; the installed command can fail when invoked with `-C` from another directory.
2. Stop if the commands select the wrong repository, workspace, server, or database. Change to the owning root and check again.
3. Keep each issue in the project that owns the deliverable. Use `bd create --repo <project> ...` only for an intentional cross-project write, and record the reason in the issue description or notes.

Use `--global` only to access the host-wide `beads_global` database intentionally.

For workspace setup, read the applicable reference:

- New project database: [references/create-project-database.md](references/create-project-database.md)
- Existing project database: [references/connect-workspace.md](references/connect-workspace.md)
- Locate workspaces using this server: [references/discover-project-workspaces.md](references/discover-project-workspaces.md)

Apply [references/repository-visibility.md](references/repository-visibility.md) before initializing or changing a beads workspace.

For a journeyman journey affected by stale JSONL imports, apply [references/journey-import.md](references/journey-import.md).

## Track the work

Use [Model the work](references/model-the-work.md) to create issues and dependencies. Use [Execute the work](references/execute-the-work.md) to claim, update, and close issues.

## Store task documents

Store large or frequently revised documents in `{project-root}/.agents/tasks/<epic-or-feature-title>/`, using the owning epic or feature title rather than its ID. Put `index.md` in each topic directory and link its documents there. Link a document from the description of any issue type that needs it. Keep the description focused on the issue outcome and document links.

Write task documents for human readers. Treat documents that skills produce, maintain, and read as long-standing task context as infrastructure material. Infrastructure material may contain Beads IDs to identify exact issues and links to relevant issues, sources, and documents inside or outside `.agents/tasks/`. Use the topic title to name the owning issue; use recorded IDs to locate related issues, and inspect current relationships in the database.
