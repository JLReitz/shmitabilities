# Harness package development

Treat a capability package as one client-facing feature with a reusable core and separate client interfaces in the same package. Supply external operations through independently packaged port implementations. Apply `based-node-dev` to Node.js configuration, TypeScript source, and tests. Keep registration, lifecycle, schemas, rendering, and host API calls in client interfaces.

## Modular package layout

Package reusable parts by their responsibility. A port package implements a core-defined interface for an external operation. Ports can provide filesystem access, network requests, clocks, process execution, or persistent state. The stock capability package contains business logic, the port contracts it accepts, and client interfaces. Other capability packages import its public core API to add behavior or interfaces. Give each package its own name, manifest, build, tests, and README; expose importable core and port APIs through `src/index.ts`.

This stock read example combines read logic with the basic read tool in `read-tool`. `packages/network-port/` can replace the filesystem implementation of `ReadPort` for another capability without changing the stock read core. These transport implementations illustrate the port layer; other cores can define ports for time, process execution, or state.

```text
packages/
├── filesystem-port/
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
    ├── src/
    │   ├── index.ts          # Public read contract and business logic
    │   ├── dsh/
    │   │   ├── index.ts      # DSH plugin source entry
    │   │   └── register.ts
    │   └── pi/
    │       ├── index.ts      # Pi extension entry
    │       └── register.ts
    ├── tests/
    │   └── mocks/
    │       └── read-port.ts
    └── dist/
        ├── index.js          # Built public core subpath
        ├── index.d.ts
        └── dsh/
            ├── index.js     # Built DSH package root entry
            └── index.d.ts
```

The basic read tool's Pi and DSH interfaces import their package's core from `../index.js` and a selected `ReadPort` implementation from `filesystem-port`. The core imports neither a port implementation nor a client SDK. A port implementation can serve several capabilities when its public operations fit their contracts. A new capability can import `@scope/read-tool/core`, choose a port implementation, add business rules around the public API, and define its own tool interface or presentation. Capability packages may support Pi, DSH, or both. Keep `src/index.ts` as the public core entry when a capability exposes reusable logic, even if it supports only Pi.

Port packages expose `src/index.ts` to import consumers through compiled root exports. A component with a command adds `src/cli.ts`, calls its own public `src/index.ts` API, builds `dist/cli.js`, and maps `bin` to that file. Keep CLI argument parsing and process exit behavior out of the import API. Build and install each imported port before a client loads the capability package.

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

Import the local core API and selected port implementations from both adapters. Configure the build to emit `dist/index.js` and its declaration from `src/index.ts`, plus `dist/dsh/index.js` from `src/dsh/index.ts`. Keep port package imports external and ship the Pi TypeScript source entry. Check that each host loads with the other client's SDK absent.

## Stock read core contract

Expose read behavior and the transport shape through `packages/read-tool/src/index.ts`. The core validates the request and delegates retrieval through a supplied port. It accepts a filesystem or network implementation without importing either one.

```typescript
export interface ReadRequest {
  source: string;
}

export interface ReadResult {
  text: string;
}

export interface ReadPort {
  readText(source: string, signal?: AbortSignal): Promise<string>;
}

export async function readText(
  request: ReadRequest,
  port: ReadPort,
  signal?: AbortSignal,
): Promise<ReadResult> {
  if (request.source.trim() === "") throw new Error("source is required");
  return { text: await port.readText(request.source, signal) };
}
```

The core MUST NOT import client SDKs, Cordis context, TypeBox, UI components, or a concrete port package. Document the read contract's result, failure, and cancellation behavior. Another capability can extend `ReadRequest` and call `readText()` before adding its own logic. This example belongs in `packages/filtered-read-tool/src/index.ts`:

```typescript
import { readText, type ReadPort, type ReadRequest } from "@scope/read-tool/core";

export interface FilteredReadRequest extends ReadRequest {
  contains: string;
}

export async function readMatchingLines(
  request: FilteredReadRequest,
  port: ReadPort,
  signal?: AbortSignal,
): Promise<string[]> {
  const { text } = await readText(request, port, signal);
  return text.split("\n").filter((line) => line.includes(request.contains));
}
```

The `filtered-read-tool` package imports the public `read-tool/core` subpath and whichever transport it selects. Its Pi and DSH adapters can define different tool schemas and presentation while sharing the stock read and filter behavior.

## Port implementations

The read example needs a `ReadPort` implementation. Expose filesystem access through `packages/filesystem-port/src/index.ts`. A network transport may expose the same `readText(source, signal)` shape from `packages/network-port/src/index.ts`. The core's structural `ReadPort` interface accepts either implementation. Keep path, URL, authorization, encoding, and protocol policy in the implementation that owns them. For other core contracts, implement the required clock, process, state, or other external operation in a separate port package.

