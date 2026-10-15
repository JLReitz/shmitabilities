# Claude Code

## Project instructions

Claude Code reads `CLAUDE.md` files in the working directory and its ancestors at session start. Current Claude Code versions can also read `AGENTS.md` directly when no project `CLAUDE.md` or `CLAUDE.local.md` takes precedence. Claude Code loads a symlinked `AGENTS.md` once even when its instruction setting includes both names. Check `/context` to confirm the active instruction files.

## Project skills

Claude Code loads `.claude/skills/<skill-name>/SKILL.md` from the working directory and ancestors up to the repository root. Nested skills become available when Claude works in that directory. Verify a project skill by invoking its name.

## Project MCP configuration

Claude Code can load a project `.mcp.json`. Its remote MCP login and project scope are client settings; check the selected connector's authentication mode before saving headers in a tracked file.
