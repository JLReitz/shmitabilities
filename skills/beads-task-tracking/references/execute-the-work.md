# Execute the work

1. Run `bd ready`, inspect the selected item with `bd show <id>`, and claim it with `bd update <id> --claim` before editing.
2. Record methods and observations on the evidence task with `bd note <task-id> "..."`. Post the answer, supporting evidence, uncertainty, and links to evidence tasks on the question spike with `bd note <spike-id> "..."` before closing an evidence task. Use `bd comment <id> "..."` for conversational updates.
3. Add discovered work as a separate child task. Finish the claimed scope before starting it.
4. Close an evidence task after its results are posted to the spike. Close the spike after its linked evidence tasks are complete and its answer meets the acceptance criteria. Close other child tasks before their feature, and features before the epic.
5. End the session with the claimed item closed or updated with its state, evidence, blocker, and next action.

Use the `based-document-author` skill when writing titles, descriptions, notes, comments, and decisions. Run `bd prime` for the installed command reference.
