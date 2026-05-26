---
name: steps
description: "Activate when the user has clarified project direction and needs a concrete, incremental implementation plan grounded in directives, research, and design."
version: 1.0.0
author: jlreitz
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [project, implementation, plan]
---

# Steps

Use this skill to generate a detailed, actionable implementation plan based on the refined project directives.

## Core Behavior

1. **Context Analysis**:
   - Read `{project_dir}/rough-idea.md`.
   - Read `{project_dir}/directives.md` as the primary source of truth for the implementation plan.
   - Extract the concrete topics, constraints, and workstreams named in `{project_dir}/directives.md`.
   - Read the research documents in `{project_dir}/research/` that correspond to those directive topics before planning. Match by topic name, filename, headings, or clearly related content. If a directive topic has no corresponding research document, continue planning but call out the missing research in the plan.
   - Read the current design documentation after reviewing the directive-aligned research so the plan reflects both the directives and the supporting rationale.
2. **Step Generation**:
   - Break the implementation into a series of discrete, manageable, and incremental steps.
   - Each step must follow the "Test-Driven" pattern: define the objective, the tests to write first, the implementation guidance that follows those tests, and the **Demo** criteria.
   - Sequence each step so the relevant tests are written or updated before implementation development starts for that increment.
3. **Plan Creation**:
   - Create `{project_dir}/implementation/plan.md`.
   - Include a checklist at the top of the file for tracking progress.
   - Format each step as: `Step N: [Objective]`.
4. **Validation**: Ensure steps are sequenced so that core end-to-end functionality is available as early as possible.

## Constraints

- Treat `{project_dir}/directives.md` as the canonical planning input when it conflicts with `rough-idea.md`, design notes, or research artifacts.
- Do not generate a plan from design documents alone; first ground the plan in `rough-idea.md`, `directives.md`, and directive-relevant research.
- Prefer directive-relevant research documents over unrelated files in `{project_dir}/research/`.
- Every step MUST include a "Demo" description of what a successful increment looks like.
- Do NOT create separate test-only phases detached from implementation steps; each implementation step must begin with the tests that define that increment.
- Tests must be written before implementation development starts for the increment they cover.
- Ensure no large jumps in complexity; keep increments small and demoable.
