# Shmitty system

This package supplies the Shmitty workflow skills and `knowledge-cli` command. Its
`skills/` directory contains the project, brainstorming, research, knowledge, and
version control workflows. `bin/` holds the Python command and its modules.

Pi loads `src/pi-shmitty-system/index.ts` and the skill directory from `package.json`. DSH loads
`dist/dsh/index.js` through `cordis.patch.yml` and registers a filesystem skill
provider for the same directory. Both client entries append this package's `bin/`
directory to the process PATH once. The Codex `plugin.json` exposes the skills. Codex does not add `bin/` to the
shell PATH or expose the CLI as a native tool. A Codex stdio MCP interface is needed
for model-callable knowledge operations from the installed plugin.

Build the DSH entry with `npm run build`. The package's `prepare` script builds it
for source installation. Check the package with `npm pack --dry-run --json` and
verify that `dist/`, `src/`, `skills/`, `bin/`, and the manifests are included.
Install the Python dependencies using the
[knowledge ontology tooling instructions](../../docs/dependencies.md#knowledge-ontology-tooling).
