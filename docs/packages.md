# Package contracts

Shmitabilities packages can share account-scoped settings while each capability defines its
own settings and runtime behavior. `@jlreitz/shmit-core` supplies the managed agent root and
reads the shared settings file. A capability package interprets the values it uses.

## Default client resources

```text
Root package (default)            shmitty-system (individual)
├── based skills                   ├── Shmitty skills
└── Shmitty skills + bin/          └── knowledge-cli + task-cli + bin/
    ├── Codex: based skills           ├── Codex: Shmitty skills
    ├── Pi: package paths             ├── Pi: package manifest
    └── DSH: root patch              └── DSH: package patch
```

The root `package.json` includes `packages/shmitty-system/`, registers both skill
families for Pi, and loads the package's Pi extension. The root DSH patch registers both
skill providers and the Shmitty PATH plugin. The root Codex compatibility manifest lists only
`./skills`; its based skills are separate
from the standalone `packages/shmitty-system` portable Codex plugin, which discovers its
own `skills/` and packaged knowledge MCP server. Register both Codex plugins to load both families
and the native knowledge tools.
For Pi and DSH, install either the root bundle or `shmitty-system` to load Shmitty skills,
`knowledge-cli`, and `task-cli`; installing both in one scope may register duplicate entries.

For Codex, `.agents/plugins/marketplace.json` is the repository catalog. Its `./` and
`./packages/shmitty-system` paths resolve from the checkout root. Register a checkout once
with `codex plugin marketplace add /absolute/path/to/checkout`, then install
`shmitabilities@shmitabilities` and `shmitty-system@shmitabilities` separately with
`codex plugin add`. Codex caches each installed plugin; changing the checkout does not
change an existing cached copy until it is refreshed or reinstalled. Codex does not
append a plugin `bin/` directory to the shell PATH. The standalone plugin starts
`python3 bin/knowledge-cli mcp` from its cached root and exposes named read-only knowledge tools.
The selected `python3` environment must contain the dependencies listed under
[Knowledge ontology tooling](dependencies.md#knowledge-ontology-tooling). The catalog lives in
Git, so another checkout can use the same registrations without recreating a personal
marketplace file. The root npm package file list does not include this repository catalog;
use the standalone manifests or a distribution marketplace for installed packages.

Codex does not add a plugin's `bin/` directory to `PATH`. Install the standalone npm package as a
command package before using `shmitty-task-tracking` in Codex, then verify `task-cli --help`. Pi and
DSH add the package `bin/` directory through their native package entries.

```text
Capability entry
  │ request managed root + shared settings
  ▼
shmit-core
  │ root + parsed settings, including absent values
  ▼
Capability configuration adapter
  │ validated values + capability defaults
  ▼
Capability runtime and client interfaces
```

## Shared configuration

`@jlreitz/shmit-core` exports `locateManagedAgentRoot()`, `locateSharedSettingsRoot()`,
and `readSharedSettings(settingsRoot?)`. The first returns `${HOME}/.agents` for the current
account. The second returns `${HOME}/.config/shmit`. The reader loads `settings.toml` from
that settings root and returns parsed TOML values.
When the file or a parent directory is absent, it returns an empty object. Other filesystem
errors and TOML parse errors reach the caller.

The optional root argument selects another settings root. Reads follow filesystem symlinks
and run on each call. The package keeps no cache or persistent state. The account maintains the
settings file. A capability can import the compiled public entry without loading Pi or DSH.

## Capability packages

Each capability defines the structure, valid values, defaults, and missing-value behavior for
its settings. A capability imports `@jlreitz/shmit-core`, reads the shared settings, and
interprets its own keys. Native client files define provider and model registrations; the
capability package defines client interfaces and runtime lifecycle. Build `shmit-core` before a
package that imports its compiled entry; see
[Shared Node packages](dependencies.md#shared-node-packages).

The [llamas-and-shmit package README](../packages/llamas-and-shmit/README.md) defines its
settings, native llama.cpp catalog, Pi and DSH interfaces, router lifecycle, validation, and
installation limits.

## Shmitty filesystem context

`@jlreitz/shmitty-system` contains one filesystem-context detector and native adapters for Codex,
Pi, and DSH. The detector compares an absolute working directory with the absolute targets stored
under `${HOME}/.agents/workspaces/`, then asks Git for the current project root and checkout kind.
It returns workspace and project results separately.

Codex invokes the detector from packaged `SessionStart` and `UserPromptSubmit` command hooks. Pi
invokes it from `session_start`, `session_compact`, and `before_agent_start`. DSH invokes it through
`session/created`, `compaction/end`, `working-directory/change`, and a dynamic system-prompt context
provider. Client adapters own event registration, working-directory state, and context injection;
the package core owns detection and guidance text.

The workspace result identifies the innermost matching absolute root and its `.agents/tasks` path.
A project result identifies its absolute root and main-checkout or linked-worktree state. A
linked-worktree result directs the agent to use `shmitty-version-control` directly.

Only symbolic links in the workspace registry are registrations; ordinary files and directories are
ignored. An expected absent workspace or project result emits nothing for that result. An inspection failure
prints to standard error and emits no model context. Codex command hooks also write nothing to
standard output and return status `0`.
