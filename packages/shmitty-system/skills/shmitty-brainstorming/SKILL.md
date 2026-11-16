---
name: shmitty-brainstorming
description: Use when the user has a rough, unformed idea they want to sharpen into a tracker-backed idea model of open questions, conversations, and empirical tasks before implementation begins.
---

# Brainstorm

A big idea has manifested and the finished result may not be clear yet.

Develop that idea through iterative steps, record them with the workspace's task tracker, then resolve them one at a time. If a tracker is not configured, stop and ask the user how to track the work.

This is dedicated **planning**; each ticket resolves a choice, and the plan is complete when no gaps remain, with nothing left to decide before implementing.

## Plan, do not implement

Brainstorming produces decisions, evidence, and shared understanding. It does not deliver the finished result. It does produce the implementation plan: development tasks decomposed into **steps** that carry out every decision.

## Identify ideas and tickets

Refer to ideas and tickets by title in user-facing prose. Use task tracker relationships to inspect the current ticket connections.

## Model the idea

Use a **story** when the idea has one coherent outcome that an actor can observe and accept as a usable increment. A story may require multiple implementation steps. Use a **feature** when the idea is a broader capability with multiple independently acceptable outcomes.

Start each brainstorm by creating the idea model as the selected story or feature in the configured task tracker. Use `shmitty-project-manager` to organize `idea.md` and its topic indexes. Link `idea.md` from the idea model's description and make the other tickets children of the idea model.

### Layout

Write the idea model in `idea.md` with this layout:

```markdown
## Description
<1-2 paragraphs to provide context for the desired long-horizon outcome>

## Long-horizon outcome
<Acceptance criteria for completion of an implementation by the brainstormed design. A compound statement that can be evaluated as achieved or not.>

## Appendix
<Optional. Extended notes, glossary, reference material, or prior-art notes.>
<Required. Sections declared below.>

...
### Facts already checked

<Optional. Facts verified before the brainstorm, each with its source.>

### Design clarification

- <Ticket ID when available> — <title>: <summary of the finalized decision>

### Out of scope

- <Ticket ID when available> — <title>: <summary of the excluded work and scope boundary>

### Unformed questions

<In-scope uncertainty that cannot yet be stated as a precise ticket>

```
### Facts already checked

Record each fact verified before the brainstorm with its source. Do not create a ticket to research a fact listed here.

### Design clarification

List each requirement finalized through a decision. Give each entry the ticket ID when available, the decision title, and a summary.

### Out of scope

The intended outcome fixes scope. List each excluded item under **Out of scope** with its ticket ID when available, title, and summary of the boundary. If an existing ticket is discovered to be beyond the intended outcome, close it and record it in this list.

### Unformed questions

Do not create tickets for questions that cannot yet be stated precisely. The idea model's **Unformed questions** section holds in-scope uncertainty that is visible but not sharp enough to become a ticket. Resolving tickets can clarify that uncertainty enough to create new tickets.

The test is whether the question can be stated precisely now, not whether it can be answered now:

- Create a ticket when the question is already precise, even if blocked.
- Keep it under **Unformed questions** when the question itself is still unclear.

Do not duplicate decided work, live tickets, or out-of-scope work under **Unformed questions**.

## Tickets

Each ticket is a child of the idea model and is sized for one agent session.

**Types:**
- **Task**: An uncertainty that needs empirical evidence from a runnable experiment. State the question that the experiment must answer and link the decision that needs the evidence.
- **Question**: A factual uncertainty that primary sources, source code, first-party APIs, or a local knowledge base can answer. State the fact to find and link the decision that needs it.
- **Decision**: A design clarification that needs user judgment. Include the context and link related questions and tasks.
- **Step**: A decomposed item of the implementation plan, sized for one session. State the deliverable, the completion criteria, and each design decision the step must honor, with its source. Block it on each decision that constrains it.

**Tasks** and **questions** can create follow-on **tasks** and **questions**. The chain ends with a **decision**. When closing a **decision**, update the **steps** it blocked.

### Layout

Apply to the ticket itself; use the task tracker's native fields for these sections when available. Otherwise, prepend "[<type>] - " to the ticket title when the type is not native, and append Comments and Answer to that ticket's description body. Do not move these sections to task documents.

```markdown
# Description
<What must be answered or what has been decided. Maximum 4 sentences.>

# Comments
<Append-only notes for recording additional context, may be applied until the answer is appended>

# Answer
<Resolution for tasks and questions>
<Final approved description for decisions ("as-is" if no changes are requested)>
```

## Procedure

- For a new brainstorm, follow [Idea model creation](references/idea-model-creation.md).
- When the user gives the ticket ID for an idea model or one of its children, follow [Work the idea model](references/work-the-idea-model.md).
- To create or update **steps**, follow [Decompose the implementation](references/decompose-the-implementation.md).
