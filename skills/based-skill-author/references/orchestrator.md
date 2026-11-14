# Orchestrator structure

Use an orchestrator when one operation requires ordered stages and state that passes between them.

## `SKILL.md`

Define the stage order, entry condition, completion condition, and state retained between stages. State each gate that controls whether the next stage can start.

Keep stage procedures out of `SKILL.md` when another reference owns them.

## Reference documents and skills

A stage MAY use a bundled reference document or another skill.

- Use a bundled reference document when the stage belongs to this skill boundary. Give it the stage input, procedure, output, and failure result.
- Use another skill when that skill owns the stage. Name the skill at the handoff and state the input it receives and the result the orchestrator retains.

The orchestrator owns stage order and retained state. Each reference owns only its stage procedure.
