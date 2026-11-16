---
name: shmitty-project-manager
description: Locate and set up projects within registered agent workspaces, including Git source tracking, shared workspace knowledge, and task-document organization.
---

# Project management

A workspace root contains client registration directories. A project root is the root of a Git repository at or below its workspace root. One workspace may contain multiple projects or a single project may start at the workspace root. Project source is tracked by Git; local repositories without a remote are valid.

Read [project search](references/project-search.md) when locating a project or identifying its workspace. Read [project setup](references/project-setup.md) when creating a project or bringing an existing source tree into a workspace.

Use `shmitty-version-control` for task branches, worktrees, and commits after locating the project root.

## Place workspace knowledge

Use the `shmitty-knowledge` skill to access and maintain one shared tree at `{workspace-root}/.agents/knowledge` for every project in the workspace.

- Generalize reusable methods, constraints, and decisions into subject bundles that any project can use.
- Group knowledge whose meaning depends on one project's goals, design, domain, or decisions in a bundle named for that project.
- Link project-specific concepts to reusable concepts and shared references within the tree.

## Place project task documents

Store long-lived or frequently revised project documents under `{project-root}/.agents/tasks/`. Give each tracked item that owns documents a topic directory. Name it with the kebab-case form of its title: lowercase, each run of characters other than `a-z` and `0-9` replaced by one hyphen, no hyphen at either end. When the item mirrors an external ticket, prefix the lowercase external ID and a hyphen. Do not use internal tracker IDs. Create a directory for an ancestor item only when it groups two or more topics, and nest those topics in it; keep every other topic at the top level.

Create `.agents/tasks/index.md` as the human-facing topic index and list only top-level topics. Give each topic an `index.md` that links its documents and child topics and summarizes their purpose. Name documents for their content, such as `idea.md` or `design.md`, and write their content for human readers.

Move affected topic directories and fix incoming links when a tracked item's title or parent changes, or when a new topic gives its ancestor a second child.

Link a document from the description of any tracked item that needs it. Keep that description focused on the tracked outcome and document links.

Treat a document as infrastructure material when skills produce, maintain, and read it as long-standing task context, such as `idea.md`. Infrastructure material may contain task IDs and links to relevant tickets, sources, and documents inside or outside `.agents/tasks/`. Use descriptive titles in prose; use IDs when they identify an exact task or relationship.
