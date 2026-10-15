# DeepSeek Harness

DeepSeek Harness (DSH) composes Cordis plugins through configuration layers. Develop installable packages with `based-node-dev`, and inspect the selected DSH version before using a host API or manifest field.

Package repository: https://github.com/deepseek-ai/deepseek-harness
Documentation: https://deepseek-harness.github.io/deepseek-harness/

## Vocabulary

- **Plugin:** A module whose `apply` function receives a Cordis `Context` and registers behavior.
- **Bundle:** An installable package whose `dsh.bundle` manifest contributes a configuration patch.
- **Profile:** A runnable composition that lists bundles and its own configuration.
- **Service:** A capability available through `ctx` and declared by consumers through `inject`.
- **Interface:** DSH-facing registration and translation over a package's shared core.

## Agent directory

Profiles live under `$DSH_HOME/profiles/<name>/`; inspect the selected DSH installation for its active home and profile instead of assuming a particular account path. An installed profile holds dependencies and its `dsh.profile.bundles` roster. Keep package source and its build outside that mutable profile, then install or link the package into a profile for integration checks. `dsh plugin --profile <name> add <package-path>` installs a local bundle into that profile; inspect its resulting roster before booting.

## Project configuration

A local `cordis.yml` or `cordis.patch.yml` can mount a development plugin through a patch supplied to `dsh web --patch`. A patch contributes configuration while module paths still resolve from the profile's loader context, so use a verified absolute path for a local TypeScript entry. For a distributed bundle, ship the patch inside the package and refer to the built package entry by its package specifier. Inspect the composed configuration with `dsh --profile <name> --dump-config` before booting the profile. A local development patch uses an `insert` row with a stable `id` and an absolute source path as `name`; a distributed bundle row uses the installed package name.

## Package configurations

### Package layout

Use `src/dsh/index.ts` as the source entry point for the DSH host plugin. Build it to `dist/dsh/index.js` for installation; point `main` and `exports["."]` at that built entry. Import the local core through `../index.js` and the selected port implementation through its package root export; keep DSH registration in `src/dsh/`. In a union package, Pi loads a separate `src/pi/index.ts` entry through `pi.extensions`; the DSH entry keeps its named function-plugin exports. A browser module belongs under `src/client/` and needs its own built `./client` export in DSH's lazy CJS client-module format. Use [Harness package development](../package-development.md) for the union layout and manifest fragment. Verify that the selected DSH version's client loader accepts the produced bundle before publishing.

```text
packages/<package-name>/
├── package.json
├── cordis.patch.yml        # Only for an installable DSH bundle
├── src/
│   ├── index.ts             # Public core API
│   ├── dsh/
│   │   ├── index.ts         # DSH plugin entry
│   │   └── register.ts
│   ├── pi/
│   │   ├── index.ts         # Only when Pi is supported
│   │   └── register.ts
│   └── client/              # Only for a DSH browser module
├── tests/
└── dist/
    └── dsh/
        └── index.js         # Built DSH package root entry
```

`src/dsh/index.ts` MUST NOT default-export a Pi factory or import the Pi entry or adapter, directly or through the core module. DSH should load its built entry with Pi host packages absent. Keep DSH-specific runtime imports under `src/dsh/` and the root plugin entry; type-only imports in shared core signatures still couple the core to the client and are not permitted there. DSH's Loader selects a default export before named exports, so a default export would hide the named function-plugin namespace, including `apply` and `inject`.

### package.json template

Apply `based-node-dev` for shared Node.js fields. Add only the DSH fields the package uses to that manifest; remove unused fields and replace placeholder paths and package names. Inspect the selected DSH version's manifest parser before adding a field.

```json
{
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
    },
    "./client": "<built-web-client-entry>"
  },
  "files": ["dist/", "cordis.patch.yml"],
  "scripts": {
    "prepare": "<build-command>"
  },
  "peerDependencies": {
    "@deepseek-ai/cordis": "<compatible-range>"
  },
  "dependencies": {
    "@scope/filesystem-port": "<compatible-range>",
    "@deepseek-ai/dsh-tools": "<compatible-range>"
  },
  "devDependencies": {
    "@deepseek-ai/cordis": "<same-range>",
    "@deepseek-ai/dsh-system-prompt": "<compatible-range>"
  },
  "dsh": {
    "bundle": {
      "patch": "./cordis.patch.yml"
    },
    "client": {
      "platform": "web",
      "inject": ["<package-name>"],
      "external": ["<module-specifier>"],
      "immediately": false
    }
  }
}
```

