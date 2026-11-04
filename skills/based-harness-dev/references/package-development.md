# Harness package development

Treat a capability package as one client-facing feature with a reusable core and separate client interfaces in the same package. Supply external operations through independently packaged component implementations. Apply `based-node-dev` to Node.js configuration, TypeScript source, and tests. Keep registration, lifecycle, schemas, rendering, and host API calls in client interfaces.

## Modular package layout

Package reusable parts by their responsibility. A component package implements a core-defined interface for an external operation. Components can provide filesystem access, network requests, clocks, process execution, or persistent state. The stock capability package contains business logic, the interfaces it accepts, and client interfaces. Other capability packages import its public core API to add behavior or interfaces. Give each package its own name, manifest, build, tests, and README; expose importable core and component APIs through `src/index.ts`.

This stock read example combines read logic with the basic read tool in `read-tool`. `packages/network/` can replace the filesystem implementation of `TextReader` for another capability without changing the stock read core. These implementations illustrate component packages; other cores can define interfaces for time, process execution, or state.

```text
packages/
├── filesystem/
│   ├── package.json
│   ├── README.md
│   ├── tests/
│   ├── src/
│   │   ├── index.ts          # Public filesystem transport
│   │   └── cli.ts            # Optional direct transport command
│   └── dist/
│       ├── index.js
│       └── index.d.ts
└── read-tool/
    ├── package.json
    ├── README.md
    ├── cordis.patch.yml      # Only for a DSH bundle
    ├── plugin.json            # Only for a portable Codex plugin
    ├── mcp.json               # Only for a Codex MCP server
    ├── skills/                # Only for packaged agent workflows
    ├── src/
    │   ├── index.ts          # Public read contract and business logic
    │   ├── dsh/
    │   │   ├── index.ts      # DSH plugin source entry
    │   │   └── register.ts
    │   ├── pi/
    │   │   ├── index.ts      # Pi extension entry
    │   │   └── register.ts
    │   └── codex/
    │       └── server.ts     # Codex stdio MCP entry
    ├── tests/
    │   └── mocks/
    │       └── text-reader.ts
    └── dist/
        ├── index.js          # Built public core subpath
        ├── index.d.ts
        ├── codex/
        │   └── server.js     # Built Codex MCP server
        └── dsh/
            ├── index.js     # Built DSH package root entry
            └── index.d.ts
```

The basic read tool's Pi, DSH, and Codex interfaces use the same core and a selected `TextReader` implementation from `filesystem`. The core imports neither a component implementation nor a client SDK. A component implementation can serve several capabilities when its public operations fit their contracts. A new capability can import `@scope/read-tool/core`, choose a component implementation, add business rules around the public API, and define its own tool interface or presentation. Capability packages may support Pi, DSH, Codex, or a selected subset. Keep `src/index.ts` as the public core entry when a capability exposes reusable logic.

Component packages expose `src/index.ts` to import consumers through compiled root exports. A component with a command adds `src/cli.ts`, calls its own public `src/index.ts` API, builds `dist/cli.js`, and maps `bin` to that file. Keep CLI argument parsing and process exit behavior out of the import API. Build and install each imported component before a client loads the capability package.

## Client entry contracts

Pi expects a default factory that receives `ExtensionAPI`. Its entry is `src/pi/index.ts` when `src/index.ts` exposes the public core API. Keep Pi imports in that entry and the Pi adapter; do not import the DSH entry or adapter. The separate [Pi reference](clients/pi.md) supplies a complete tool registration example.

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerPi } from "./register.js";

export default function activatePi(pi: ExtensionAPI): void {
  registerPi(pi);
}
```

DSH function plugins expose named `name`, `inject`, and `apply` exports from `src/dsh/index.ts`. DSH's Loader selects a default export before the named plugin namespace, so do not default-export a Pi factory from this file. Keep DSH imports in the DSH entry and adapter. The separate [DSH reference](clients/dsh.md) supplies a complete function plugin and tool registration example.

```typescript
import type { Context } from "@deepseek-ai/cordis";
import { registerDsh } from "./register.js";

export const name = "example-reader";
export const inject = ["tools", "systemPrompt"];

export function apply(ctx: Context): void {
  registerDsh(ctx);
}
```

Codex loads a plugin from the package root. A portable `plugin.json` and `mcp.json` start the built `src/codex/server.ts` stdio MCP server, which registers the equivalent tool and calls the shared core and selected component. Put workflow instructions under `skills/`; add hooks only for a required Codex lifecycle event. Use the [Codex reference](clients/codex.md) for manifest and server configuration.

Import the local core API and selected component implementations from each adapter. Build `dist/index.js` and its declaration from `src/index.ts`, plus the selected client entries. Keep component package imports external for Pi and DSH. Bundle Codex server runtime dependencies or verify they resolve from the installed plugin root; the Codex npm plugin installer skips lifecycle scripts. Ship the Pi TypeScript source entry when Pi is supported. Check that each host loads with the other clients' SDKs absent.

## Stock read core contract

Expose read behavior and the reader interface through `packages/read-tool/src/index.ts`. The core validates the request and delegates retrieval through a supplied reader. It accepts a filesystem or network implementation without importing either one.

```typescript
export interface ReadRequest {
  source: string;
}

