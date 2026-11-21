---
name: shmitty-system-manager
description: Resolve live host context, manage packages and source builds, and maintain package references.
compatibility: Requires shmitty-knowledge, host shell access, package-manager access, and network access for package retrieval.
---

# System management

## Vocabulary

- **Managed agent root**: The user's home directory, expressed as `${HOME}` in durable instructions and paths.

## Resolve host context

Record repeatable system inspections as sanctioned executions when their results support durable knowledge, policy, or recurring work.

- Use an existing sanctioned execution when it can derive the required information.
- Create or revise sanctioned executions before running ad hoc substitutes.

Treat platform identity, platform release, execution layers, account identity, home directory, current directory, mount locations, regional settings, and integration-host details as live system state.

- AGENTS.md, skills, and the knowledge tree MUST NOT store observed host-context values.
- Search knowledge with these specifications:
  - type: `reference`
  - tag: `host-context`
  - tag: `<context>`
- Before using platform or integration-host details, search with `<context>` set to `platform`.
- Before using account names or filesystem locations, search with `<context>` set to `account`.
- Before using timezone, locale, or configured region details, search with `<context>` set to `regional`.
- Durable references MUST express user-scoped paths with `${HOME}`, project paths relative to a discovered root, and host paths through sanctioned command arguments or receipt templates.
- Keep host-context receipts and derived values ephemeral. Ask for location when the required meaning is not available from the sanctioned regional context.

Resolve `${HOME}` through the account-context knowledge search before using its physical path.

## Manage packages

Use the `shmitty-knowledge` skill to maintain installed package managers, managed packages, and source builds in the packages reference bundle. Use sanctioned executions for repeatable system inspections and package lifecycle commands. Resolve live account and filesystem paths through the account-context knowledge search before using them.

Request approval before a global installation or system-wide change. Use the user's existing authorization when it covers the action.

### Select an installation route

Prefer an applicable system package, then the language-specific route. Read only the references needed for the package:

1. [System tools](references/system-tools.md) for apt, dpkg, or snap.
2. [Python](references/python.md), [npm](references/npm.md), or [Cargo and rustup](references/cargo-rustup.md) for packages in those ecosystems.
3. [pipx, pnpm, and Docker](references/selective-managers.md) when their use is needed and approved.

For a local repository build, read [Run from source](references/run-from-source.md). Use the language-specific reference for its build dependencies. Respect a project's declared package manager and lockfile.

### Maintain package references

- Tag each installed package `installed`, each package manager `manager`, each toolchain `toolchain`, and each virtual environment manager `virtual-system`.
- Tag a package installed after provisioning with its managing tool. Tag a package pre-installed in the host image `system` instead. Tag a package built from source `built`.
- Record the installation method and, for a local build, the source repository path. Link the responsible package manager's sanctioned existence, maintenance, installation, and uninstallation commands.
- Give each installed-package reference non-empty attested commands for existence, maintenance, installation, and uninstallation. Link a sanctioned version command; derive and attest the version when needed. Omit observed installed-version values from the Package reference.
- After a sanctioned uninstall and absence attestation, retain the Package reference, source references, and lifecycle executions. Remove `installed` and obsolete installation-state tags. Mark only attested absent paths and settings `Not present` in `Host state`. Preserve reusable behavior and installation instructions.
