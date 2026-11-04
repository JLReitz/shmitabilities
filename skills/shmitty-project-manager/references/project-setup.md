# Set up a project

1. Select or create the agent workspace that will contain the project. Confirm its client registration directory and read its `AGENTS.md`. Use the project search procedure before creating a workspace for an existing project.
2. Select a project root at or below the workspace root. Put its source under Git tracking there. Initialize a local repository if needed, add the intended source files, and verify them with `git ls-files` from the project root. A remote is optional. Preserve existing repository history and unrelated working-tree changes.
3. Create or use the workspace's shared knowledge tree at `{workspace-root}/.agents/knowledge` with the `shmitty-knowledge` skill.
4. Create `.agents/tasks/` and its human-facing `index.md` at the project root. Add a topic directory with its own `index.md` when the first long-horizon task document is needed. Add `/.agents/` to `.gitignore` at the project root and verify it with `git check-ignore -v .agents/tasks/` from there. When the project root equals the workspace root, also verify `.agents/knowledge/`.

## Track requested agent files

In a repository that contains `.agents/`, keep `/.agents/` in its `.gitignore`. Add only requested files with `git add -f -- <path>`, such as `git add -f -- .agents/hooks/setup.sh`. Confirm the staged paths with `git diff --cached --name-only`.

To stop tracking a requested file while retaining it locally, run `git rm --cached -- <path>`. The `/.agents/` rule then ignores it again; verify with `git check-ignore -v -- <path>`.

Read the workspace `AGENTS.md` for additional project requirements before declaring setup complete.
