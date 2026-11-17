---
name: shmitty-version-control
description: Perform project work and record progress commits on the current Git branch.
allowed-tools:
  - Bash(git:*)
---

# Version control

1. Perform the task on the current working branch. Make follow-on commits in this worktree.
2. Read tracked `.agents` material from the current project worktree. Use `shmitty-project-manager` to resolve the workspace root, then read task documents from `{workspace-root}/.agents/tasks/` and shared knowledge from `{workspace-root}/.agents/knowledge`.
3. Commit progress with this message structure. Write a concise first line that summarizes the committed outcome. Write the overview as prose that states the required behavior or gap. Write the solution as one to three short bullets that state the resulting behavior and only the mechanisms needed to explain it.

```text
Task title

**Overview:**
At most two sentences of prose, never bullets.

**Solution:**
- One sentence per entry for a detail the diff does not make obvious.
```
