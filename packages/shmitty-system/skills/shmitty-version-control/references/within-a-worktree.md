# Within a worktree

1. Perform the task on the current branch. Make follow-on commits in this worktree.
2. Read tracked `.agents` material from the worktree root. Read untracked task documents from `../..` relative to the worktree root, at the project's `.agents/tasks/` directory. Resolve the workspace root with `shmitty-project-manager`, then read shared knowledge from `{workspace-root}/.agents/knowledge`.
3. Commit progress with this message structure: Write a concise first line that summarizes the outcome of the changes committed; the overview as prose, stating the required behavior or gap; the solution as one to three short bullets, one sentence each, stating the resulting behavior and only the mechanisms needed to explain it.

```text
Task title

**Overview:**
At most two sentences of prose, never bullets.

**Solution:**
- One sentence per entry for a detail the diff does not make obvious.
```
4. When the task is complete, rebase the working branch onto the repository HEAD and consolidate its task commits into a single commit with the same message structure. Inspect the final diff and commit before reporting completion.
