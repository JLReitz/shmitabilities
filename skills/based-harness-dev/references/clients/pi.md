# Pi

Minimal, extensible agent harness written in TypeScript. Develop and package extensions with the `based-node-dev` skill.

Package repository: https://github.com/earendil-works/pi
Documentation: https://pi.dev/docs/latest

## Vocabulary

- **Extension:** A TypeScript or JavaScript module whose default factory registers Pi behavior.
- **Package:** An installable directory or npm package that contributes extensions, skills, prompts, or themes.
- **Interface:** Pi-facing registration and translation over a package's shared core.

## Agent directory

- User scope settings, state, and session data are under `~/.pi/agent/`.
- Installed Pi packages are within `~/.pi/npm/` or `~/.pi/git/`.
- Explore when needed for integration or debugging, do not modify its contents without approval.

## Project `.pi/` directory

Overrides or appends to user scope within workspace:
- settings.json
- mcp.json
- SYSTEM.md - replace system prompt
- APPEND_SYSTEM.md - append to system prompt
- extensions/
- skills/
- prompts/

## Project instructions and skills

Pi loads `AGENTS.md` context files from the working directory and its ancestors. It discovers project skills under `.agents/skills/` from the working directory through the repository root. Keep shared project instructions and skills at those paths; `.pi/skills/` is for Pi-specific skills. Pi requires project trust before loading project skills. Check the active context and invoke a known skill after starting Pi. Project trust authorizes project resource loading; it does not isolate extension code from the host process.

## Project MCP configuration

Pi reads `.pi/mcp.json` after the project is trusted. Run `pi mcp add --local <name> --url <app-url>/mcp` for a project-scoped remote server, then `pi mcp login <name>` when OAuth is required and `pi mcp list` to verify the connection. Inspect `.pi/mcp.json` before writing: a workspace may link it to a shared MCP configuration.

## Package configurations

### Package layout

Use `src/pi/index.ts` as the Pi entry when a capability core occupies `src/index.ts`, including the stock read example. In a union package, use `src/dsh/index.ts` as the DSH plugin source entry. Pi loads its TypeScript source entry. Import the local core through `../index.js` and the selected port implementation through its package root export; keep Pi registration under `src/pi/`. Use [Harness package development](../package-development.md) for the union layout, entry contracts, and manifest fragment. Pi discovers conventional `extensions/`, `skills/`, `prompts/`, and `themes/` directories when no explicit `pi` resource paths are declared; use the manifest paths shown below for this package layout.

```text
packages/<package-name>/
├── package.json
├── src/
│   ├── index.ts             # Public core API
│   ├── pi/
│   │   ├── index.ts         # Pi entry
│   │   └── register.ts
│   └── dsh/                 # Only when DSH is supported
│       ├── index.ts         # DSH plugin entry
│       └── register.ts
├── tests/
└── dist/                    # Built output for DSH when supported
```

`src/pi/index.ts` MUST NOT import the DSH entry or adapter, directly or through the core module. Pi should load its own entry with DSH host packages absent. Keep Pi-specific runtime imports under `src/pi/`; type-only imports in shared core signatures still couple the core to the client and are not permitted there.

### package.json template

Apply `based-node-dev` for shared Node.js fields. Add only the Pi fields the package uses to that manifest; remove unused fields and replace placeholder paths. Inspect the live `package.json` for current values.

```json
{
  "keywords": ["pi-package"],
  "files": ["src/", "dist/"],
  "exports": {
    "./core": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "scripts": {
    "prepare": "<build-command>"
  },
  "dependencies": {
    "@scope/filesystem-port": "<compatible-range>"
  },
  "peerDependencies": {
    "@earendil-works/pi-ai": "*",
    "@earendil-works/pi-agent-core": "*",
    "@earendil-works/pi-coding-agent": "*",
    "@earendil-works/pi-tui": "*",
    "typebox": "*"
  },
  "pi": {
    "extensions": ["./src/pi/index.ts"],
    "skills": ["<skill-directory>"],
    "prompts": ["<prompt-path>"],
    "themes": ["<theme-path>"],
    "image": "<gallery-image>",
    "video": "<gallery-video>"
  }
}
```

