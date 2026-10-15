# Shmitabilities

This repository packages shmitabilities as skills, harness packages, and a Codex plugin.

## Development

- Keep each change small and update its human-facing document under `docs/` in the same change. Record the component's requirements, configuration, dependencies, development context, and manual steps in its topic document.
- Keep repository-specific facts in `docs/`. Put reusable client and harness practices in the corresponding `based-harness-dev` reference. Use [Packages](docs/packages.md) for the target layout and shared-core boundary. Read `extensions/AGENTS.md` before changing a package at its current location.
- Treat `agents/` as the source for packaged agent definitions. Keep the bootstrap registration and plugin metadata aligned with the files they expose.
- Validate the affected component with [Validation](docs/validation.md).

## Documentation

- Organize `docs/` by topic or component. Give each page a descriptive title and a matching, lower-case, hyphenated filename. Revise an existing page before adding a page with overlapping scope.
- State a fact once in its topic page. Link to it from related pages with standard Markdown links and the destination page's title as link text. Use relative paths and check that each local link resolves.
- `AGENTS.md` may link to `docs/`; documents under `docs/` must not link to `AGENTS.md`.
- Start with [Documentation](docs/index.md) for the repository, [Packages](docs/packages.md) for package development, [Dependencies](docs/dependencies.md) for install requirements, [Codex Plugins](docs/codex-plugins.md) for plugin configuration, and [Codex Bootstrap](docs/codex-bootstrap.md) for local installation.
