# Execute work

Use `based-document-author` for item titles, descriptions, context, notes, and decisions.

1. Run `task-cli ready`, then inspect the selected item with `task-cli show <item-identity>`.
2. Change the selected item's `status` from `created` to `started` before editing deliverables. Re-run `task-cli show <item-identity>` and fix every validation diagnostic.
3. Record methods, observations, evidence links, decisions, and the next action in the item's context. Keep the description focused on the tracked deliverable and completion condition.
4. Create discovered work as a child item. Add a blocking edge only when the new item must finish before its dependent item can proceed.
5. Finish the claimed scope before starting another item. For a spike, write the evidence-backed answer before completing its evidence tasks. Complete the spike after its answer meets its acceptance criteria and its evidence tasks are `done`.
6. Run `task-cli show <item-identity>` and the relevant project checks. Change `status` to `done` only when the completion condition is met, then run `task-cli show <item-identity>` again.

End the session with the started item set to `done`, or leave it `started` with its current evidence, blocker, and next action in context.
