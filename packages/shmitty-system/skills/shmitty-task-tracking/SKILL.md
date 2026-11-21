---
name: shmitty-task-tracking
description: Track coordinated work as a strict Markdown graph in a registered Shmitty workspace when workspace or project instructions select this local tracker.
compatibility: Requires Python 3.9+, PyYAML 6.0.3, task-cli on PATH, and a registered Shmitty workspace.
allowed-tools: Bash(task-cli:*)
---

# Shmitty task tracking

Use this skill only when workspace or project instructions select `shmitty-task-tracking` as the local task tracker. Ask the user for local task-tracking instructions when that selection is unclear. Treat another named tracker as an external tracker and represent its items according to the selected local tracking instructions.

Complete [Set up task tracking](references/set-up-task-tracking.md) before using this skill.

## Vocabulary

- **Item identity**: The POSIX path to one task item's `index.md`, relative to the registered workspace's `.agents/tasks/` directory.
- **Task level**: One item directory and the Markdown documents directly in that directory.
- **Blocking edge**: A directed `dependencies` entry from an item to an item that must reach `done` first.
- **Context link**: A Markdown link in the context section that records evidence, sources, decisions, external items, or another nonblocking relationship.

## Track work

1. Read [Task format](references/task-format.md) before creating or editing an item or its supporting documents.
2. Read [Work model](references/work-model.md) when selecting an item type, parent, blocking edge, or context link.
3. Run `task-cli ready`, `task-cli show <item-identity>`, `task-cli search <query>`, or `task-cli previous` to inspect the complete live graph. Treat every `task-cli` command as read-only.
4. Follow [Execute work](references/execute-work.md) to start, update, and finish an item through manual file edits.

Keep the graph valid after each edit. Fix every reported item or edge before using query output. Do not add a persistent index, generated state, or tracker database.
