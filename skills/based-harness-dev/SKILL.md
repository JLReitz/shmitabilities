---
name: based-harness-dev
description: Create and maintain portable LLM agent harness infrastructure, workspace hooks, shared utilities, and client-specific integrations.
---

# Based harness development

## Vocabulary

- **Workspace:** Space within a filesystem where agentic work is performed.
- **Default agent:** Agent formed by global user configuration under `$HOME`.
- **Harness:** Utilities that wrap an LLM to create an agent, implemented within a workspace.
- **Client:** A tool that connects to an LLM service provider. A client is often a standalone harness, such as Codex, Claude Code, or Pi.
- **Registration:** Configuration that makes a resource or integration available to a client.
- **Session:** An active agent interaction managed by a client.
- **Context:** Prompted, loaded, or disclosed information.
- **Guidance:** Helpful, directive prompting.

## Configuration scopes

### Default agent

Bare user configurations are applied first to all sessions active under `$HOME`.

Not a workspace. Baseline settings for all supported clients are stored in respectively named hidden directories and `~/.agents/` contains common, globally accessible materials.

### Workspace

Local settings, hooks, and skills overlay or reconfigure the default agent.

#### Layout

```text
workspace-root/
├── .agents/
│   ├── hooks/          # Hook entry points
│   ├── scripts/        # Central utilities
│   ├── skills/         # Workspace-scoped skills
│   └── mcp.json        # Workspace-scoped MCP configurations
├── .codex/
│   ├── config.toml
│   └── hooks.json
├── .pi/
│   ├── extensions/     # Workspace-scoped extensions
│   ├── mcp.json  -> ../.agents/mcp.json
│   └── settings.json
├── ...
└── AGENTS.md
```

- Store [hook entry scripts](references/hook-entry-requirements.md) in `.agents/hooks/`. Prefer Bash.
- Store [packaged modules and command-line interfaces](references/script-requirements.md) in `.agents/scripts/`. Prefer Python for these components.
- Symlink when clients require common materials in specific locations

## Harness packages

Use [Harness package development](references/package-development.md) for reusable capabilities. Place a stock capability's client-neutral logic and client interfaces in one package, expose its core API through `src/index.ts`, and package reusable port implementations independently. Let other capability packages extend the stock package's public core API.

## Client support

When client-specific knowledge is required or changes, use the `shmitty-knowledge` skill to access and maintain a knowledge bundle named `<client>-development` for each supported client.

### Recommended topics

- Client registration details
- Sandboxing
- Hooks, including supported events and data structures
- Plugins and their formats
- Runtime daemons, services, and connections

### Client fundamentals

Baseline details per supported client:
- [Claude Code](references/clients/claude-code.md)
- [Codex](references/clients/codex.md)
- [DeepSeek Harness](references/clients/dsh.md)
- [Pi](references/clients/pi.md)
