# Shmitty workflows

The Shmitty skills connect workspace and project discovery, planning, evidence, durable knowledge,
task tracking, and Git work. External workspace or project instructions select the local task
tracker. The workflow invokes only the skills needed for the current work.

## Flow graph

```text
            ┌─────────────────────────┐ ┌───────────────────────┐
            │ shmitty-project-manager │ │ shmitty-brainstorming │
            └─────┬───────────┬───────┘ └──────────┬────────────┘
                  │ current   │                    │ factual
                  │ branch    │                    │ questions
                  ▼           │                    ▼
┌─────────────────────────┐   │     ┌──────────────────┐
│ shmitty-version-control │   │     │ shmitty-research │
└─────────────────────────┘   │     └──┬───────────────┘  
                              │        │
                              │ setup  │ record
                              ▼        ▼
                        ┌───────────────────┐
                        │ shmitty-knowledge │
                        └───────────────────┘
```

All shmitty skills also accept direct use. Their position in the graph shows how they connect to
the project workflow, not a requirement to start every factual query with project setup.

## Workspace artifacts

A **workspace root** is a directory other than `${HOME}` that contains `.agents/` and every
project in one agent workspace. A symbolic link at
`${HOME}/.agents/workspaces/<workspace-name>` identifies the root and provides a stable navigation
entry. A **project root** is the root of a Git repository at or below that workspace root. A
workspace can contain multiple projects, and a project can start at the workspace root.

The workspace contains one knowledge tree, one task-document directory, and one worktree parent.
Each project is a Git repository.

```text
${HOME}/.agents/workspaces/
└── <workspace-name> ─────────────► {workspace-root}/
                                     ├── .agents/
                                     │   ├── knowledge/   shared knowledge tree
                                     │   └── tasks/       shared task documents
                                     ├── worktrees/       planned-work Git worktrees
                                     ├── {project-a}/
                                     │   └── .git/
                                     └── {project-b}/
                                         └── .git/
```

Project-specific knowledge uses a bundle named for the project inside
`{workspace-root}/.agents/knowledge`. Shared concepts and references can connect every project in
the workspace. When the workspace root is also a project root, its `.git/info/exclude` contains
`/worktrees/`.

## Project workflow

1. `shmitty-project-manager` resolves a registered workspace link, then verifies Git repositories
   at or below that workspace root.
2. `shmitty-project-manager` selects the work path. Work defined in the local task tracker gets a
   task branch and a worktree under `{workspace-root}/worktrees/`; ad hoc work uses the current
   working branch.
3. `shmitty-brainstorming` converts a rough idea into a local-tracker-backed idea model when design
   work remains. The externally selected tracker supplies its item and task-document operations.
   The idea model contains decisions, evidence questions, empirical tasks, and executable
   implementation steps.
4. `shmitty-research` answers factual questions. `shmitty-knowledge` supplies existing evidence
   before research and stores durable findings after research.
5. `shmitty-version-control` performs the work and records progress commits on the selected branch.
   `shmitty-project-manager` rebases and consolidates completed local-tracker work.
6. `shmitty-knowledge` retains reusable outcomes in the shared workspace tree. Shared task
   documents retain project-specific plan and design context.

## Skill responsibilities

### `shmitty-project-manager`

`shmitty-project-manager` creates or selects the workspace before setting up a project. It resolves
workspace roots through `${HOME}/.agents/workspaces/`, confirms each project root with
`git rev-parse --show-toplevel`, and treats the Git repository as the complete project boundary.

The workspace uses `{workspace-root}/.agents/knowledge` for knowledge and the single
`{workspace-root}/.agents/tasks/` directory for every project's task documents. Task topic
directories follow local tracker titles and parent relationships. Each topic has an `index.md`;
long-lived content uses descriptive names such as `idea.md` and `design.md`. Local tracker
descriptions link the documents needed by their items.

The manager distinguishes local task tracking from external task tracking. Workspace or project
instructions select the local tracker that defines executable work, local IDs, relationships, and
state. An external task tracker supplies linked source items and external state. The user supplies
local tracking instructions when the workspace and project do not state them clearly.

### `shmitty-brainstorming`

`shmitty-brainstorming` turns an unformed idea into a complete implementation plan. It creates a
story or feature as the idea model, stores its narrative in `idea.md`, and represents remaining
work as child tickets:

- A **question** needs factual research.
- A **task** needs a runnable experiment.
- A **decision** needs user judgment.
- A **step** implements the approved design in one bounded session.

