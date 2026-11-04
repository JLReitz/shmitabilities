# Shmitabilities

This repository packages shmitabilities as skills, harness packages, and a Codex plugin.

## Documentation

Write human-facing documentation as the complete design of its subject. A reader MUST be able to understand the system boundaries, behavior, dependencies, extension points, and operating procedure without reading skill instructions or source code first.

### Organization

Group documentation under `docs/` by development subject or workflow. Each top-level file or directory MUST cover a group of related capabilities rather than one capability in isolation.

Use a standalone file when the group needs one document. Use a directory when the group needs supporting documents; add `index.md` at each level. Keep supporting documents within their group directory.

Maintain `docs/index.md` as the repository documentation entry point. `AGENTS.md` MAY link to `docs/`; documents under `docs/` MUST NOT link to `AGENTS.md`.

### Dependencies

Maintain repository-wide dependency discovery, installation, and manual tooling instructions in `docs/dependencies.md`.

A component or workflow document MUST name the dependencies that affect its behavior. Link to the exact section in `docs/dependencies.md` for installation and verification instead of duplicating those procedures.

Derive dependency names and versions from current manifests, requirement files, lockfiles, packaged artifacts, and runtime checks. Do not copy values from stale documents.

### Design coverage

Document each applicable part of the subject:

- Define its entry points, outputs, filesystem artifacts, and literal terminology.
- Describe each component's responsibility and the boundary between components.
- Explain the complete workflow from entry to terminal result.
- State configuration, compatibility, dependencies, manual setup, and validation.
- Describe persistent state, ownership, and lifecycle when the subject creates or modifies state.
- Describe extension and customization points as explicit contracts.
- State deviations and known limits where they affect use or integration.

Do not add empty sections for concerns that do not apply. Do not duplicate detailed execution procedures that belong in a skill or focused supporting document.

### Integration boundaries

Separate reusable component behavior from environment-selected integrations.

For each external integration, document:

- which component invokes it;
- which configuration or policy selects its implementation;
- the inputs, outputs, identifiers, relationships, and state it must supply;
- which component owns configuration, persistence, lifecycle, and validation.

Reusable skills and documents MUST depend on the integration contract rather than a selected implementation unless that implementation is an intrinsic dependency. Put environment-specific selections in the governing agent or workspace instructions.

### Visual structure

Use an ASCII diagram when the subject contains connected components, nested artifacts, control flow, data flow, or state transitions that prose would require the reader to hold simultaneously.

Put the workflow entry point at the top. Label each edge with the value, event, dependency, or handoff that crosses it. Use the same component names in the diagram and surrounding prose.

### Change consistency

Update the human-facing documentation in the same change as the behavior it describes. Inspect related skills, references, manifests, and existing documents before writing.

When a component, file, term, dependency, or integration changes, update its description, diagrams, incoming links, documentation index entry, and validation instructions together. Preserve unrelated documents and user revisions.
