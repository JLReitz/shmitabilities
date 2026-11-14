# Shmitabilities

This repository packages Shmitty's capabilities as skills and harness plugin packages.

## Contract ownership

Each capability contract has one normative owner.

- Put agent execution requirements in the owning `SKILL.md` or the focused reference that it directly selects.
- Put exported software API contracts on the owning source declaration using the language-native API documentation format.
- State each contract once, at the narrowest artifact that owns it.
- Include preconditions, required order, valid inputs, ownership and lifetime, outputs, state changes, result meanings, errors, and exception behavior.
- Do not introduce contractual requirements in standing documents, READMEs, examples, or tests. These articats MAY explain or validate a contract defined by its owning instruction or source declaration.
- Update the owning instruction or source declaration with every change to contractual behavior.

## Documentation

Write human-facing documentation as the complete design of its subject. A reader MUST be able to understand the system boundaries, behavior, dependencies, extension points, and operating procedure without reading skill instructions or source code first. Skill instructions and source declarations remain authoritative for execution and software API contracts.

### Contract boundary

Standing docymentation describes capabilities at the component and interaction level.

- Show exact declarations, configuration shapes, commands, and state identifiers when they identify an entry point or a value used by the explanation.
- Explain capability responsibilities, dependency boundaries, value flow, ordered interactions, state models, result mappings, client mechanisms, configuration compatibility, and validation.
- Include an internal operation when its role explains externally ovservable behavior.
- Describe the effect of a contractual requirement when needed to explain an interaction. Keep the normative requirement only in its owning instruction or source declaration.
- Omit private fields, line-by-line control flow, and implementation steps that do not explain behavior at a capability boundary.

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
- Explain shared execution and control mechanisms before the features that use them.
- Describe operation sequences through the values, calls, commands, and results that cross capability boundaries.
- Explain accepted responses, deadlines, persistent failures, recovery conditions, and observable guarantees at the capability level.
- State configuration, compatibility, dependencies, manual setup, and validation.
- Describe persistent state, ownership, and lifecycle when they affect capability behavior.
- Describe extension and customization boundaries. Put execution and software API requirements in their owning artifacts.
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

### Change consistency

Update standing documentation in the same change as the behavior it describes. Inspect related skills, references, manifests, and existing documents before writing.

When a component, file, term, dependency, or integration changes, update its description, diagrams, incoming links, documentation index entry, and validation instructions together. Preserve unrelated documents and user revisions.
