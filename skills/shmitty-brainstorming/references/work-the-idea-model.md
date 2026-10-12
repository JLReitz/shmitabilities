# Work the idea model

## 1. Load the idea model

Load `idea.md` from the parent title's topic directory and inspect the parent ticket without loading every child ticket body.

## 2. Claim a ticket

Claim the named ticket. When the user gives the idea model ticket, claim the highest-priority ticket from the ready set.

Re-read tracker state before the claim. Expect concurrent sessions to work independent tickets from the ready set.

## 3. Work the ticket

Re-read tracker state, then follow the procedure for the claimed ticket type: [task](work-through-tasks.md), [question](work-through-questions.md), or [decision](work-through-decisions.md). Load related tickets only when their detail is needed.

## 4. Close the ticket

Post the answer and close the ticket.

## 5. Update the idea model

Create and wire newly precise tickets. Move clarified entries from **Unformed questions** into tickets. Close newly out-of-scope tickets and list each under **Out of scope** with its ticket ID, title, and summary of the boundary.

Re-read task tracker state before each dependency change. Edit the affected section of `idea.md` and keep its topic `index.md` current.

## 6. Work ready decisions

Follow [Work through decisions](work-through-decisions.md).
