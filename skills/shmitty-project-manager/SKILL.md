---
name: shmitty-project-manager
description: Locate and set up projects within registered agent workspaces, including Git source tracking and isolated project knowledge.
---

# Project management

A workspace root contains client registration directories. A project root is the root of a Git repository at or below its workspace root. One workspace may contain multiple projects, and a project may start at the workspace root. Project source is tracked by Git; local repositories without a remote are valid.

Read [project search](references/project-search.md) when locating a project or identifying its workspace. Read [project setup](references/project-setup.md) when creating a project or bringing an existing source tree into a workspace.

Use `shmitty-version-control` for task branches, worktrees, and commits after locating the project root.

## Place project knowledge

Use the `shmitty-knowledge` skill to access and maintain project knowledge in an isolated tree at `{project-root}/.agents/knowledge`.

- Put knowledge that applies across projects in the root knowledge tree. Generalize reusable methods, constraints, and decisions before recording them there.
- Put knowledge whose meaning depends on one project's goals, design, domain, or decisions in that project's isolated tree. Group related concepts in a bundle named for the project.
- When a project finding supports a reusable concept, record the general concept in the root tree and keep the project-specific context in the project tree. Give each concept supporting references in its own tree.

## Place project task documents

Store long-lived or frequently revised project documents under `{project-root}/.agents/tasks/`. Give each long-horizon task, idea, epic, or feature a topic directory named from its human-facing title. Use a readable filesystem-safe title: preserve the words, replace path separators and unsupported filename characters with spaces, and use a distinct descriptive title when names collide. Do not use tracker IDs as directory names.

Create `.agents/tasks/index.md` as the human-facing topic index. Give each topic an `index.md` that links its documents and summarizes their purpose. Name documents for their content, such as `idea.md` or `design.md`; write their content for human readers.

Treat a document as infrastructure material when skills produce, maintain, and read it as long-standing task context, such as `idea.md`. Infrastructure material may contain task IDs and links to relevant tickets, sources, and documents inside or outside `.agents/tasks/`. Use descriptive titles in prose and topic directory names; use IDs when they identify an exact task or relationship.
