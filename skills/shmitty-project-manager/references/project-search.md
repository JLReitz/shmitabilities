# Search for a project

1. Resolve the managed agent root with the account-context knowledge discovery. Search below it for client registration directories, then identify their workspace roots. Include nested workspaces.
2. Search at and below each relevant workspace root for Git repositories. Confirm each candidate project root with `git rev-parse --show-toplevel` from that repository. Inspect nested repositories separately; a Git check at the workspace root does not enumerate them. Read applicable workspace and project `AGENTS.md` files before selecting a project.
3. Check for `{project-root}/.agents/knowledge` at each candidate project root. Report candidates when a name matches more than one project; do not infer ownership from a directory name alone.
