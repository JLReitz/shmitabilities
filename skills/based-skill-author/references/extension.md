# Extension structure

Use an extension when a skill adds context or policies to a separate skill that remains responsible for the operation.

## `SKILL.md`

Name the required skill and direct the agent to load it. State the extension scope, activation condition, and added rules. Keep the required skill's procedure in that skill.

State the order when an extension rule must apply before or after a part of the required skill.

## Reference documents and skills

The required skill is the extension's primary reference. Name it at the point where its procedure applies.

Use bundled reference documents for conditional extension detail that belongs to this skill boundary. Route to each document from `SKILL.md` when its condition applies. Do not copy the required skill's instructions into a bundled reference.
