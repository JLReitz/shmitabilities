# Shmitty workflows

The Shmitty skills connect project discovery, planning, evidence, durable knowledge, and Git work.
The project workflow enters through `shmitty-project-manager`, then invokes only the skills needed
for the current work.

## Flow graph

```text
            ┌─────────────────────────┐ ┌───────────────────────┐
            │ shmitty-project-manager │ │ shmitty-brainstorming │
            └─────┬───────────┬───────┘ └──────────┬────────────┘
                  │ project   │                    │ factual           
                  │ root      │                    │ questions
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

A **workspace root** contains the client registration directories for one agent workspace. A
**project root** is the root of a Git repository at or below that workspace root. A workspace can
contain multiple projects, and a project can start at the workspace root.

The workspace contains one knowledge tree. Each project contains its own task documents and task
worktrees.

```text
{workspace-root}/
├── .agents/
│   └── knowledge/                 shared knowledge tree
├── {project-a}/
│   ├── .git/
│   └── .agents/
│       ├── tasks/                 project-a task documents and project marker
│       └── worktrees/             project-a Git task worktrees
└── {project-b}/
    ├── .git/
    └── .agents/
        ├── tasks/                 project-b task documents and project marker
        └── worktrees/             project-b Git task worktrees
```

Project-specific knowledge uses a bundle named for the project inside
`{workspace-root}/.agents/knowledge`. Shared concepts and references can connect every project in
the workspace.

## Project workflow

1. `shmitty-project-manager` finds `.agents/tasks/` directories below the workspace root. Each
   directory marks the parent of its `.agents/` directory as a project root, including when the
   tasks directory is empty. Git confirms the marked root.
2. `shmitty-brainstorming` converts a rough idea into a tracker-backed idea model when design work
   remains. The idea model contains decisions, evidence questions, empirical tasks, and executable
   implementation steps.
3. `shmitty-research` answers factual questions. `shmitty-knowledge` supplies existing evidence
   before research and stores durable findings after research.
4. `shmitty-version-control` creates a task branch and worktree for implementation, then produces
   the final task commit.
5. `shmitty-knowledge` retains reusable outcomes in the shared workspace tree. Project task
   documents retain the project-specific plan and design context.

## Skill responsibilities

### `shmitty-project-manager`

`shmitty-project-manager` locates or creates a project and establishes its artifact boundaries. It
confirms each `.agents/tasks/` marker with `git rev-parse --show-toplevel`, uses
`{workspace-root}/.agents/knowledge`, and keeps task documents under
`{project-root}/.agents/tasks/`.

Task topic directories follow tracker titles and parent relationships. Each topic has an
`index.md`; long-lived content uses descriptive names such as `idea.md` and `design.md`. Tracker
descriptions link the documents needed by their items.

Project setup keeps `/.agents/` ignored by Git. Requested `.agents` files can be tracked with an
explicit force-add while the directory remains ignored by default.

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

`shmitty-version-control` isolates implementation in
`{project-root}/.agents/worktrees/<task>/`. It obtains the project root from
`shmitty-project-manager`. A configured task tracker can supply the task ID, parent task, branch
lineage, and commit identity.

The final branch is rebased onto the selected repository head and its task work is consolidated
into one commit. Task documents remain under the project root. Shared knowledge remains under the
workspace root.

## External skill integration

### Task tracking

A task-tracking skill integrates at the planning, document, and version-control boundaries.
User or project provided instructions must select the tracker implementation and supply the
contracts below.

For `shmitty-brainstorming`, the tracker supplies:

- story or feature idea models;
- task, question, decision, and step roles, either natively or through a stable mapping;
- parent-child and blocking relationships;
- ready-state queries, claims, status changes, comments, and answers;
- external references for mirrored tickets.

For `shmitty-project-manager`, the tracker supplies stable titles, parent relationships, and item
descriptions that can link `.agents/tasks/` documents. For `shmitty-version-control`, it supplies
task IDs and parent tasks for branch and worktree lineage.

The tracker owns its database, connection, and lifecycle procedures. Shmitty owns the idea model,
task-document layout, and Git workflow that consume tracker state.

### Knowledge extensions

External projects, skills, etc. may integrate with durable knowledge through `shmitty-knowledge`.
They can search Concepts and References before work, then propose source-backed revisions after
work. They must use the knowledge format and tree policies instead of writing unrelated files into
the tree.

Workspace-specific ontology files customize terms and relationship requirements. Root confidence
and investment settings customize the acceptance and authority model for every Concept in the
tree.