`pi.extensions` registers `src/pi/index.ts` when `src/index.ts` exposes a core API. Build `src/index.ts` to the public `./core` export and include its output in `files`. A Pi-only package without a separate public core API may use `src/index.ts` as its Pi entry. `pi.skills`, `pi.prompts`, and `pi.themes` declare skill directories, Markdown prompts, and JSON themes. These resource arrays accept paths, globs, and exclusions relative to the package root; list dot-prefixed or symlinked roots directly when glob traversal cannot reach them. `pi.image` and `pi.video` provide optional gallery previews, and the `pi-package` keyword makes a published package eligible for gallery discovery. Include `src/` and every required runtime asset in `files`. The read example keeps its core in `read-tool` and declares `filesystem-port` in `dependencies`; load the transport through its public export after its build is available. Declare only the Pi-provided packages actually imported in `peerDependencies` with the `"*"` range; Pi supplies those packages, so do not bundle them.

For a union package, use the combined manifest fragment in [Harness package development](../package-development.md): `pi.extensions` points at `./src/pi/index.ts`, and DSH's root export points at `./dist/dsh/index.js` built from `src/dsh/index.ts`. Include source, built output, resources, and the Cordis patch in `files`. Pi's host peers use `"*"`; DSH's shared host peers use a range verified against the selected DSH runtime. Check package contents with the package manager's dry-run pack command before publishing.

## Extension interface

Export a default factory that receives `ExtensionAPI` from `src/pi/index.ts` when `src/index.ts` exposes the core API; a Pi-only package without a separate public core API may use `src/index.ts` as its Pi entry. Register Pi commands, tools, events, and UI behavior at that boundary; translate host inputs into the core contract and translate core results back into Pi's tool and message shapes. Keep TypeBox schemas, Pi rendering components, session context, and Pi SDK imports out of the core module. Pi loads the extension in its own process with the same operating-system permissions; extensions can register through `pi.registerTool()`, `pi.registerCommand()`, and `pi.on()`.

For a union package, use this `src/pi/register.ts` adapter shape. Replace the illustrative read operation and model-facing text with the package's behavior; keep the port injectable so the adapter can be checked with the shared recording fake.

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { readText, type ReadPort } from "../index.js";
import { filesystemTextPort } from "@scope/filesystem-port";

export function registerPi(pi: ExtensionAPI, port: ReadPort = filesystemTextPort): void {
  pi.registerTool({
    name: "read_text_example",
    label: "Read text",
    description: "Read text from a path.",
    promptSnippet: "Read the complete UTF-8 contents of one file from a path.",
    promptGuidelines: [
      "Give read_text_example a nonempty path; relative paths resolve from the Pi process working directory.",
      "Read the file again after it changes; an earlier result is a snapshot of the previous content.",
    ],
    parameters: Type.Object({ path: Type.String() }),
    async execute(_toolCallId, params, signal) {
      const result = await readText({ source: params.path }, port, signal);
      return {
        content: [{ type: "text", text: result.text }],
        details: result,
      };
    },
  });
}
```

Use this `src/pi/index.ts` entry for a package with a public core API. A Pi-only package without such an API may place the factory in `src/index.ts` and register that path in `pi.extensions`.

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerPi } from "./register.js";

export default function activatePi(pi: ExtensionAPI): void {
  registerPi(pi);
}
```

Pi's tool `execute` receives the model call ID, validated TypeBox parameters, an optional `AbortSignal`, an optional progress callback, and an `ExtensionContext`; the example uses the first three. Tool results require model-facing `content` and `details`. Throw for an execution failure; use a result with `isError: true` only when failed output must retain structured data. The adapter MUST pass cancellation through to the core and keep model-facing text bounded for potentially large results.

