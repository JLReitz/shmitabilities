# Run from source

1. Resolve the account home through the sanctioned account-context discovery. Use `gh` to inspect the requested repository and identify its default branch or requested revision. Check that `${HOME}/<repository-name>` is free; preserve an existing checkout.
2. Clone the source repository with `gh repo clone <owner>/<repository> "${HOME}/<repository-name>"`. Confirm the remote, checked-out revision, and applicable `AGENTS.md` instructions.
3. Read the repository's build documentation, package-manager declaration, and lockfile. Use its supported toolchain to install dependencies and build from the checkout. Keep generated artifacts in the checkout unless the user requests another installation scope.
4. Run the repository's supported source launcher or a suitable built-artifact check. Record the source path, installation method, update and uninstall commands, and an attested version command in the Package reference. For updates, fetch or fast-forward the selected revision, reinstall locked dependencies as needed, and rebuild.

Request approval before a global installation or system-wide change. Apply the selective-manager approval rule when the source project requires pipx, pnpm, or Docker.
