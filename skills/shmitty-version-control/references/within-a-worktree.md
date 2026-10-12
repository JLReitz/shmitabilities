# Within a worktree

1. Perform the task on the current branch. Make follow-on commits in this worktree.
2. Read tracked `.agents` material from the worktree root. Read untracked knowledge and task documents from `../..` relative to the worktree root, at the project's `.agents/` directory.
3. Commit progress with this message structure. For work without a tracked task, replace the first line with a descriptive title and omit the ID and brackets. Keep the Overview to at most two prose sentences without bullets. Make each Solution entry one sentence and include only details that the diff does not make obvious. State the product change and test coverage in Results.

```text
[ticket-123] task title

**Overview:**
At most two sentences of prose, never bullets.

**Solution:**
- One sentence per entry for a detail the diff does not make obvious.

**Results:**
Product: State the product change.
Tests: State the test coverage and result.
```

4. When the task is complete, rebase the working branch onto the repository HEAD and consolidate its task commits into a single commit with the same message structure. Inspect the final diff and commit before reporting completion.
