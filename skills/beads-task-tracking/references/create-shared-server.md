# Create and set up the shared server

1. Run the account and filesystem discovery computation in `SKILL.md`. In the setup shell, set `BEADS_SHARED_SERVER_DIR` to the attested `agent.root` value followed by `/beads`. Verify that `bd` and `dolt` are installed using their package references in knowledge. Obtain approval before installing or changing either package.
2. Inspect the resolved server root. If it contains `dolt/`, follow [restart-shared-server.md](restart-shared-server.md) when the server is stopped. Keep its existing databases and server state. If the root has no `dolt/`, choose the first owning Git repository and follow [create-project-database.md](create-project-database.md). Its `bd init --shared-server` command creates the shared server data directory, starts the server, and creates that project's database.
3. From the configured project root, run `bd dolt status`, `bd dolt show --json`, and `bd sql 'SHOW DATABASES'`. Accept setup when the server is running, `connection_ok` and `shared_server` are true, the selected project database appears, and the resolved server root contains `dolt/`.

Keep server data and state files under the resolved `beads/` root. Add the ignored `.beads/.env` setting described in [create-project-database.md](create-project-database.md) to each project workspace.
