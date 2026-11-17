# Perform planned work

1. Read the local task tracker through the workspace or project instructions. Resolve the local task ID, title, parent task, and repository selected for the work.
2. Derive the task name from the kebab-case form of the local task title: lowercase, each run of characters other than `a-z` and `0-9` replaced by one hyphen, no hyphen at either end. Name the working branch with the task name. Branch a child task from its parent task branch. Otherwise, branch from the repository HEAD selected for the task.
3. Create the worktree under `{workspace-root}/worktrees/<task-name>/` so its directory name matches the branch name. When the project root and workspace root are identical, add `/worktrees/` to `.git/info/exclude` before creating the worktree. Enter the worktree before changing task files.
4. Use `shmitty-version-control` to perform the task and commit progress on the working branch.
5. When the task is complete, rebase the working branch onto the repository HEAD and consolidate its task commits into one commit with the `shmitty-version-control` message structure. Inspect the final diff and commit before reporting completion.
