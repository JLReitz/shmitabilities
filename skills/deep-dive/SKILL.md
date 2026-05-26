---
name: deep-dive
description: "Activate when the user needs focused project research, source-backed exploration, or deeper investigation into a specific topic before making decisions."
version: 1.0.1
author: jlreitz
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [project, research, exploration]
---

# Deep-dive

Use this skill to perform intensive research on specific topics related to your project.

## Core Behavior

1. **Topic Selection**: Ask the user for a specific research topic or suggest one based on the existing `idea-honing.md` and `rough-idea.md`.
2. **Research Location**:
   - Inspect `{project_dir}/research/` before creating folders.
   - When the work is a follow-up to an existing topic, use the existing matching subdirectory and add new learnings there.
   - Create `{project_dir}/research/{topic_name}/` only when no existing subdirectory reasonably matches the topic.
3. **Research Execution**:
   - Use available tools (web search, file reading, code searching) to investigate the topic.
   - Document findings in markdown files within the selected topic subdirectory.
   - Choose filenames based on the specific focus of the learning, not a generic label. For example, use `embedding-model-tradeoffs.md`, `auth-provider-risks.md`, or `mobile-offline-sync.md` instead of `notes.md`, `research.md`, or `follow-up.md`.
   - If a file for the same focus already exists, update it or append the follow-up findings instead of creating a duplicate.
   - Include mermaid diagrams for any architectural or data flow insights.
   - Cite all sources and include links to documentation/articles.
4. **Summary**: Provide a summary of findings and suggest moving to `refine` to integrate these insights.

## Constraints

- Research must be organized by topic.
- Existing research topic subdirectories should be treated as the default destination for follow-up learning when they match the user's topic.
- Research filenames must communicate the specific focus of the investigation.
- Always ask the user if the research direction is correct before starting.
- Periodically check in with the user to share preliminary findings.
