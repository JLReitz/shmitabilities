# Model the work

Use beads for implementation that needs durable coordination across steps, agents, or sessions. Skip beads for work completed in one session unless instructed to track it.

Give each item a clear title, description, and completion condition.

Use the following issue types:
- `epic` for a planning-to-implementation workstream.
- `feature` for implementation phases with verifiable outcomes, make as children of an epic.
- `task` for concrete implementation steps. Make as children of a feature or epic, and link ordered tasks with blocking dependencies.
- `spike` for open questions. Define completion as an evidence-backed answer and relate to each dependent item.
- `decision` for a settled answer. Relate to the spike, record the rationale and consequences, then close the spike.

```bash
bd create "<workstream>" --type epic --description "<scope and outcome>"
bd create "<phase>" --type feature --parent <epic-id> --description "<phase exit condition>"
bd create "<step>" --type task --parent <feature-or-epic-id> --description "<deliverable and acceptance>"
bd dep <first-id> --blocks <second-id>

bd create "Investigate <question>" --type spike --parent <epic-id> --description "<question and evidence required>"
bd dep relate <spike-id> <related-feature-or-task-id>
bd create "Decide <subject>" --type decision --parent <epic-id> --description "<choice, rationale, consequences>"
bd dep relate <spike-id> <decision-id>
```
