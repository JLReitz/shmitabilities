# Router structure

Use a router when one skill boundary contains alternative procedures and the task selects which procedure applies.

## `SKILL.md`

State the context shared by every route. Define the route criteria at the decision point. Direct the agent to load only the selected reference.

Keep each route-specific procedure out of `SKILL.md`.

## Reference documents and skills

A route MAY select a bundled reference document or another skill.

- Use a bundled reference document when the procedure belongs to this skill boundary. Name the file after the operation, provider, format, or domain that selects it.
- Use another skill when that skill owns the selected procedure. Name the skill at the route decision and state the input or outcome needed at the handoff.

Each route MUST have criteria that distinguish it from the other routes. State how to proceed when the available task context does not select one route.
