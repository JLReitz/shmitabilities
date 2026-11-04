# Extensions

## Pi extensions

- Treat each loadable Pi extension directory under `extensions/` as a package with its own top-level `package.json`.
- Put extension source under `src/`. The Pi entrypoint lives at `src/index.ts`.
- Set `pi.extensions` to `["./src/index.ts"]`.
- Omit `main`, `types`, and `exports` by default. Pi is the only consumer unless a package-specific exception says otherwise.
- Include at least `name`, `description`, `version`, and `license` in every extension package. Start new extension versions at `0.0.1`.
- Set `type` to `"module"`.
- Set `private` only on the selected extensions that should not be published yet.
- Include a `files` list in every published extension package. Always include `src/`.
- Include `README.md`, `AGENTS.md`, and `DEFERRED.md` in `files` when those files are present.
- Include build, postinstall, and other shipped runtime support files in `files` when the package needs them.
- Include `dependencies`, `devDependencies`, `peerDependencies`, and `bundledDependencies` only when the package needs them.
- `keywords` are optional.
- Do not ship a root-level `index.ts` entrypoint from an extension package.
- When moving an existing extension into `src/`, update relative imports in the moved entrypoint in the same change.
