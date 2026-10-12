# Idea model creation

## 1. Create the idea model

Create an epic or feature for the idea in the configured task tracker. Name the topic directory from its title, then create `{project-root}/.agents/tasks/<parent title>/index.md` and `idea.md`. Put a link to `idea.md` in the parent ticket description.

## 2. Detail the intended outcome

Confirm the intended scope, restrictions, and requirements with the user per [Decision conventions](decision-conventions.md).

## 3. Populate the idea model

Fill in `idea.md` with the description, Long-horizon outcome, and optional sections. List closed **decisions** under **Design clarification** and excluded work under **Out of scope**. Give each list entry its ticket ID when available, title, and summary. Record incomplete thoughts under **Unformed questions**.

## 4. Work the decision tree

Follow [Work through decisions](work-through-decisions.md).

### Termination criteria

Creation finishes when the ready set is empty and the user confirms shared understanding.

Evaluate the problem space:
- If tasks are open and blocking **decisions**, report those dependencies.
- Otherwise, if the idea is **heavy weight**, all tickets are closed, and the design fits one session, ask the user if they want a full **idea model** or an immediate handoff.
