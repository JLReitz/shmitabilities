# Shmitabilities

This repository is a plugin and extension package.

## Pi package

- `package.json` defines this repo as a Pi package that loads the local
  `extensions/pi-files-and-shmit/` package and local skills from `skills/`.
  - Keep `pi.extensions` and `pi.skills` entries valid relative paths.
  - Keep `bundledDependencies`, `dependencies`, and `files` coherent with the intended shipped artifact.
  - Keep the root `postinstall` running the extension's production install.
    npm does not install dependencies or run lifecycle scripts for a nested
    source directory automatically; this step applies dependency patches and
    builds every required Rust dependency from the extension's shipped
    `Cargo.lock` during consumer installation.

## Codex plugin

- `.codex-plugin/plugin.json` defines the Codex plugin manifest and user-facing metadata for this repo.
  - Keep the plugin description, default prompts, and declared capabilities aligned with the skills that are present under `skills/`.
- Workspace-local Codex config lives in `.codex/config.toml`

## Working rules

- Treat `agents/*` as the canonical source for the package-configured agent definitions. Do not hand-edit generated copies elsewhere.
- Do not reference package-configured agent definitions within skills or development documents
- All other helper-role prompts belong in the skill content that uses them. Do not promote new helper roles to available preconfigured agents unless they are explicitly part of the supported repo agent roster.
- Prefer small, targeted edits. This repo is mostly instruction content, so wording changes can have broad behavioral impact.

### Pi extensions

**Developer Practices**
- After any code change, run `npx tsc --noEmit` on new test files BEFORE committing (catches missing imports faster than test framework).
- Verify string lengths with `node -e 'process.stdout.write("...".length.toString())'` before writing test assertions (avoids off-by-one).
- Read `extensions/AGENTS.md` before changing the on-disk layout for a Pi extension package.
- `extensions/pi-headroom/` contains the v1 Headroom proxy/MCP Pi extension.
  Keep its loadable entrypoint, package metadata, config/routing helpers, and
  root `pi.extensions` entry aligned when changing it.

**Test hygiene**
- When using `write` for a new test file, check that all required vitest imports (`describe`, `it`, `expect`, `beforeEach`, `afterEach`) are present.
- Run the targeted test file first (`npx vitest run path/to/file.test.ts`) before running the full suite.

**Model-free Pi TUI testing**
- For a full-host render test, run interactive Pi in an isolated, fixed-size tmux session with no positional prompt or submitted editor input. Use `--offline --no-session` when session history is not under test, load the extension explicitly with `-e`, wait by polling `tmux capture-pane` for a stable sentinel, capture the pane, and always remove the tmux session during cleanup. Merely displaying a configured model in the footer does not invoke it.
- Set `PI_CODING_AGENT_DIR` to a temporary test directory so startup does not lock or mutate the real `~/.pi/agent` configuration. Pass `--approve` when the test intentionally loads project-local resources, and disable unrelated resource discovery where practical.
- Use a fixture JSONL session with `--session <fixture>` when the render needs existing user, assistant, or tool rows. Opening and rendering an existing session does not call a model unless the test also supplies or submits a prompt.
- Use `tmux send-keys` for keyboard input. For coordinate-sensitive mouse tests, inject the SGR mouse protocol bytes literally (for example, `tmux send-keys -l $'\e[<64;10;5M'`) and then capture the resulting frame.
- Pi's upstream `VirtualTerminal` test helper exposes `sendInput(data)`, which accepts both key sequences and raw SGR mouse packets, but the helper is test source and is not shipped by the published `pi-tui` package. Reuse or adapt the upstream helper with its terminal-emulator dependency rather than importing an unpublished package path.
- Current Pi `InteractiveMode` constructs `ProcessTerminal` internally, so replacing its terminal after construction is not a supported full-host harness. Prefer a real PTY/tmux integration test for the complete interactive host and direct `TUI` plus `VirtualTerminal` tests for components.
- `PI_STARTUP_BENCHMARK=1` initializes the interactive TUI and extensions, then exits before the input loop; it is suitable for startup-only smoke tests without a model call. `PI_TUI_WRITE_LOG=<path>` records raw ANSI output for diagnostics, but is output-only and requires terminal emulation to recover a screen frame. Prefer a live tmux pane when the assertion concerns the final visible screen or input response.

