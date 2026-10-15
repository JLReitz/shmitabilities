# Connect clients and embedded agents

Choose the connection the workspace needs. Read the selected app's installed Core documentation for that connection. Use `based-harness-dev` for each client's project instructions, skill discovery, and configuration.

| Connection | Setup boundary |
| --- | --- |
| A coding client edits the project | Use the generated guidance and skills according to that client's `based-harness-dev` reference. |
| An external client calls the app | Connect it to `/mcp`; the `ask-agent` tool delegates to the app's agent. |
| A coding runtime runs as the app's agent | Use the Core harness module and the selected adapter's optional packages. |
| An existing product embeds Agent Native | Use Core's server and client host modules; an iframe picker uses the separate embedding package. |

## Find supported IDs

After installing the selected Core release, run these commands from an app root:

```bash
pnpm action docs-search --slug external-agents
pnpm action docs-search --slug harness-agents
```

Read the `connect --client` values in `external-agents` for `<client-id>`. Read the **Built-in harnesses** names in `harness-agents`; for an AI SDK adapter, remove the `ai-sdk-harness:` prefix to get `<runtime-id>`. Check each list separately. If `docs-search` cannot run, read `docs/content/external-agents.mdx` and `docs/content/harness-agents.mdx` in the installed `@agent-native/core` package.

## Connect an external client

1. Start or deploy the selected app and obtain its reachable URL. Use the Dispatch `/mcp` endpoint when one client should reach several workspace apps; use an app's `/mcp` endpoint when it should reach only that app. The endpoint exposes actions and `ask-agent`.
2. For a client supported by the selected Core version's `connect` command, choose its client ID and configuration scope before running:

   ```bash
   npx @agent-native/core@<core-version> connect <app-url> --client <client-id> --scope <user-or-project>
   ```

   The `claude-code` path writes a project-safe URL-only OAuth entry; the `codex` compatibility flow writes a bearer entry, so use user scope. For another MCP-capable client, follow its `based-harness-dev` reference to register a remote HTTP MCP server.
3. Restart or reload the client. Confirm its MCP server is connected and its action tools and `ask-agent` are visible. Use a read-only action for the first call; record authentication or provider-dependent checks as unverified until they can run.

## Run a client runtime inside the app

When the app itself must run a supported coding runtime as its agent, select a listed AI SDK runtime ID, then register and resolve `ai-sdk-harness:<runtime-id>` through `@agent-native/core/agent/harness`. This adapter needs the shared `@ai-sdk/harness` package and the client package `@ai-sdk/harness-<runtime-id>`. The packages load only for the selected harness; read its `installPackage` hint for version tags and obtain package-manager approval before installing them in the app.

The `codex` harness and the local Codex CLI have separate authentication paths. Follow the installed `harness-agents` page before passing credentials into a sandbox. Verify package availability, start a bounded turn, and confirm that the transcript and resumed session work. Keep the generated chat surface; the harness replaces the agent runtime behind it.

## Embed Agent Native in an existing product

The standard app's agent panel comes from `@agent-native/core/client`; it needs no additional package. When an existing product hosts Agent Native as a sidecar, use `createAgentNativeEmbeddedPlugin` from `@agent-native/core/server` with `AgentNativeEmbedded` from `@agent-native/core/client/host`. Add `@agent-native/embedding` only when the host needs to launch a complete Agent Native app as an iframe picker or use its bridge and A2A helpers. Read the installed `embedding-sdk` page for the host contract.

A generated multi-app workspace already includes `@agent-native/dispatch` for Dispatch and `@agent-native/toolkit` for shared UI. Keep those scaffold dependencies; they are separate from the optional client harness packages. Add `@agent-native/code-agents-ui` only when building a coding workspace UI, following the installed `code-agents-ui` page.
