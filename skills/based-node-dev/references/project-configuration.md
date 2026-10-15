# Node.js project configuration

Use `package.json` as the baseline configuration file. Apply this template when initializing a project, replace each placeholder, and remove optional fields that the project does not use:

```json
{
  "name": "project-name",
  "version": "0.1.0",
  "description": "Short project description.",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "lint": "..."
  },
  "bin": {
    "command-name": "./dist/cli.js"
  },
  "dependencies": {
    "package-name": "^..."
  },
  "devDependencies": {
    "@types/node": "^...",
    "@vitest/coverage-v8": "^...",
    "typescript": "^...",
    "vitest": "^..."
  },
  "optionalDependencies": {
    "optional-package": "^..."
  }
}
```

- Record runtime dependencies in `dependencies` and optional runtime dependencies in `optionalDependencies`.
- Record development-only dependencies in `devDependencies`.
- Declare executable commands under `bin` and target compiled JavaScript files.
- Keep project commands under `scripts`.
- Set `private` to `true` for applications that are not published.
- Preserve `package-lock.json` when npm manages dependencies.
