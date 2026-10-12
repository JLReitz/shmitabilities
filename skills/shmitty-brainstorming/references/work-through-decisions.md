# Work through decisions

## 1. Load the decision tree

Read the open **decisions** and their dependencies. Load related tickets only when their detail is needed.

## 2. Compute the ready set

Follow [Decision conventions](decision-conventions.md) at the current **weight**. Include each open **decision** with no blockers in the ready set.

Leave **decisions** that depend on open **tasks** or **questions** unresolved.

## 3. Review the ready set

Present the complete ready set as a numbered list, then wait for the user's feedback.

## 4. Continue the decision tree

Recompute the ready set after each decision closes. Continue until the ready set is empty.
