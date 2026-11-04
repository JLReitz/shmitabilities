# Codex

Codex loads project instructions, skills, configuration, and installed plugins. A plugin packages skills, MCP servers, and optional hooks. Inspect the selected Codex version before using a manifest field or runtime setting.

Package repository: https://github.com/openai/codex
Documentation: https://developers.openai.com/codex

## Vocabulary

- **Plugin:** An installable directory with a manifest and Codex capabilities.
- **Marketplace:** A catalog of plugins and their local, Git, or npm sources.
- **MCP server:** A process or remote endpoint that exposes tools and resources.
- **App:** A product-level registration for a connected MCP service; a plugin can refer to an existing registration through `.app.json`.
- **Interface:** Codex-facing instructions and registration over a shared capability.

## Agent directory

Codex reads user configuration from `${CODEX_HOME}/config.toml`, or its default user path when `CODEX_HOME` is unset. Keep credentials and machine-specific settings there. Installed marketplace plugins are cached under the Codex home; Codex loads the installed copy, so editing a marketplace source alone does not update it.

## Project `.codex/` directory

A trusted project's `.codex/config.toml` can set local MCP servers and plugin enablement. Use it for settings safe to track. Inspect the active configuration in the selected client before relying on precedence or project trust.

For a plugin from a local marketplace, the project setting uses `plugin-name@marketplace-name`:

```toml
[plugins."example-reader@local-example"]
enabled = true
```

## Project instructions and skills

Codex reads `AGENTS.md` from the Git project root down to its working directory. A nested file supplies guidance for its subtree. Start at the relevant project root and confirm the active instruction sources in a session.

Codex discovers project skills under `.agents/skills/` from the working directory through the Git project root. Put distributable plugin skills under the plugin's `skills/` directory. Confirm discovery in a new session and invoke a representative skill.

## Project MCP configuration

Define a server under `[mcp_servers.<name>]` in a trusted project's `.codex/config.toml`. An HTTP server uses `url = "<server-url>"`. Run `codex mcp list` and invoke a representative tool. Keep bearer credentials in user-scoped configuration or a supported credential store. A bundled plugin server uses the plugin format below, separate from project TOML.

## MCP and App naming

Codex uses **MCP server** for the protocol endpoint that provides tools. OpenAI also uses **App** for a registered connection to an MCP service. A project server under `[mcp_servers.<name>]` or a bundled server in `mcp.json` can expose tools directly. The plugin's `apps` field instead points to `.app.json`, which maps an already registered service identity to the plugin. When a service is registered through ChatGPT Plugins, that identity starts with `plugin_asdk_app`. Use `mcp.json` for a packaged local stdio server; add `.app.json` only when the plugin refers to an existing registered service.

**MCP Apps** is also the name of a UI protocol in which an MCP server can provide a visual resource. That UI meaning is separate from the `apps` registration field. Codex tool access does not establish support for rendering an MCP Apps component; validate presentation in the selected client.

## Plugin configurations

### Install a checkout or distributed plugin

For a checkout, create a local marketplace entry whose `source.path` points to the plugin directory. The path starts with `./` and resolves from the marketplace root. Register the root with `codex plugin marketplace add /absolute/path/to/marketplace-root`, inspect it with `codex plugin marketplace list`, and run `codex plugin add <plugin-name>@<marketplace-name>`. Check the installed identity with `codex plugin list --json`. A repo marketplace can live at `.agents/plugins/marketplace.json`; a personal one can live at `${HOME}/.agents/plugins/marketplace.json`. Refresh or reinstall the cached plugin after changing its source, then check it in a new session.

For distribution, use a marketplace entry with a Git source (`source: "url"` for a repository root, or `source: "git-subdir"` plus `path` for a subdirectory) or an npm source (`source: "npm"`, `package`, and `version`). A remote Git marketplace can be registered with `codex plugin marketplace add owner/repo --ref <ref>`; `codex plugin marketplace upgrade <marketplace-name>` refreshes its snapshot. Inspect with `codex plugin list --available --json`, install with `codex plugin add <plugin-name>@<marketplace-name>`, and check the installed capability in a new session. Pin a Git commit or package version when the selected code must stay fixed. Use `codex plugin remove <plugin-name>@<marketplace-name>` to uninstall after checking the selected CLI's help.

