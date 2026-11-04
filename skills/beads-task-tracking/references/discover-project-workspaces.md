# Locate project workspaces

The shared server lists databases. Workspace paths come from each workspace's `.beads/metadata.json`; a database name alone does not locate a checkout.

1. From a configured workspace, run `bd sql 'SHOW DATABASES'` to list server databases. Exclude SQL system databases and the Beads global database, then confirm which remaining names are project databases.
2. Search the relevant project roots for `.beads/metadata.json`. Read each file's `dolt_database` and `project_id`, then group candidate workspace paths by database name. Keep unmatched databases and unmatched workspaces visible.
3. From each candidate repository root, run `bd context --json` and `bd dolt show --json`. Accept a mapping when the repository root, database name, project ID, shared mode, and server connection agree. Run `bd context` from the repository directory because this installed version can fail through `bd -C`.

`bd repo list` reads a workspace's multi-repository sync configuration. Its `primary` and `additional` paths are not a shared-server workspace registry. `repo_mtimes` and `routes` can contain paths for specific features, but do not establish a complete inventory of server clients.