export interface ReadResult {
  text: string;
}

export interface TextReader {
  readText(source: string, signal?: AbortSignal): Promise<string>;
}

export async function readText(
  request: ReadRequest,
  reader: TextReader,
  signal?: AbortSignal,
): Promise<ReadResult> {
  if (request.source.trim() === "") throw new Error("source is required");
  return { text: await reader.readText(request.source, signal) };
}
```

The core MUST NOT import client SDKs, Cordis context, TypeBox, UI components, or a concrete component package. Document the read contract's result, failure, and cancellation behavior. Another capability can extend `ReadRequest` and call `readText()` before adding its own logic. This example belongs in `packages/filtered-read-tool/src/index.ts`:

```typescript
import { readText, type TextReader, type ReadRequest } from "@scope/read-tool/core";

export interface FilteredReadRequest extends ReadRequest {
  contains: string;
}

export async function readMatchingLines(
  request: FilteredReadRequest,
  reader: TextReader,
  signal?: AbortSignal,
): Promise<string[]> {
  const { text } = await readText(request, reader, signal);
  return text.split("\n").filter((line) => line.includes(request.contains));
}
```

The `filtered-read-tool` package imports the public `read-tool/core` subpath and whichever transport it selects. Its Pi and DSH adapters can define different tool schemas and presentation while sharing the stock read and filter behavior.

## Component implementations

The read example needs a `TextReader` implementation. Expose filesystem access through `packages/filesystem/src/index.ts`. A network transport may expose the same `readText(source, signal)` shape from `packages/network/src/index.ts`. The core's structural `TextReader` interface accepts either implementation. Keep path, URL, authorization, encoding, and protocol policy in the implementation that owns them. For other core contracts, implement the required clock, process, state, or other external operation in a separate component package.

```typescript
import { readFile } from "node:fs/promises";

export const filesystemTextReader = {
  readText: (source: string, signal?: AbortSignal): Promise<string> =>
    readFile(source, { encoding: "utf8", signal }),
};
```

A network transport can satisfy the same core contract through `packages/network/src/index.ts`:

```typescript
export const networkTextReader = {
  async readText(source: string, signal?: AbortSignal): Promise<string> {
    const url = new URL(source);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("HTTP or HTTPS URL is required");
    }
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
  },
};
```

A component package's `src/index.ts` is callable by import consumers and by its optional CLI. `packages/filesystem/src/cli.ts` can provide a direct transport command without depending on `read-tool`:

```typescript
#!/usr/bin/env node
import { filesystemTextReader } from "./index.js";

const source = process.argv[2];
if (source === undefined) throw new Error("source is required");
process.stdout.write(await filesystemTextReader.readText(source));
```

The same pattern applies when an operation moves no data between systems. For example, a scheduling capability can define this contract in its public `src/index.ts` core entry:

```typescript
export interface Clock {
  now(): Date;
}
```

The `packages/system-clock/src/index.ts` entry implements it with the system clock:

```typescript
export const systemClock = {
  now: (): Date => new Date(),
};
```

Keep the `Clock` contract in the capability core and package reusable implementations independently. Apply the same boundary to process execution, persistent state, and other external operations.

## Package exports

Build and publish reusable component packages independently. Apply `based-node-dev` to their common fields and use these entry fields for an importable component package:

```json
{
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "files": ["dist/"]
}
```

Add the optional CLI mapping only when `src/cli.ts` exists:

```json
{
  "bin": {
    "<command-name>": "./dist/cli.js"
  }
}
```

An installable CLI file needs a Node shebang and executable packaging behavior verified against the selected build tool and package manager. Import consumers use the component package root export. The stock capability uses a public `./core` subpath for its core API while its root export loads DSH. Do not require private `src/` paths. Inspect the published file list and install each package alone to verify its declared exports and dependencies.

## Mock reader

Use a recording fake to verify that each adapter passes validated arguments and the host's cancellation signal to the read core. This illustrative file is `packages/read-tool/tests/mocks/text-reader.ts`.

```typescript
import type { TextReader } from "../../src/index.js";

export interface ReadCall {
  source: string;
  signal?: AbortSignal;
}

