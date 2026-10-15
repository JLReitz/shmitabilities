# Model the work

Use beads for implementation that needs durable coordination across steps, agents, or sessions. Skip beads for work completed in one session unless instructed to track it.

Give each item a clear title, description, and completion condition.

Use the following issue types:
- `epic` for a planning-to-implementation workstream.
- `feature` for implementation phases with verifiable outcomes, make as children of an epic.
- `task` for concrete implementation steps or evidence gathering. Make implementation tasks children of a feature or epic; make evidence tasks children of the spike whose question they investigate. Link ordered tasks with blocking dependencies.
- `spike` for one open question. Give each spike at least one linked evidence task, define completion as an evidence-backed answer recorded on the spike, and relate it to each dependent item.
- `decision` for a settled answer. Relate to the spike, record the rationale and consequences, then close the spike.

```bash
bd create "<workstream>" --type epic --description "<scope and outcome>"
bd create "<phase>" --type feature --parent <epic-id> --description "<phase exit condition>"
bd create "<step>" --type task --parent <feature-or-epic-id> --description "<deliverable and acceptance>"
bd dep <first-id> --blocks <second-id>

bd create "<question>" --type spike --parent <epic-id> --description "<question and answer criteria>"
bd create "Gather evidence for <question>" --type task --parent <spike-id> --description "<method and evidence deliverable>"
bd dep relate <spike-id> <related-feature-or-task-id>
bd create "Decide <subject>" --type decision --parent <epic-id> --description "<choice, rationale, consequences>"
bd dep relate <spike-id> <decision-id>
```