`main` and `exports["."]` expose JavaScript built from `src/dsh/index.ts`; `exports["./core"]` exposes the client-neutral API built from `src/index.ts`; `exports["./client"]` exposes a built browser module only when one exists. `files` includes every built entry, declaration, patch, and runtime asset; a union package also includes `src/` for Pi's TypeScript loader. Declare `@deepseek-ai/cordis` and other host-provided packages whose identity must be shared with DSH in matching `peerDependencies` and `devDependencies`. The read example keeps its core in `read-tool`, declares `filesystem-port` in `dependencies`, and builds that transport before DSH loads the plugin; the example uses `@deepseek-ai/dsh-tools` for `defineTool`. The prompt example's type-only import needs `@deepseek-ai/dsh-system-prompt` during development; remove that dependency when no prompt section is used. Add `scripts.prepare` when a source install must build before loading, and check the selected package manager's install-script policy.

`dsh.bundle.patch` names one Cordis patch file or an ordered list of files that registers plugin rows when the bundle is enabled. `dsh.client.platform` is `web` for a browser interface and requires `exports["./client"]`. `dsh.client.inject` names package dependencies for client module arrival; Cordis service injection controls plugin activation. `dsh.client.external` names exact non-baseline module requests for verified infrastructure or shared module identities. `dsh.client.immediately` marks infrastructure for early prefetch. A library without `dsh.bundle` contributes no configuration layer; `dsh.profile` belongs to a runnable profile rather than a distributed bundle.

For a published bundle, use a stable plugin row ID and the installed package name in `cordis.patch.yml`; replace the placeholder with the live `name` from `package.json`:

```yaml
- insert:
    - id: <plugin-row-id>
      name: <package-name>
```

Bundle patches are applied in profile roster order, followed by the profile patch, the home patch, and command-line overlays. A later patch can replace the row's entire `config` value, so a patch that overrides a row must supply every required config key. Verify the composed result with `--dump-config`.

For a union package, use the combined manifest fragment in [Harness package development](../package-development.md): `pi.extensions` points at `./src/pi/index.ts`, and DSH's root export points at `./dist/dsh/index.js` built from `src/dsh/index.ts`. Include source, build output, patch, and Pi resources in `files`; do not apply Pi's `"*"` host peer rule to DSH host peers. Inspect the package manager's dry-run pack file list and confirm each manifest path exists before publishing.

## Plugin interface

Export named `name`, `inject`, and `apply(ctx: Context)` from `src/dsh/index.ts` for both DSH-only and union packages. Mount tools, events, and services from `src/dsh/`. `inject` delays application until its required services are ready. DSH provides capabilities such as `tools`, `llm`, and `agents` as services on `ctx`; declare each required service in `inject` before using its context property. Translate host inputs to the shared core contract and map core results to DSH's public tool and event shapes. Keep Cordis context, DSH tool definitions, UI modules, and service keys out of the reusable core module.

Use this `src/dsh/index.ts` signature for a function plugin in either package layout. Replace the example name with the package's registered plugin name.

```typescript
import type { Context } from "@deepseek-ai/cordis";
import { registerDsh } from "./register.js";

export const name = "example-reader";
export const inject = ["tools", "systemPrompt"];

export function apply(ctx: Context): void {
  registerDsh(ctx);
}
```

Registrations made through `ctx`, including event listeners and tools, are owned by the plugin and are removed at unload. Use `ctx.effect()` for resources that need explicit disposal, and make the returned cleanup function safe after partial startup. Keep order-dependent cleanup inside one disposer. A development reload unloads the old plugin before applying the new one, so reinitialize runtime state on every `apply`.

## Shared capability contract

Define client-neutral input, output, error, and cancellation behavior in the stock capability's public core module. Let other capability packages extend those public contracts and choose implementations of explicit core-defined ports. Map DSH's tool execution result and model-facing render output at the DSH boundary; preserve cancellation and failure meaning rather than reshaping a host-specific result inside the core. Share only capabilities with equivalent behavior in both clients, and document DSH-only behavior in the package README.

## Plugin tools

Declare `tools` in `inject` before registering a model-callable tool through `ctx.tools.register()`. Declare `systemPrompt` when the plugin also adds model guidance through `ctx.systemPrompt.section()`. Use `defineTool` from `@deepseek-ai/dsh-tools` for a typed first-party tool: `parameters` defines validated arguments, `output.schema` defines the canonical execution value, and `output.render` converts that value into model-facing content. `execute(args, exec)` returns only the canonical value and forwards `exec.signal` to cancellable work; throwing reports a tool failure. Keep this DSH schema and result mapping in `src/dsh/`; the core receives validated client-neutral values. Inspect the selected DSH release's installed tool types before adding background execution, policy hooks, or UI presentation fields.

