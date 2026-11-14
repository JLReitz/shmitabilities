---
name: based-skill-author
description: Skill writing conventions. Use when creating or modifying skills.
---

# Skill conventions

Use the `based-document-author` skill in addition to the following rules:

- **Short and instructional.** Prefer consolidation and clarity over document length.
- **Cut the purpose clause.** State the instructions and stop. Cut trailing clauses that name an instruction's purpose when they declare it for themselves.
- **Write for the reading agent.** Instructions address the executing agent directly, in the imperative, from its own perspective.
- **Own scope only.** A skill states only what happens within its own operation. Do not describe another's procedures — even to contrast against it.
- **Sparse cross-references.** Skill reads standalone. Cross-refs to other skills must be by name only.
- **No frontmatter-configuration prose in the body.** The body does not restate or explain frontmatter fields. Argument expansion in step text is fine.
- **Plain-English rule names.** Name rules by what they do ("the source-required gate"), never by an opaque code (`B-1`, `MJ2`) that forces the reader to hold a private namespace.
- **Bounded rationale.** Rationale is at most a short forward-looking note at the rule it explains.
- **Clean schema blocks.** Inline JSON/bash carries data shape only. Behavioral commentary (gate semantics, cross-step refs) lives in step prose, not inside field doc-strings.
- **Inline constraints** No separate "GUARDRAILS"/"CONSTRAINTS" block. Each constraint is stated within the step that binds it.

When authoring a skill that writes a body/comment/description/field/message/command for an external system, follow the [external artifact content rules](references/external-artifact-content.md).

## SKILL architecture

Agents load skills progressively, pulling in more detail only as a task calls for it. Skills should be structured to take advantage of this.

Define the skill boundary and select the structure that matches the work:

- [Router](references/router.md) to select one procedure from task-specific criteria.
- [Extension](references/extension.md) to add context and policies to a required skill.
- [Orchestrator](references/orchestrator.md) to coordinate ordered stages and retained state.

A package MAY combine structures when all content serves one operation boundary. State only procedures within that boundary.

### `SKILL.md`

**YAML frontmatter (~100 tokens):**

- `name`: matches parent directory name.
- `description`: what the skill does and when it applies. Use an imperative verb.
- `allowed-tools`: List only CLI commands and MCP tools called directly by the skill.
- `compatibility`: Name required skills, services, packages, configuration, and network access.

Follow [Tool permissions](references/tool-permissions.md) when the skill allows commands or MCP tools.

**Body (<5000 tokens recommended):**

Instructions loaded for every invocation of the skill:
- Universal behavior and invariants.
- Provider, operation, or workflow routing.
- Ordered stages and retained fields.
- Conditional references.

Name sections after their content.

Use `## Vocabulary` when the skill reuses standardized terms. Each entry MUST define one noun or verb. Use that term with its defined meaning throughout the skill.

Number procedural steps, use step 0 only for setup that precedes the operation.

Keep `SKILL.md` short. Move detailed reference material to separate files. Use relative paths from the skill directory root in `SKILL.md` to reference a bundled file at the decision or handoff that requires it:
```
See [the reference guide](references/reference.md)

Use **`scripts/validate.sh`** on configuration files

Compare the loaded image to `assets/reference.png`
```

Reference a required skill by its exact name at the point it applies. Tell the agent when to load it, do not restate its procedure.
```
Use the `<skill-name>` skill to ...
```

### `references/`

Keep individual reference files focused, agents load these on demand. Give each reference one named unit of work. Name the file after its operation, stage, format, or domain.

Start with the operative instruction. Add only the context needed for that unit.

For a state workflow, specify:
- The event that permits each transition.
- The source and expected state.
- Runtime transition discovery when identifiers can change.
- The evidence required before reporting success.
- Failure reports.

Keep templates and schema blocks limited to artifact shape. Put behavioral rules in the surrounding prose.

Separate a report template when multiple steps use it or when it is loaded only for one result type.

### `scripts/`

Use the `based-harness-dev` skill to develop scripts.

List all dependencies of bundled scripts with the `compatibility` frontmatter field.

```yaml
compatibility: Requires Python 3.14+ and pipx
```

### `assets/`

Contains static resources:
- Template files
- Images
- Data files
