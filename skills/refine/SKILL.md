---
name: refine
description: Activate when the user has rough requirements, notes, or research and needs them resolved into concrete project directives covering defaults, edge cases, constraints, behaviors, and terminology.
version: 1.0.0
author: jlreitz
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [project, direction, clarification]
---

# Refine

Use this skill to consolidate low-level clarifications into a clean directive set for the project.

## Core Behavior

1. **Gather authoritative inputs**: Read `{project_dir}/rough-idea.md`, `{project_dir}/idea-honing.md`, and relevant files in `{project_dir}/research/`. Read `{project_dir}/directives.md` if it already exists. Do not treat `{project_dir}/refine-log.md` as authoritative input.
2. **Create the initial directive set on first activation**: If `{project_dir}/directives.md` does not exist, create it immediately and populate it with an initial consolidated directive set synthesized from the rough idea, idea honing, and research artifacts. Convert source material into explicit current directives rather than copying notes verbatim.
3. **Run clarification dialogue**: Ask targeted follow-up questions that resolve low-level ambiguity such as terminology, field meanings, defaults, edge cases, validation rules, operational constraints, user flows, failure handling, naming, and acceptance criteria. Ask one question at a time when the answer materially affects the directives.
4. **Stay out of high-level design unless forced**: Avoid turning the session into architecture selection or broad technical strategy. If a clarification request actually changes the project's technical direction, surface that explicitly and ask the user whether to revisit earlier planning or research rather than silently baking it into the directives.
5. **Maintain the canonical directive file**: Keep a single current source of truth in `{project_dir}/directives.md`. Resolve conflicts between prior directives, research notes, and user answers by updating the document so it reflects only the latest accepted guidance.
6. **Append the decision log**: After each pass, append a dated entry to `{project_dir}/refine-log.md` summarizing questions asked, answers received, and directives changed. Keep this log append-only and historical.
7. **Close the loop**: When the directives are internally consistent and sufficiently specific for downstream work, suggest moving to `review` or `steps`.

## Constraints

- Treat `{project_dir}/directives.md` as the consumable artifact for downstream skills.
- Treat `{project_dir}/refine-log.md` as archival history only; never use it as the source of truth when resolving current directives.
- On first activation, never leave `{project_dir}/directives.md` absent or empty after reading the project artifacts.
- Present conflict resolutions to the user before overwriting existing directives.
- Remove or rewrite stale directives instead of leaving contradictory text in `{project_dir}/directives.md`.
- Keep `{project_dir}/directives.md` standalone, concise, and implementation-adjacent. Prefer explicit directives over narrative recap.
