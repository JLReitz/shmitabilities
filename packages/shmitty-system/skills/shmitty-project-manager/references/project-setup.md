# Set up a project

1. Select an existing workspace with [project search](project-search.md). Complete [workspace setup](workspace-setup.md) before project setup.
2. Select a project root at or below the workspace root. Preserve existing repository history and unrelated working-tree changes.
3. From the selected root, require `git rev-parse --show-toplevel` to return that root. Initialize a Git repository there when it is not already a repository, then check the root again.
4. Record the project as ready when the selected root is the Git repository root.
