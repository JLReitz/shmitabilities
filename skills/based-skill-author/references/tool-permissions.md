# Tool permissions

List the minimum commands and MCP tools that the skill calls directly. Required skills declare their own permissions.

A `Bash(cmd:*)` permission matches the literal leading command token followed by any arguments. `Bash(scripts/example.sh:*)` matches:
```bash
scripts/example.sh <arguments>
```

It does not match `./scripts/example.sh` or `bash scripts/example.sh`.

Shell operators split a command into subcommands. Each subcommand must match an allowed permission.
