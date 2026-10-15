# Packages

Develop harness capabilities as packages. A package can expose a Pi interface, a DeepSeek Harness
(DSH) plugin interface, or both. Share behavior with the same contract in both clients. Keep client
registration, lifecycle, tool schemas, UI rendering, and host services in their client interfaces.

The [DeepSeek Harness repository](https://github.com/deepseek-ai/deepseek-harness) describes DSH as
a plugin-based harness. Check its current plugin API and the installed version before implementing
an interface. [Pi Package](pi-package.md) describes the existing Pi registration in this repository.

## Layout

`packages/` is the target location for harness packages. The current packages still live under
`extensions/`, and the root manifest and test configuration refer to those paths. Read those files
before editing or running a package. A later move must update registrations, imports, scripts,
tests, published files, local links, and any package-specific documentation together.

Organize packages by reusable responsibility. The stock `read-tool` package contains both the read core and its Pi and DSH interfaces. The read example uses separate packages for its port implementations. Another capability can import the public read core, select the filesystem or a network transport, then add filtering, presentation, or a new tool interface:

```text
packages/
├── filesystem-port/
│   ├── package.json
│   ├── README.md
│   ├── tests/
│   └── src/index.ts       # Filesystem transport API
├── network-port/          # Alternative transport when needed
│   ├── package.json
│   ├── README.md
│   ├── tests/
│   └── src/index.ts
└── read-tool/
    ├── package.json
    ├── README.md
    ├── tests/
    ├── cordis.patch.yml   # Only for a DSH bundle
    └── src/
        ├── index.ts       # Public read contract and business logic
        ├── pi/
        │   ├── index.ts   # Pi extension entry
        │   └── register.ts
        └── dsh/
            ├── index.ts   # DSH plugin entry
            └── register.ts
```

Each port package implements a core-defined interface for an external operation and has its own manifest, build, tests, README, and `src/index.ts` public import entry. Such operations can include filesystem access, network requests, clocks, process execution, and persistent state. For example, a scheduling core can define `ClockPort.now()` while a `system-clock-port` package implements it with the system clock. A package with a command can add `src/cli.ts` that calls its public API and maps `bin` to the compiled command. In this example, the port supplies access to a source. The read core in `read-tool/src/index.ts` validates requests and accepts an implementation through its public `ReadPort` interface. The Pi and DSH interfaces select a port and map results to their respective tool formats. The core imports neither a port implementation nor a client SDK.

The `read-tool` manifest declares `filesystem-port` as a runtime dependency. Declare `src/pi/index.ts` in `pi.extensions` and build `src/dsh/index.ts` into `dist/dsh/index.js` as the JavaScript package root export for DSH. Build `src/index.ts` into `dist/index.js` and expose it as `@scope/read-tool/core` for import consumers. A Pi-only capability with a public core also uses `src/pi/index.ts` as its Pi factory. See [Harness package development](../skills/based-harness-dev/references/package-development.md) for complete templates. Build and install imported port packages before loading the capability through either client. Existing package names remain unchanged until a deliberate rename updates their consumers.

## Reuse and extension

The stock read core defines a transport-neutral request, result, and `ReadPort` interface. A filesystem port interprets the source as a path; a network port can interpret it as a URL. Another capability package can extend the read request through `@scope/read-tool/core`, call its public read function, and apply its own behavior, such as line filtering. It can define a new tool schema and presentation for Pi, DSH, or both while reusing the same read logic and selected port.

```text
Pi host ── read-tool Pi interface ──┐
                                    ├── read-tool core ── ReadPort ──┬── filesystem-port
DSH host ─ read-tool DSH interface ─┘                ▲               └── network-port
Other capability ── @scope/read-tool/core ──────────┘
```

Share a core API or port implementation when its contract and failure behavior match the consumers. Keep client registration, lifecycle, schemas, and presentation in capability interfaces. Document each package's public API, accepted sources, errors, installation, and extension points in its README.

## Development requirements

1. Inspect each package's manifest, entry points, tests, and README. Define or reuse the public core contract, select port implementations, then define each capability interface against its host API.
2. Test the core and selected port implementations directly and test each client interface with its host. Run
   the package checks in [Validation](validation.md).
3. When adding DSH support, document its install and registration steps after verifying the
   selected DSH version. Update [Dependencies](dependencies.md) with live inspection instructions
   for any new manifest or lockfile.
