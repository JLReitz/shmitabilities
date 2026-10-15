# Documentation

Shmitabilities distributes skills, harness packages, and a Codex plugin. Package behavior can be
shared by Pi and DeepSeek Harness (DSH) through separate client interfaces.

## Topics

- [Dependencies](dependencies.md) lists direct package dependencies and manual install steps.
- [Packages](packages.md) defines package ownership, the target layout, and client interfaces.
- [Pi Package](pi-package.md) describes Pi resource registration and the nested extension install.
- [Codex Plugins](codex-plugins.md) describes the plugin manifest and packaged agents.
- [Codex Bootstrap](codex-bootstrap.md) describes local installation and the bootstrap design.
- [Validation](validation.md) gives checks for each changed component.
- [Task Tracking](task-tracking.md) gives the project Beads configuration and epic entry point.
- [Shmitty Knowledge](skills/shmitty-knowledge.md) describes the knowledge format and its local validation.

The `skills/` directory contains skill instructions. Current harness packages are under
`extensions/`; `packages/` is their target location. Read the live manifests for active client
registrations.
