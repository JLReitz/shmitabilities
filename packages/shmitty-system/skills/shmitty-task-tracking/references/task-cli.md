# Query tasks with task-cli

Run each command from a directory inside the registered workspace:

```bash
task-cli ready [--scope <item-identity>]
task-cli show <item-identity> [--scope <item-identity>]
task-cli search <query>
task-cli previous [--scope <item-identity>]
```

`ready` lists created items whose dependencies are done. `show` returns one item and its direct relationships. `search` matches titles and tags. `previous` returns the task levels with the latest direct Markdown-file modification time.

Use `--scope` to restrict `ready`, `show`, or `previous` to one item subtree. Dependencies can cross the scope boundary and continue to control readiness.

The command discovers the task root from the registered workspace that contains the current directory. Each query validates the complete graph before it returns normal output. Fix each diagnostic before using the result.
