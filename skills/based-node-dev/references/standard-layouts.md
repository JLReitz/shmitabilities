# Standard Node.js package layout

## Library with a command-line interface

Use this layout for a package that provides a library and a command-line interface:

```text
project-name/
├── package.json
├── package-lock.json
├── tsconfig.json
├── README.md
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

- `src/index.ts` MUST define the public library API.
- `src/cli.ts` MUST define the command-line entry point.
- `src/internal/` MUST contain implementation modules that consumers do not import.
- `tests/` MUST contain tests outside the published package.
- `dist/` MUST contain generated JavaScript, declaration files, and source maps.
- `package.json` MUST map `exports`, `types`, and `bin` to files under `dist/`.
- Exclude `dist/` from source control unless consumers install the package directly from the repository.
