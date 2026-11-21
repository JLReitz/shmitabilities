# Set up task tracking

1. Select the Python 3.9 or later environment that runs `task-cli`. Install its required package in that environment:

   ```bash
   python3 -m pip install PyYAML==6.0.3
   ```

2. Put `task-cli` on `PATH`, then run `task-cli --help` and confirm that the command resolves.
3. Register the workspace through `shmitty-project-manager`.
4. Create `{workspace-root}/.agents/tasks/` as a physical directory when it does not exist. Do not create an `index.md` at the task root.
5. Run `task-cli ready` from the registered workspace and fix each reported setup or graph diagnostic.
