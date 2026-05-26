---
name: review
description: Activate when the user needs a polished HTML review artifact that presents the current project state for feedback, status review, or discussion of scope, directives, research, design, and next steps.
version: 1.0.0
author: jlreitz
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [project, review, presentation]
---

# Review

Use this skill to generate an interactive HTML review page for the current project state.

## Core Behavior

1. Gather authoritative inputs from `{project_dir}/directives.md` and relevant artifacts that reflect the current state of the project, such as files in `{project_dir}/research/`, design documents, and implementation planning documents when they exist.
2. Do not consume `{project_dir}/idea-honing.md` or `{project_dir}/refine-log.md` when assembling the review page. Treat those files as historical process artifacts rather than current review inputs.
3. Follow the `presentation-design` skill for review page creation guidance. Reuse its workflow, design posture, and verification bar when building the artifact.
4. Build a single browser-native review page that clearly presents the project's current state. Prefer sections such as project framing, current directives, key research findings, current design or implementation decisions, open questions, and next steps. Adjust the sectioning to fit the actual project artifacts instead of forcing a fixed template.
5. Save the generated HTML to `{project_dir}/presentations/review-<timestamp>.html` and provide the absolute path to the user.
6. Verify the artifact using the review process described in `presentation-design`, including layout stability, readability, interaction completeness, and desktop/mobile-safe behavior before finishing.

## Constraints

- Treat `{project_dir}/directives.md` as the primary source of truth for current project intent.
- Prefer current-state artifacts over historical notes when sources conflict.
- Keep the review page presentation-oriented and readable by a human reviewer who may not have read the source documents.
- Always include a clear next-steps or outstanding-decisions section.
