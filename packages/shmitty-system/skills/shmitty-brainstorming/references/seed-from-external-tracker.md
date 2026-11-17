# Seed from an external tracker

When the user names items in an external task tracker, mirror them in the local task tracker before you model the idea.

Map brainstorm, external, and local tracker types:

| External type | Local type | Brainstorm role |
|---|---|---|
| Epic | Epic | Parent of the mirrored item |
| Story | Story | Idea model, mirrored item |
| Feature | Feature | Idea model, mirrored item |
| Subtask or task | Task | Implementation steps under the idea model |
| Question | Question | Research |

- Put the external item's URL in the mirrored item's external reference field.
- Take the title from the external summary, without any prefix that every sibling shares.
- Map the status between external and mirrored items.
- Define completion for each mirrored item as the close of its external item.

Fall back on the task type when a tracker does not have a native representation.