A local marketplace entry can use this shape. Place the plugin at `<marketplace-root>/plugins/example-reader/` and the catalog at `<marketplace-root>/.agents/plugins/marketplace.json`; replace the names and path for the actual source.

```json
{
  "name": "local-example",
  "plugins": [
    {
      "name": "example-reader",
      "source": {
        "source": "local",
        "path": "./plugins/example-reader"
      },
      "policy": {
        "installation": "AVAILABLE",
        "authentication": "ON_INSTALL"
      },
      "category": "Productivity"
    }
  ]
}
```

For a distributed entry, replace `source` with `{"source": "git-subdir", "url": "<repository-url>", "path": "./plugins/example-reader", "ref": "<commit>"}` or `{"source": "npm", "package": "<package-name>", "version": "<version>", "registry": "<registry-url>"}`. Keep the marketplace entry name aligned with the plugin manifest name. The catalog controls installation policy; the manifest controls the plugin's identity and components.

### Plugin layout

A portable plugin uses root `plugin.json`, root `skills/`, and optional root `mcp.json`. Put Codex-specific settings under `extensions.com.openai` in the root manifest. An existing Codex compatibility plugin uses `.codex-plugin/plugin.json` and explicitly declares paths such as `skills` and `mcpServers`. A portable root manifest supplies portable identity and components. When its `extensions.com.openai` object exists, it replaces the compatibility overlay for OpenAI-specific settings; the two are not merged.

```text
<plugin-root>/
├── plugin.json                 # Portable manifest, when used
├── mcp.json                    # Portable MCP servers, when used
├── .codex-plugin/
│   └── plugin.json             # Compatibility manifest, when used
├── .mcp.json                   # Compatibility MCP servers, when used
├── skills/
│   └── <skill-name>/SKILL.md
├── hooks/                      # Optional runtime hooks
└── assets/                     # Optional display assets
```

Keep referenced paths relative to the plugin root, starting with `./` and staying inside it. Package every referenced skill, script, server launcher, hook, and asset. A union package puts its Codex plugin manifest at the package root beside `package.json`, its Codex server under `src/codex/`, and its skill under `skills/`. Build the server to `dist/codex/`. The Codex manifest does not register Pi or DSH module entries.

### Manifest templates

Use the portable form for a new plugin. The root skill directory and MCP file are discovered by convention.

```json
{
  "$schema": "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
  "name": "example-reader",
  "version": "0.1.0",
  "description": "Read text through a reusable workflow."
}
```

For an existing compatibility package, keep `.codex-plugin/plugin.json` and declare its components there. Inspect the live manifest before changing fields or prompts.

```json
{
  "name": "example-reader",
  "version": "0.1.0",
  "description": "Read text through a reusable workflow.",
  "skills": "./skills/",
  "interface": {
    "displayName": "Example Reader",
    "shortDescription": "Read text with a guided workflow",
    "developerName": "Example team",
    "category": "Productivity",
    "capabilities": ["Read"]
  }
}
```

For compatibility plugins with MCP servers, set `"mcpServers": "./.mcp.json"` and place a named `mcpServers` object in that file. A portable plugin puts the object in root `mcp.json` and declares each server's transport `type`, such as `streamable-http`. Keep the file format that matches the manifest. `interface` supplies display text and optional default prompts; align each prompt with a capability actually packaged.

For a portable remote server, root `mcp.json` can contain:

```json
{
  "$schema": "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
  "mcpServers": {
    "reader": {
      "type": "streamable-http",
      "url": "<server-url>"
    }
  }
}
```

For local capability parity with a Pi or DSH tool, replace the remote server entry with a packaged stdio server. Build `src/codex/server.ts` before installing the plugin:

```json
{
  "$schema": "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
  "mcpServers": {
    "reader": {
      "type": "stdio",
      "command": "node",
      "args": ["${PLUGIN_ROOT}/dist/codex/server.js"],
      "cwd": "${PLUGIN_ROOT}"
    }
  }
}
```

`${PLUGIN_ROOT}` resolves to the installed plugin root. The server imports the same public core and selected port as the Pi and DSH adapters, registers an MCP tool with its own input schema, and maps core results and failures to MCP results. Bundle its runtime imports into the built server or verify that each dependency resolves from the installed plugin directory. Codex downloads npm plugin packages without running lifecycle scripts, so publish the built server and all runtime files. A Git source must also contain the files that the installed plugin starts. Check the packed file list and launch the installed server before relying on package-manager installation behavior.

