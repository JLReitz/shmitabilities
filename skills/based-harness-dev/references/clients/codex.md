# Codex

## Project instructions

Codex reads `AGENTS.md` from the Git project root down to its working directory. A nested file adds more specific guidance for that subtree. Start Codex at the relevant project or app root and confirm the active instruction sources in a session.

## Project skills

Codex discovers skills in `.agents/skills/` from the working directory through the Git project root. Keep shared skills there; a client-specific copy is unnecessary. Confirm that a project skill appears in the session's skill list before using it.

## Project MCP configuration

A trusted project's `.codex/config.toml` can define MCP servers. Codex also reads user configuration from `${CODEX_HOME}/config.toml` or its default user path. Keep bearer credentials in user-scoped configuration or a supported credential store; use a project file for settings safe to track.

## Custom agent profiles

Keep the agent definition and its config registration aligned. Check the active Codex permission schema before writing filesystem rules, then test the profile at agent spawn time. Use exact paths or supported subtree rules for write access.