Questions invoke `shmitty-research`. Decisions remain open until the user approves them. Steps
stay blocked by the decisions that constrain them. Brainstorming finishes when the ready set is
empty, the implementation plan exists, and open decisions do not block its steps.

### `shmitty-task-tracking`

`shmitty-task-tracking` is an optional file-native local tracker. External workspace or project
instructions select it; Shmitty System does not choose it from package availability. It stores one
strict task item at each non-root `.agents/tasks/**/index.md`, derives parent-child relationships
from directory nesting, and stores blocking edges as exact root-relative dependency paths. Its
`task-cli` reads the live graph for item reports, ready work, title-or-tag search, and the most
recently touched task levels. People and agents edit the Markdown files directly.

The skill owns this strict layout and its supporting documents. It does not change or enlist
`shmitty-project-manager`, whose human-facing topic-index procedure remains independent. A
workspace must not apply both layouts to one task tree. The Shmitty System package README defines
the complete schema, command behavior, validation, scope, and compatibility contract.

### `shmitty-research`

`shmitty-research` answers factual questions with current, claim-specific evidence. It searches
the knowledge tree first, identifies the evidence gap, then ranks sources by their authority for
the exact claim. It records source identity, relevant dates, support, uncertainty, and credible
conflicts.

Persistent external sources can become References and support Concepts through
`shmitty-knowledge`. Search results, runtime observations, and source-code findings remain working
evidence unless a persistent published source supports a durable Reference.

### `shmitty-knowledge`

`shmitty-knowledge` maintains one self-contained Open Knowledge Format tree. References preserve
source-defined information. Concepts combine supported claims and link to their evidence. Open
requirements represent unanswered relationship questions.

The tree root configures confidence, investment, and unmatched-term policy. Root and topic
`ontology.ttl` modules carry Shared vocabulary, Requirement existence restrictions, and Inference
axioms. `knowledge-cli` reads, checks, evaluates, and explicitly migrates a selected tree. Codex
calls the read, search, connection, confidence, investment, verification, and ontology operations
through the packaged `shmitty-knowledge` MCP server. Migration remains available through the CLI.

`knowledge-cli` uses `PyYAML==6.0.3`, `rdflib==7.6.0`, `owlrl==7.6.2`, and `JPype1==1.5.2`. Its
ontology commands also require Java 8 and the packaged HermiT OWL API JAR selected by
`SHMIT_OWL_JAR`. See [Knowledge ontology tooling](dependencies.md#knowledge-ontology-tooling) for
installation and verification.

### `shmitty-version-control`

`shmitty-version-control` performs work and records progress commits on the current working branch.
It reads project material from the current worktree and resolves shared task documents and
knowledge through `shmitty-project-manager`.

For work defined in the local task tracker, `shmitty-project-manager` creates
`{workspace-root}/worktrees/<task-name>/`, invokes `shmitty-version-control`, then rebases the
working branch and consolidates its task commits into one commit. Ad hoc work remains on the branch
that was current when the request began.

## Integration boundaries

### Local and external task tracking

Workspace or project instructions select the **local task tracker** and state how agents use it.
The local tracker defines work performed in the workspace. An **external task tracker** supplies
items from another system; local tracking instructions define how those items link to or mirror
local items.

For `shmitty-brainstorming`, the local tracker supplies:

- story or feature idea models;
- task, question, decision, and step roles, either natively or through a stable mapping;
- parent-child and blocking relationships;
- ready-state queries, claims, status changes, comments, and answers;
- external references for items mirrored from an external task tracker.
- its task-document creation and organization procedure.

For `shmitty-project-manager`, the local tracker supplies stable titles, parent relationships,
local task IDs, and item descriptions that can link `.agents/tasks/` documents. The task title's
kebab-case form names both the branch and its worktree directory.
`shmitty-version-control` receives the selected branch and does not access either tracker.

Each tracker integration owns its storage, connection, lifecycle, and task-document procedures.
External workspace or project instructions select one integration. `beads-task-tracking` can use
the independent `shmitty-project-manager` topic-document procedure;
`shmitty-task-tracking` owns its strict Markdown graph. Shmitty owns the idea-model semantics and
Git workflow that consume the selected tracker state.

### Knowledge extensions

External projects, skills, etc. may integrate with durable knowledge through `shmitty-knowledge`.
They can search Concepts and References before work, then propose source-backed revisions after
work. They must use the knowledge format and tree policies instead of writing unrelated files into
the tree.

Workspace-specific ontology files customize terms and relationship requirements. Root confidence
and investment settings customize the acceptance and authority model for every Concept in the
tree.
