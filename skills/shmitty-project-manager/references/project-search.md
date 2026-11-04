# Search for a project

1. Resolve the managed agent root with the account-context knowledge discovery. Search below it for client registration directories, then identify their workspace roots. Include nested workspaces.
2. Search at and below each relevant workspace root for directories named `.agents/tasks/`, identify project roots as the parent of the `.agents/` directory including when `.agents/tasks/` is empty. Confirm each identified root with `git rev-parse --show-toplevel` from that directory and require the result to equal the identified root.
3. Check for the shared knowledge tree at `{workspace-root}/.agents/knowledge`. Report candidates when a name matches more than one project; do not infer ownership from a directory name alone.
