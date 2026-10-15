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
- **Constraints inline** No separate "GUARDRAILS"/"CONSTRAINTS" block. Each constraint is stated within the step that binds it.
- **Invoke scripts exactly as `allowed-tools` names them.** A `Bash(cmd:*)` entry is a trailing wildcard (`cmd` plus any args), matched TOKEN-LITERAL on the leading command token: `Bash(scripts/foo.sh:*)` matches bare `scripts/foo.sh ...` but NOT `./scripts/foo.sh ...` nor `bash scripts/foo.sh ...` (different leading token; `bash` is not a stripped wrapper). Invoke project scripts exactly as the pattern names them — a `./`- or `bash `-prefixed form silently fails the permission match. Shell operators (`&&`, `||`, `;`, `|`) are parsed and each subcommand must independently match an allowed pattern.

When authoring a skill that writes a body/comment/description/field/message/command for an external system, follow the [external artifact content rules](references/external-artifact-content.md).

## SKILL architecture

Agents load skills progressively, pulling in more detail only as a task calls for it. Skills should be structured to take advantage of this.

Keep your main SKILL.md short. Move detailed reference material to separate files. Use relatibe paths from the skill directory root in SKILL.md to reference bundled files:
```
See [the reference guide](references/reference.md)

Use **`scripts/validate.sh`** on configuration files

Compare the loaded image to `assets/reference.png`
```

### `SKILL.md`

**YAML frontmatter (~100 tokens):**

Always:
- `name`: matches parent directory name
- `description`: what the skill does and when to use it, imperative phrasing

Conditional:
- `allowed-tools`: Permissions for required bash commands and MCP tools
- `compatibility`: All required system packages configurations, network access, etc.

**Body (<5000 tokens recommended):**

Introduction if needed. Set the scene, do not repeat the description.

`## Vocabulary` to list skill-defined terms

`## Execution` if a procedure Numbered list of steps 0..N

`## Topical Sections` otherwise

`## Appendix` When common details or constraints are re-used throughout a procedure, place in sections here

### `references/`

Contains additional documentation to reveal conditional context or instructions. Keep individual reference files focused, agents load these on demand.

Name files for the domain that they represent. Link to them inline where they have the most impact.

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