The server's `cwd` above is the installed plugin root. For a filesystem tool, accept an absolute source path or an explicit workspace base in the tool request and resolve relative paths at the Codex interface before calling the core. Do not use the server process directory as the user's workspace directory.

## Plugin interface

Use a skill for an instructed workflow over tools Codex already has. Put `name` and `description` frontmatter in `skills/<skill-name>/SKILL.md`; keep detailed procedures in local references.

```markdown
---
name: read-text
description: Read a text file and report its contents when the user requests it.
---

Read the requested file with the available file tool. Report the text and the path.
```

Use an MCP server for callable tools, external state, or server-side authentication. Register one MCP tool for each model-callable capability; translate validated input to the shared core request and return concise `content` plus `structuredContent` when callers need typed data. Set `readOnlyHint`, `destructiveHint`, and `openWorldHint` from actual behavior. Propagate cancellation to the core where the selected MCP transport and SDK expose it. Keep credentials out of manifests and tool output.

Put model-facing selection rules, call order, stale-result guidance, and output requirements in a packaged skill. This is the Codex workflow counterpart of Pi's `promptSnippet` and `promptGuidelines` or a DSH prompt section. Codex loads a skill when it is selected, so keep the MCP tool description complete enough to select and call the tool without the skill. Test direct and indirect requests for skill activation. If Pi also loads the same skill, list its directory in `pi.skills` only when both clients use the same instructions and tool names.

Use hooks for lifecycle commands that run in the client environment. Codex discovers `hooks/hooks.json` by default unless an explicit hooks field replaces it. Hook commands receive `PLUGIN_ROOT` for packaged files and `PLUGIN_DATA` for writable plugin state. Review and trust the current hook definition before expecting it to run. Release resources on the matching lifecycle event. A web plugin install does not deploy local hook scripts.

A hook file for a local plugin can register a session-start command:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "python3 ${PLUGIN_ROOT}/hooks/session_start.py"
          }
        ]
      }
    ]
  }
}
```

## Shared capability contract

Define client-neutral inputs, results, failures, and cancellation in the capability core. Map those contracts to a Codex skill workflow or MCP tool at the interface. Keep Codex configuration, transport, session state, and hooks outside the core. Validate each client's entry with its own runtime.

## Capability parity in a union package

| Capability | Codex interface | Parity check |
|---|---|---|
| Model-callable operation | Local stdio MCP tool | Same core request, result, failure, and cancellation meaning as Pi and DSH |
| Model guidance | Packaged skill and complete MCP tool description | Skill activation and rules for selection, call order, and stale results |
| External operation | Selected port imported by the Codex server | Same path, network, clock, or state policy after interface translation |
| Lifecycle | MCP server startup and shutdown; hook for an event Codex exposes | Resources close after unload and partial startup |
| Presentation | MCP text or structured result | Same information; client-specific terminal or web layout stays in that client |

Use a portable root plugin manifest beside the package's `package.json`, build `src/codex/server.ts` to `dist/codex/server.js`, and package its skill and server dependencies. The [Harness package development](../package-development.md) reference defines the shared layout and union manifest fragment. A local stdio plugin requires a local execution environment; public distribution of a desktop-only plugin has separate eligibility and review requirements.

## Plugin tools

For MCP tools, register the operation in the server and return bounded model-readable content. Use structured results when callers need typed values. Test schema rejection, success, cancellation where supported, and failures through a real client connection. For a skill-only plugin, validate invocation and the effect of its instructions.

## Custom agent profiles

Keep the agent definition and its config registration aligned. Check the active Codex permission schema before writing filesystem rules, then test the profile at agent spawn time. Use exact paths or supported subtree rules for write access. Agent profiles use Codex settings; plugin installation does not register them.

## Package validation

Check that the manifest parses, every declared path exists inside the package, each skill has valid frontmatter, and all runtime files are included. Inspect the marketplace and installed state with `codex plugin marketplace list` and `codex plugin list --json`. Start a new Codex session from the intended project; confirm skill discovery, test direct and indirect activation, invoke a representative MCP tool, and verify any hook after trust review. Compare the same absolute-path operation, invalid input, core failure, and cancellation with the Pi and DSH interfaces. Test a checkout update and a pinned distributed source separately; run the installed server from its cached plugin directory to catch missing dependencies or an unbuilt entry. Test shared core code directly before installed-client checks.