**Tools**
All extensions vendored by this repository must conform to the `ToolDefinition` interface from `@earendil-works/pi-coding-agent`'s `core/extensions/types`.

This is the authoritative shape:
```typescript
interface ToolDefinition<TParams extends TSchema, TDetails = unknown, TState = any> {
  /** Tool name (used in LLM tool calls) */
  name: string;
  /** Human-readable label for UI */
  label: string;
  /** Description for LLM */
  description: string;
  /** Optional one-line snippet for the Available tools section in the
   *  default system prompt. Custom tools are omitted from that section
   *  when this is not provided. */
  promptSnippet?: string;
  /** Optional guideline bullets appended to the default system prompt
   *  Guidelines section when this tool is active. */
  promptGuidelines?: string[];
  /** Parameter schema (TypeBox) */
  parameters: TParams;
  /** Controls whether ToolExecutionComponent renders the standard colored
   *  shell or the tool renders its own framing. */
  renderShell?: "default" | "self";
  /** Optional compatibility shim to prepare raw tool call arguments
   *  before schema validation. Must return an object conforming to TParams. */
  prepareArguments?: (args: unknown) => Static<TParams>;
  /** Per-tool execution mode override.
   *  - "sequential": this tool must execute one at a time with other tool calls.
   *  - "parallel": this tool can execute concurrently with other tool calls.
   *  If omitted, the default execution mode applies. */
  executionMode?: ToolExecutionMode; // "sequential" | "parallel"
  /** Execute the tool. */
  execute(
    toolCallId: string,
    params: Static<TParams>,
    signal: AbortSignal | undefined,
    onUpdate: AgentToolUpdateCallback<TDetails> | undefined,
    ctx: ExtensionContext,
  ): Promise<AgentToolResult<TDetails>>;
  /** Custom rendering for tool call display */
  renderCall?: (args, theme, context: ToolRenderContext<TState>) => Component;
  /** Custom rendering for tool result display */
  renderResult?: (result, options, theme, context: ToolRenderContext<TState>) => Component;
}
```

### Codex parity

- Keep `scripts/codex-bootstrap.py` aligned with the packaged agent roster in `agents/` and the plugin manifest in `.codex-plugin/plugin.json`.
- Keep custom-agent permission profiles runtime-safe for Codex. Avoid unsupported filesystem write globs such as `**/*.md`; use exact paths or supported subtree rules instead so the role can be applied at spawn time.

**Local Codex agent installation**
Handled by `scripts/codex-bootstrap.py`:
1. Registers the packaged `agents/{adversary,visuals,web}.toml` set into the selected Codex config file
2. Installs them into the matching `agents/` directory
3. Installs each packaged agent as a Codex profile at `$CODEX_HOME/<name>.config.toml`
4. Removes the older packaged specialist-agent configs that are no longer shipped
5. Stages the local plugin checkout under the selected Codex home
6. Upserts a marketplace entry without clobbering other plugins already present in the same marketplace file.

By default, use the documented personal marketplace at `~/.agents/plugins/marketplace.json` when the staged plugin path lives under `~`; otherwise fall back to a marketplace rooted at the selected Codex home. Use `--config-file` and `--agents-dir` when you need to target a non-default global or profile config.

### Validation

- There are no standard npm scripts configured at the repo root. Do not claim a generic test or lint pass unless you actually add and run one.
- Validate by reading the affected manifests and skill files for consistency:
  - skill paths exist and are spelled correctly
  - packaged agent config paths exist and the bootstrap-managed agent names match the repo roster
  - plugin manifest metadata matches the available skills
  - Pi package metadata matches bundled dependencies and published files
- For bootstrap changes, validate with:
  - `python3 -m py_compile scripts/codex-bootstrap.py`
  - `python3 scripts/codex-bootstrap.py --help`
  - `python3 scripts/codex-bootstrap.py --dry-run`
- If a task touches bundled Pi extensions, validate those behaviors in their source repositories rather than assuming this wrapper repo is enough.
- Test implementations that produce files shall do so in a temporary directory.
