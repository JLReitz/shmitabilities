---
name: brainstorm
description: "Activate when the user has a rough project idea and needs help shaping it into clear high-level scope, goals, and requirements."
version: 1.0.0
author: jlreitz
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [project, idea, requirements]
---

# Brainstorm

Use this skill to initiate a new project by defining a rough idea and establishing high-level requirements.

## Core Behavior

1. **Parameter Acquisition**: Ask for `rough_idea`, `project_name` (optional), and `project_dir` (optional, defaults to `.agents/projects/`).
2. **Structure Initialization**:
   - If `project_dir` is not provided, use `.agents/projects/`.
   - Create the specified `project_dir` if it doesn't exist.
   - Create `{project_dir}/rough-idea.md` containing the initial concept.
   - Create `{project_dir}/idea-honing.md` for high-level requirements.
3. **Requirements Clarification**:
   - Guide the user through a series of high-level questions to define the project scope.
   - Append questions and answers to `{project_dir}/idea-honing.md`.
   - Ask only one question at a time.
4. **Completion**: Once the scope is clear, notify the user and suggest moving to the `deep-dive` skill for specific research.

## Constraints

- Do NOT overwrite an existing directory if it contains project files.
- Always use absolute paths for directory creation.
- Ensure the user confirms the project structure before proceeding to requirements.