For adapter unit tests, a minimal registration fake can capture the tool definition while the shared port fake records core calls. Keep the cast inside test code; production code uses Pi's exported types.

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export function createPiRegistrationMock(): {
  pi: ExtensionAPI;
  definitions: unknown[];
} {
  const definitions: unknown[] = [];
  const pi = {
    registerTool: (definition: unknown): void => {
      definitions.push(definition);
    },
  } as unknown as ExtensionAPI;
  return { pi, definitions };
}
```

After `registerPi(pi, port)`, invoke the captured definition with a representative path and `AbortSignal`; assert its model-facing content, the port's recorded source and signal, and the failed-call behavior. Then run a real Pi load because this fake does not exercise Pi's loader, schema validation, or lifecycle.

Pi waits for an asynchronous factory during startup. Register startup capabilities in the factory, but start long-lived processes, sockets, watchers, and timers at `session_start` or at the command or tool that needs them. Release session resources in an idempotent `session_shutdown` handler. Treat extension reload as replacement of the runtime, and do not reuse state from before `ctx.reload()`.

## Shared capability contract

Define client-neutral input, output, error, and cancellation behavior in the stock capability's public core module. Let other capability packages extend those public contracts and choose implementations of explicit core-defined ports. Map Pi's `AbortSignal`, streaming updates, and tool result content at the Pi boundary; preserve cancellation and failure meaning rather than reshaping a host-specific result inside the core. Share only capabilities with equivalent behavior in both clients, and document a Pi-only behavior in the package README.

## Package validation

Test the core in `read-tool` and the selected port package directly, then load the path declared by `pi.extensions` through Pi with only the Pi runtime available. Verify that extension registration succeeds, a representative tool or command calls the core, cancellation and failures reach the expected Pi result, and unload releases resources. Check `pi.extensions` paths, included assets, host peer declarations, and the packed file list. For a union package, also load its built root entry in DSH with only DSH host dependencies available; this catches eager Pi imports and entry-point drift. Use the installed Pi API declarations for exact event and tool shapes.

## Extension tools

Register tools with the installed `@earendil-works/pi-coding-agent` `ToolDefinition` type in `core/extensions/types`. Check the installed declaration before adding a field because Pi releases can add fields. The `registerPi` example above supplies every required field: `name`, `label`, `description`, `parameters`, and `execute`. `promptSnippet` places the one-line tool summary in the default prompt's Available tools section; omit it and that section omits the custom tool. `promptGuidelines` adds bullets to the default prompt's Guidelines section while the tool is active.

Write `promptSnippet` as one line that identifies the tool's distinctive capability. Use `promptGuidelines` for instructions that change how the model chooses or calls the tool: when to prefer it over a related tool, required prior steps and call order, exact argument or output syntax, when prior results become stale, write or preview behavior, known limits, and recovery after a rejected call. Use exact tool, parameter, and output names. Verify each instruction against the implementation and parameter schema. Include only applicable guidance; do not repeat the description or set a fixed number of bullets.

The following fragments are separate options for the tool definition in `registerPi`. Add only fields that the tool needs.

`renderShell` chooses the standard colored shell (`"default"`) or makes custom renderers responsible for their own framing (`"self"`). `renderCall` controls the call display; `renderResult` controls the result display. Import `Text` from `@earendil-works/pi-tui` when using these renderers.

```typescript
renderShell: "self",
renderCall(args, theme, _context) {
  return new Text(theme.fg("accent", `Read ${args.path}`), 0, 0);
},
renderResult(_result, { isPartial }, theme, context) {
  const text = isPartial ? "Reading..." : context.isError ? "Read failed" : "Read complete";
  return new Text(theme.fg(context.isError ? "error" : "success", text), 0, 0);
},
```

`prepareArguments` converts legacy raw arguments before TypeBox validates them. Return the declared parameter shape; keep normal validation and error handling in the tool.

```typescript
prepareArguments(args) {
  const raw = args && typeof args === "object" ? args as Record<string, unknown> : {};
  return { path: typeof raw.path === "string" ? raw.path : typeof raw.file === "string" ? raw.file : "" };
},
```

`executionMode: "sequential"` serializes this tool with other tool calls. `"parallel"` permits concurrent calls. Omit the field to use Pi's current default.

```typescript
executionMode: "sequential",
```

## Interactive terminal renders

Run a full-host Pi render in an isolated, fixed-size tmux pane. Start Pi without a positional prompt or submitted editor input. Use `--offline --no-session` when session history is outside the test, load the extension with `-e`, and set `PI_CODING_AGENT_DIR` to a temporary directory. Use `--approve` when the test loads project-local resources. Poll `tmux capture-pane` for a stable sentinel, capture the frame, and remove the tmux session during cleanup. Displaying a model in the footer does not send a request to it.

Use a fixture JSONL session with `--session` when the render needs existing transcript rows. An opened session does not call a model until the test submits a prompt. Use `tmux send-keys` for key input. Send literal SGR mouse bytes for coordinate-sensitive mouse tests and capture the next frame.

For component tests, drive `TUI` through a virtual terminal helper. Pi's upstream `VirtualTerminal.sendInput(data)` accepts keys and raw SGR mouse packets, but the helper is test source rather than a published `pi-tui` path. Reuse that helper with its terminal emulator instead of importing an unpublished path. The installed `InteractiveMode` constructs `ProcessTerminal` internally; use a real PTY or tmux for complete host tests.

`PI_STARTUP_BENCHMARK=1` exits after interactive startup and extension initialization. Use it for a startup smoke check. `PI_TUI_WRITE_LOG` records raw ANSI output; reconstruct the screen with a terminal emulator when asserting visible state. A live tmux pane directly shows the final frame and input response.
