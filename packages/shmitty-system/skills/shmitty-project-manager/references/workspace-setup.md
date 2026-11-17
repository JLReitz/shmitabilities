# Set up a workspace

1. Search `${HOME}/.agents/workspaces/` and use an existing workspace when its resolved target contains the intended location or projects.
2. Select the workspace name and root. Resolve the root and `${HOME}` to their physical paths and reject the root when they are equal. Create the root before creating any project in it.
3. Create `{workspace-root}/.agents/`, `{workspace-root}/.agents/tasks/`, and its human-facing `index.md`. Use `shmitty-knowledge` to create or use `{workspace-root}/.agents/knowledge`.
5. Create `${HOME}/.agents/workspaces/<workspace-name>` as a symbolic link whose stored target is the absolute workspace root. Stop when that path exists and resolves to another target; ask the user for the intended name or target. Verify that the link resolves to the workspace root.