```typescript
import { readFile } from "node:fs/promises";

export const filesystemTextPort = {
  readText: (source: string, signal?: AbortSignal): Promise<string> =>
    readFile(source, { encoding: "utf8", signal }),
};
```

A network transport can satisfy the same core contract through `packages/network-port/src/index.ts`:

```typescript
export const networkTextPort = {
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

A port package's `src/index.ts` is callable by import consumers and by its optional CLI. `packages/filesystem-port/src/cli.ts` can provide a direct transport command without depending on `read-tool`:

```typescript
#!/usr/bin/env node
import { filesystemTextPort } from "./index.js";

const source = process.argv[2];
if (source === undefined) throw new Error("source is required");
process.stdout.write(await filesystemTextPort.readText(source));
```

The same pattern applies when an operation moves no data between systems. For example, a scheduling capability can define this contract in its public `src/index.ts` core entry:

```typescript
export interface ClockPort {
  now(): Date;
}
```

The `packages/system-clock-port/src/index.ts` entry implements it with the system clock:

```typescript
export const systemClockPort = {
  now: (): Date => new Date(),
};
```

Keep the `ClockPort` contract in the capability core and package reusable implementations independently. Apply the same boundary to process execution, persistent state, and other external operations.

## Package exports

Build and publish reusable port packages independently. Apply `based-node-dev` to their common fields and use these entry fields for an importable port package:

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

An installable CLI file needs a Node shebang and executable packaging behavior verified against the selected build tool and package manager. Import consumers use the port package root export. The stock capability uses a public `./core` subpath for its core API while its root export loads DSH. Do not require private `src/` paths. Inspect the published file list and install each package alone to verify its declared exports and dependencies.

## Mock port

Use a recording fake to verify that each adapter passes validated arguments and the host's cancellation signal to the read core. This illustrative file is `packages/read-tool/tests/mocks/read-port.ts`.

```typescript
import type { ReadPort } from "../../src/index.js";

export interface ReadCall {
  source: string;
  signal?: AbortSignal;
}

export function createReadPort(text: string): {
  port: ReadPort;
  calls: ReadCall[];
} {
  const calls: ReadCall[] = [];
  return {
    calls,
    port: {
      async readText(source, signal) {
        calls.push({ source, signal });
        if (signal?.aborted) throw signal.reason;
        return text;
      },
    },
  };
}
```

Test the core in `read-tool` with this port and test each port implementation against its public contract. Then load each adapter through its real client when a capability adds model-visible or user-visible behavior.

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
  "files": ["src/", "dist/", "cordis.patch.yml"],
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
    "@scope/filesystem-port": "<compatible-range>",
    "@deepseek-ai/dsh-tools": "<compatible-range>"
  },
  "devDependencies": {
    "@deepseek-ai/cordis": "<same-range>",
    "@deepseek-ai/dsh-system-prompt": "<compatible-range>"
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

Pi loads `src/pi/index.ts` as TypeScript source. DSH loads built JavaScript from `src/dsh/index.ts` through the package root export at `dist/dsh/index.js`. Import consumers use `@scope/read-tool/core`, which exposes built JavaScript and types from `src/index.ts`. The example `read-tool` package declares `filesystem-port` in `dependencies`; build or install it before either client loads its entry. `peerDependenciesMeta` marks each client host peer optional to package managers, so installing under one host does not pull in the other; each entry still requires its own host at runtime. The example's `@deepseek-ai/dsh-tools` dependency supports `defineTool`; its `@deepseek-ai/dsh-system-prompt` development dependency supplies the prompt service type augmentation. Inspect the selected DSH release before choosing ranges and remove either package when the DSH interface does not use it. Do not bundle a second physical copy of a host SDK. Use the client references for each host's additional resource and dependency fields. Inspect the packed file list, then load each entry with the other client's SDK absent to detect accidental cross-client imports.

## Completion criteria

- The package README states its capability, supported clients, configuration, install steps, and any client-specific behavior.
- The stock capability publishes a working `./core` export and declarations; each port package publishes a working root export and declarations; the core has no client or concrete-port imports; each capability interface owns its schema, registration, lifecycle, and result mapping.
- Both manifest entries and the DSH patch resolve to shipped files; the selected Pi and DSH versions load their respective interfaces.
- Core tests cover behavior and cancellation; each concrete port implementation passes its contract checks; each implemented client has a real host integration check for registration, result, failure, and cleanup.
