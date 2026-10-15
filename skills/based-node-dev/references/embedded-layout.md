# Embedded Node.js package layout

Use a dedicated embedded package when Node.js code has its own dependencies, build, or tests:

```text
host-component/
├── component files...
└── node/
    ├── package.json
    ├── package-lock.json
    ├── tsconfig.json
    ├── src/
    │   ├── index.ts
    │   ├── cli.ts
    │   └── internal/
    │       └── helper.ts
    ├── tests/
    │   └── index.test.ts
    └── dist/
        ├── index.js
        ├── index.d.ts
        └── cli.js
```

- Use `node/` when the host does not define a directory for executable code.
- Use the host's `scripts/`, `tools/`, `plugins/`, or equivalent directory when that convention exists.
- Keep `package.json`, `package-lock.json`, and `tsconfig.json` together at the embedded package root.
- Keep imports inside the embedded package boundary.
- Exclude `dist/` from source control unless the host executes generated files directly without a build step.
