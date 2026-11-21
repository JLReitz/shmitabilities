---
name: shmitty-project-manager
description: Locate and set up agent workspaces and their Git projects, organize shared task documents, and route planned or ad hoc project work.
compatibility: Requires Git, symbolic-link support, shmitty-knowledge, shmitty-version-control, and a configured local task-tracker.
allowed-tools: Bash(git:*), Bash(ln:*)
---

# Project management

## Vocabulary

- **Workspace root**: A directory other than `${HOME}` that contains `.agents/` and all projects in one agent workspace. `${HOME}/.agents/workspaces/<workspace-name>` is a symbolic link to it.
- **Project root**: The root of a Git repository at or below a workspace root. A project may start at the workspace root, and a workspace may contain multiple projects.
- **Local task tracker**: The tracker selected by workspace or project instructions to define and coordinate work performed in the workspace.
- **External task tracker**: Another system that supplies external items, identifiers, relationships, and state. Link or mirror its items through the local task tracker according to the local tracking instructions.

## Locate or set up workspaces and projects

Create or select the workspace before setting up a project. Read [workspace setup](references/workspace-setup.md) to create or register a workspace. Read [project setup](references/project-setup.md) to create or register a Git project inside that workspace. Read [project search](references/project-search.md) to locate either root.

Treat the Git repository as the complete project boundary.

## Select the work path

Use the local task tracker only when workspace or project instructions clearly select it and state how to track local work. Ask the user to provide local task-tracking instructions when they are not clear. Do not select a tracker from an external item alone.

When the request is defined in the local task tracker, follow [planned work](references/planned-work.md). Perform an ad hoc request on the current working branch with `shmitty-version-control`.

## Place workspace task documents

Store long-lived or frequently revised documents for every project under the single `{workspace-root}/.agents/tasks/` directory. Give each local tracked item that owns documents a topic directory. Name it with the kebab-case form of its title: lowercase, each run of characters other than `a-z` and `0-9` replaced by one hyphen, no hyphen at either end. Prefix the lowercase external ID and a hyphen when the local item mirrors an external item. Do not use local tracker IDs. Create a directory for an ancestor item only when it groups two or more topics, and nest those topics in it; keep every other topic at the top level.

Create `{workspace-root}/.agents/tasks/index.md` as the human-facing topic index and list only top-level topics. Give each topic an `index.md` that links its documents and child topics and summarizes their purpose. Name documents for their content, such as `idea.md` or `design.md`, and write their content for human readers.

Move affected topic directories and fix incoming links when a tracked item's title or parent changes, or when a new topic gives its ancestor a second child.

Link a document from the description of any tracked item that needs it. Keep that description focused on the tracked outcome and document links.

Treat a document as infrastructure material when skills produce, maintain, and read it as long-standing task context, such as `idea.md`. Infrastructure material may contain local and external task IDs and links to relevant items, sources, and documents inside or outside `.agents/tasks/`. Use descriptive titles in prose; use IDs when they identify an exact task or relationship.

## Place workspace knowledge

Use the `shmitty-knowledge` skill to access and maintain one shared tree at `{workspace-root}/.agents/knowledge` for every project in the workspace.

- Generalize reusable methods, constraints, and decisions into subject bundles that any project can use.
- Group knowledge whose meaning depends on one project's goals, design, domain, or decisions in a bundle named for that project.
- Link project-specific concepts to reusable concepts and shared references within the tree.
