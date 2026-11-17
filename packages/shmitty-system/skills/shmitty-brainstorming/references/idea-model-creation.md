# Idea model creation

## 1. Create the idea model

Select the story or feature type per **Model the idea**, then create the idea in the local task tracker and create its `idea.md`.

When the user names items in an external task tracker, follow [Seed from an external tracker](seed-from-external-tracker.md) first.

## 2. Detail the intended outcome

Confirm the intended scope, restrictions, and requirements with the user per [Decision conventions](decision-conventions.md). Show the long-horizon outcome and out of scope items with the first ready set. Do not begin to close decisions until the user confirms both.

## 3. Populate the idea model

Fill in `idea.md` with the description, Long-horizon outcome, and optional sections. List closed **decisions** under **Design clarification** and excluded work under **Out of scope**. Give each list entry its ticket ID when available, title, and summary. Record incomplete thoughts under **Unformed questions**.

## 4. Decompose the implementation

Follow [Decompose the implementation](decompose-the-implementation.md).

## 5. Work the decision tree

Follow [Work through decisions](work-through-decisions.md).

### Termination criteria

Creation finishes when the ready set is empty, an implementation plan exists, no **steps** are blocked by an open decision, and the user confirms shared understanding.

Evaluate the problem space:
- If tasks are open and blocking **decisions**, report those dependencies.
- Otherwise, if the idea is **heavy weight**, all tickets are closed, and the design fits one session, ask the user if they want a full **idea model** or an immediate handoff.
