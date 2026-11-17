# Search for a project

1. Inspect each symbolic link under `${HOME}/.agents/workspaces/` and treat its resolved target as a workspace root. Reject a link whose target resolves to `${HOME}`. Require the target to contain `.agents/tasks/`.
2. Select the workspace whose resolved root contains the current location or the requested project. Report candidates when a name or location matches more than one workspace.
3. Locate Git repositories at or below that workspace root, excluding `{workspace-root}/worktrees/`. From each candidate project root, require `git rev-parse --show-toplevel` to return the candidate root. Include the workspace root when it is a Git repository.
4. Match a project by its verified repository root. Do not infer project ownership from a directory name, task document, external tracker item, or local tracker item.