```typescript
import type { Context } from "@deepseek-ai/cordis";
import { defineTool } from "@deepseek-ai/dsh-tools";
import type {} from "@deepseek-ai/dsh-system-prompt";
import { readText, type ReadPort } from "../index.js";
import { filesystemTextPort } from "@scope/filesystem-port";

export function registerDsh(ctx: Context, port: ReadPort = filesystemTextPort): void {
  ctx.systemPrompt.section({
    name: "tool:read_text_example",
    order: ctx.systemPrompt.getSectionOrder("TOOL_READ"),
    text: ({ scope }) => {
      if (ctx.tools.get("read_text_example", scope) === undefined) return "";
      const rangeGuidance = ctx.tools.get("read", scope) === undefined
        ? ""
        : " Use read with offset and limit when you need only a line range.";
      return "Use read_text_example when you need a file's complete UTF-8 text. Give it a nonempty path relative to the process working directory or an absolute path. Read the file again after it changes." + rangeGuidance;
    },
  });

  ctx.tools.register(defineTool({
    name: "read_text_example",
    description: "Read the complete UTF-8 contents of one file from a path. Returns its text without line numbers or a line limit.",
    parameters: {
      path: { type: "string", required: true, description: "Nonempty path to read; relative paths resolve from the process working directory." },
    },
    output: {
      schema: { type: "string" },
      render: (_args, value) => [{ type: "text", text: value }],
    },
    async execute(args, exec) {
      const result = await readText({ source: args.path }, port, exec.signal);
      return result.text;
    },
  }));
}
```

The example is an interface module, so `src/dsh/index.ts` must expose the Loader-facing `apply` and `inject` as named exports. Do not assume exporting metadata from `src/dsh/` makes it visible to the Loader. Adapt the core import, schema, and result mapping to the package's actual contract. `execute` returns the canonical value declared by `output.schema`; `output.render` creates model-facing content after validation. Pass `exec.signal` through to all cancellable core operations.

DSH's tool definition does not have Pi's `promptSnippet` or `promptGuidelines` fields. Write `description` as a standalone account of the tool's capability, input, and returned value. Use a prompt section for instructions that change how the model chooses or calls the tool: selection among related tools, prerequisites and call order, exact argument or output syntax, stale results, write or preview behavior, limits, and recovery after rejection. Use exact tool, parameter, and output names. Verify each instruction against the implementation and parameter schema; include only applicable guidance. Return an empty string when `ctx.tools.get(name, scope)` cannot find the tool in that assembly's scope, and obtain the section order from `ctx.systemPrompt.getSectionOrder()`.

For adapter unit tests, a minimal registry fake can capture the tool definition while the shared port fake records core calls. Keep the cast inside test code; production code uses Cordis's exported types.

```typescript
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-system-prompt";

export function createDshRegistrationMock(): {
  ctx: Context;
  definitions: unknown[];
  sections: unknown[];
} {
  const definitions: unknown[] = [];
  const sections: unknown[] = [];
  const ctx = {
    tools: {
      register: (definition: unknown): void => {
        definitions.push(definition);
      },
      get: (name: string): unknown => definitions.find(
        (definition) => (definition as { name: string }).name === name,
      ),
    },
    systemPrompt: {
      getSectionOrder: (_name: string): number => 0,
      section: (section: unknown): (() => void) => {
        sections.push(section);
        return () => {};
      },
    },
  } as unknown as Context;
  return { ctx, definitions, sections };
}
```

After `registerDsh(ctx, port)`, invoke the captured definition with a representative path and execution signal; assert its canonical value, model-facing rendering, the port's recorded source and signal, and failed-call behavior. Evaluate the captured prompt section with the tool present and absent, including the optional `read` comparison. Then boot a real DSH profile because this fake does not exercise Loader exports, Cordis injection, schema validation, patch composition, or disposal.

## Package validation

Test the core in `read-tool` and the selected port package directly, then load the built `dist/dsh/index.js` in a DSH profile with only DSH host dependencies available. Verify that the bundle patch mounts the intended plugin row, required services become available, a representative operation reaches the core, and unload disposes registrations and resources. Check the composed configuration with `dsh --profile <name> --dump-config`, inspect the packed file list, and boot the profile when behavior depends on runtime services. For a union package, also load `src/pi/index.ts` through Pi with only Pi host dependencies available; this catches eager DSH imports and entry-point drift. Use the installed DSH API declarations for exact service, tool, and client module shapes.