export function createTextReader(text: string): {
  reader: TextReader;
  calls: ReadCall[];
} {
  const calls: ReadCall[] = [];
  return {
    calls,
    reader: {
      async readText(source, signal) {
        calls.push({ source, signal });
        if (signal?.aborted) throw signal.reason;
        return text;
      },
    },
  };
}
```

Test the core in `read-tool` with this fake reader and test each component implementation against its public contract. Then load each adapter through its real client when a capability adds model-visible or user-visible behavior.

## Union manifest fragment

Merge this fragment with the baseline `package.json` from `based-node-dev`. Replace placeholders with values inspected from the selected clients and the package build. Add only the host peers actually imported and include every required source, build, patch, and resource path in `files`.

```json
{
  "keywords": ["pi-package"],
  "main": "./dist/dsh/index.js",
  "types": "./dist/dsh/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/dsh/index.d.ts",
      "default": "./dist/dsh/index.js"
    },
    "./core": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "files": ["src/", "dist/", "cordis.patch.yml", "plugin.json", "mcp.json", "skills/"],
  "scripts": {
    "prepare": "<build-command>"
  },
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "*",
    "typebox": "*",
    "@deepseek-ai/cordis": "<compatible-range>"
  },
  "peerDependenciesMeta": {
    "@earendil-works/pi-coding-agent": {
      "optional": true
    },
    "typebox": {
      "optional": true
    },
    "@deepseek-ai/cordis": {
      "optional": true
    }
  },
  "dependencies": {
    "@scope/filesystem": "<compatible-range>",
    "@deepseek-ai/dsh-tools": "<compatible-range>"
  },
  "devDependencies": {
    "@deepseek-ai/cordis": "<same-range>",
    "@deepseek-ai/dsh-system-prompt": "<compatible-range>",
    "@modelcontextprotocol/sdk": "<compatible-range>",
    "zod": "<compatible-range>"
  },
  "pi": {
    "extensions": ["./src/pi/index.ts"]
  },
  "dsh": {
    "bundle": {
      "patch": "./cordis.patch.yml"
    }
  }
}
```

Pi loads `src/pi/index.ts` as TypeScript source. DSH loads built JavaScript from `src/dsh/index.ts` through the package root export at `dist/dsh/index.js`. Import consumers use `@scope/read-tool/core`, which exposes built JavaScript and types from `src/index.ts`. The example `read-tool` package declares `filesystem` in `dependencies`; build or install it before either client loads its entry. `peerDependenciesMeta` marks each client host peer optional to package managers, so installing under one host does not pull in the other; each entry still requires its own host at runtime. The example's `@deepseek-ai/dsh-tools` dependency supports `defineTool`; its `@deepseek-ai/dsh-system-prompt` development dependency supplies the prompt service type augmentation. Inspect the selected DSH release before choosing ranges and remove either package when the DSH interface does not use it. Do not bundle a second physical copy of a host SDK. Use the client references for each host's additional resource and dependency fields. Inspect the packed file list, then load each entry with the other client's SDK absent to detect accidental cross-client imports.

For Codex support, `plugin.json` and `mcp.json` sit beside `package.json`. The installed plugin starts `dist/codex/server.js` through `mcp.json`. Include built code, bundled dependencies, and optional skill and hook files in `files`; remove unused Codex entries when the package does not support Codex. Prebuild before packing, and verify the installed copy instead of assuming it resolves sibling workspace packages.

Use `@modelcontextprotocol/sdk` and a schema library such as `zod` to build the Codex tool interface. The fragment lists them as development dependencies for a bundled server; if the build leaves either as a runtime import, declare it as a runtime dependency and verify that the Codex installer provides it in the installed plugin root. The stdio process starts with the plugin directory as `cwd`, so normalize workspace-relative sources at the adapter or require an explicit workspace base.

Tool behavior can match across clients: the core request, result, failure, and cancellation contract stays shared while Pi, DSH, and Codex translate their own schemas and results. Guidance can match through a Codex skill, Pi tool guidance, and a DSH prompt section. Pi terminal renders and DSH browser modules remain client-specific presentation; use MCP text or structured results for Codex and state any presentation difference in the package README.

## Completion criteria

- The package README states its capability, supported clients, configuration, install steps, and any client-specific behavior.
- The stock capability publishes a working `./core` export and declarations; each component package publishes a working root export and declarations; the core has no client or concrete-component imports; each capability interface owns its schema, registration, lifecycle, and result mapping.
- Each selected client entry resolves to shipped files; the selected Pi, DSH, and Codex versions load their respective interfaces.
- Core tests cover behavior and cancellation; each concrete component implementation passes its contract checks; each implemented client has a real host integration check for registration, result, failure, and cleanup.
