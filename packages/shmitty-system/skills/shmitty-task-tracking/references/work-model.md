# Work model

Select the narrowest item type that states the tracked outcome.

- Use `epic` for a planning-to-implementation workstream.
- Use `feature` for a capability with multiple independently acceptable outcomes.
- Use `story` for one coherent outcome that an actor can observe and accept as a usable increment.
- Use `task` for one concrete implementation or evidence-gathering action. Tag an implementation step `step`.
- Use `spike` for one open question. Make runnable evidence tasks its children and state the evidence-backed answer in its context before completion.
- Use `decision` for one settled answer. State the choice, rationale, and consequences in its context.

Represent parent-child structure with directory nesting. Represent ordering and blocking only with `dependencies`. Represent sources, evidence, decisions, external tracker items, and other nonblocking relationships with context links.

Use `created` for open work, `started` for work in progress, and `done` for completed work. Progress from `created` to `started` to `done`. Reopen a completed item as `started`. Judge parent completion from its required outcome and children; child status does not change parent status automatically.

Mirror an external item only when the selected local tracking instructions require it. Put the external item's stable link and relationship in context. Add a blocking edge only when that external relationship also blocks local work through a mirrored local item.
