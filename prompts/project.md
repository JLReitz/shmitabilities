---
description: Locate a Shmitabilities project workspace or confirm creating one before brainstorming.
argument-hint: <project-path-or-name>
---

# /project

Use this prompt to inspect an existing Shmitabilities project or start a new project workflow.

## Argument

Accept exactly one argument through `$ARGUMENTS`:

- A project directory path, such as `.agents/projects/my-project`, `./work/my-project`, `~/projects/my-project`, or `/tmp/my-project`.
- A project name, such as `wiki-graph`. Name-only arguments default to `.agents/projects/{name}`.

If `$ARGUMENTS` is empty, ask the user for the project path or project name before doing anything else.

## Directory Resolution

1. Trim surrounding whitespace and matching quotes from `$ARGUMENTS`.
2. Treat the argument as a path if it is absolute, starts with `.` or `~`, or contains `/`.
3. Treat the argument as a project name otherwise.
4. For a path argument, expand `~` and resolve relative paths from the current repository root.
5. For a name argument, search for existing project directories in this order:
   - `.agents/projects/{name}`
   - `.agents/planning/{name}`
   - Any exact directory-name match one level below `.agents/projects/`
   - Any exact directory-name match one level below `.agents/planning/`
6. If exactly one existing directory matches, use it.
7. If multiple existing directories match, list the matches and ask the user which one to use.
8. If no existing directory matches a name argument, select `.agents/projects/{name}` as the proposed new project directory.
9. Do not create any directory until the user explicitly confirms creation.
10. Do not overwrite, delete, or reset an existing directory.

## Existing Project

If the selected project directory already exists:

1. Report the resolved absolute project directory.
2. Print a concise file tree for the project directory.
3. Stop after reporting the file tree.
5. Do not create, overwrite, delete, or rename any project files.

## New Project

If the selected project directory does not exist:

1. Report the proposed absolute project directory.
2. Ask the user to confirm creation before making any filesystem change.
3. If the user does not clearly confirm, stop.
4. If the user confirms, create only the project directory.
5. Do not create `rough-idea.md`, `idea-honing.md`, or any other brainstorm materials in this prompt.
6. After creating the directory, transition to the `brainstorm` skill.

## Brainstorm Handoff

For confirmed new projects only, transition to the `brainstorm` skill using:

- `project_dir`: the resolved absolute project directory.
- `project_name`: the selected directory basename unless the user supplied a clearer name.
- `rough_idea`: any project idea text already present in the current user request; otherwise ask the user for the rough idea.

Follow the `brainstorm` skill from that point forward:

- Confirm the project structure before requirements questions.
- Ask one high-level clarification question at a time.
- Append questions and answers to `idea-honing.md`.
- Keep `rough-idea.md` as the initial concept artifact.
