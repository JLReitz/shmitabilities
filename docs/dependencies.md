# Dependencies

Evaluate direct dependency declarations from the current manifest files before installing or
updating a package. The commands below list every declared development, runtime, peer, optional,
and bundled dependency by the file that controls it. The npm and Cargo lockfiles record resolved
transitive dependencies and versions.

## npm package manifests

Run this command from the repository root. It reads the root package and package manifests in the
current and target locations, including native package manifests. An empty group means the
manifest declares no dependency in that group.

```bash
python3 - <<'PY'
import json
from pathlib import Path

roots = (Path('extensions'), Path('packages'))
paths = [Path('package.json')]
for root in roots:
    paths.extend(sorted(root.glob('*/package.json')))
    paths.extend(sorted(root.glob('*/native/package.json')))
groups = ('dependencies', 'devDependencies', 'peerDependencies',
          'optionalDependencies', 'bundledDependencies', 'bundleDependencies')
for path in paths:
    data = json.loads(path.read_text())
    print(f'\n{path}')
    for group in groups:
        values = data.get(group, {})
        if isinstance(values, dict):
            items = [f'{name}: {version}' for name, version in sorted(values.items())]
        else:
            items = list(values)
        print(f'  {group}: {", ".join(items) if items else "none"}')
PY
```

Inspect the `scripts`, `engines`, `pi`, `dsh`, and `files` fields in the same manifests before an
install. The root package loads skills for Pi and DSH without a nested package install. Install
and build a capability package separately when it is selected.

```bash
python3 - <<'PY'
import json
from pathlib import Path
paths = [Path('package.json')]
for root in (Path('extensions'), Path('packages')):
    paths.extend(sorted(root.glob('*/package.json')))
for path in paths:
    data = json.loads(path.read_text())
    fields = {key: data.get(key) for key in ('scripts', 'engines', 'pi', 'dsh', 'files')}
    print(path, json.dumps(fields, indent=2))
PY
```

## Default Pi and DSH skills

The root package supplies `skills/` to Pi through `pi.skills` and to DSH through its
`dsh.bundle.patch`. Install the checkout in each client scope that should load these skills:

```bash
pi install --local /absolute/path/to/checkout
pi list
dsh plugin --profile <profile> add /absolute/path/to/checkout
dsh --profile <profile> --dump-config
```

Grant Pi project trust before checking the skill catalog. In the DSH config dump, find the
`shmitabilities-skills` row and its `customSkillDirs` path, then check the skill catalog in a
session. The root bundle supplies both based and Shmitty skills and adds the Shmitty `bin/`
directory to PATH in Pi and DSH. Install `packages/shmitty-system` by itself when only
the Shmitty package is wanted.

## Shared Node packages

### Shmitty System hook development

`packages/shmitty-system/package.json` declares TypeScript, Node.js types, dprint,
`@dprint/typescript`, and Vitest for filesystem-context hook development. Install its development
dependencies and run its checks from the package directory:

```bash
npm install
npm run format:check
npm run typecheck
npm run typecheck:test
npm test
npm run build
npm pack --dry-run --json
```

The package also requires Git at runtime for project-root and worktree inspection. Pi supplies
`@earendil-works/pi-coding-agent`. DSH supplies `@deepseek-ai/cordis`,
`@deepseek-ai/dsh-agent`, `@deepseek-ai/dsh-session`, `@deepseek-ai/dsh-system-prompt`, and
`@deepseek-ai/dsh-working-directory`. The manifest declares these host APIs as optional peers and
development dependencies. Validate each adapter against the selected installed client version
because lifecycle event and context-injection APIs can change between releases.

### Other shared packages

`packages/shmit-core` and `packages/llamas-and-shmit` use Node.js, npm, TypeScript, dprint,
`@dprint/typescript`, and Vitest. `shmit-core` supplies TOML parsing. `llamas-and-shmit` imports that package and declares
the host APIs needed by its Pi and DSH interfaces. Read each manifest's `engines`,
`dependencies`, `peerDependencies`, and `devDependencies` fields for the supported versions.
Each lockfile selects its installed dependency graph.

The root package has no test script. Run each package's tests from its own directory so its
dependencies and test configuration apply. Build `shmit-core` before its consuming capability.
Run from the repository root:

```bash
(cd packages/shmit-core && npm ci && npm run format:check && npm run typecheck && npm test && npm run build)
(cd packages/llamas-and-shmit && npm ci && npm run format:check && npm run typecheck && npm test && npm run build)
```

The builds emit public JavaScript entries and type declarations under each package's `dist/`.
Check shipped contents with `npm pack --dry-run` from each package directory. Confirm the
`llamas-and-shmit` archive contains `src/pi-llamas-and-shmit/index.ts`,
`dist/dsh-llamas-and-shmit/index.js`, its public core entry, and `cordis.patch.yml`.

### Client installation and loading

Install Pi and DeepSeek Harness versions compatible with the package's current host peer
requirements. Keep the checkout and its dependencies outside DSH's mutable profile directory.
After the builds, install the local package into the intended client scope:

```bash
pi install --local /absolute/path/to/checkout/packages/llamas-and-shmit
pi list
dsh plugin --profile <profile> add /absolute/path/to/checkout/packages/llamas-and-shmit
dsh --profile <profile> --dump-config
```

`pi install --local` registers the package in the current project's Pi settings. Grant project
trust and start Pi to check extension loading. DSH's add command registers the bundle in the
selected profile; confirm its plugin row appears in the composed configuration, then start that
profile to check loading. Select the native model configured in [Local model routing](../packages/llamas-and-shmit/README.md#local-model-routing)
to exercise the runtime path.

Install from a checkout that retains the sibling package layout described in the
[llamas-and-shmit package README](../packages/llamas-and-shmit/README.md#build-and-validation).

### Local model routing dependencies

`llamas-and-shmit` requires a Linux or WSL runtime host, `llama-server` with native
`--models-preset` router support and a `/models` inventory, and GGUF model files. The runtime
host maintains the executable and model files. The package does not install or update them.

Install llama.cpp through the host's package-management procedure or its
[Build guide](https://github.com/ggml-org/llama.cpp/blob/master/docs/build.md).
Select an executable build with the required compute backend. Verify the selected executable
before configuring the package:

```bash
llama-server --version
llama-server --help
```

Check that help includes `--models-preset`, `--host`, and `--port`. If shared settings select a
custom executable, run these checks against that executable. Create the native preset file
and client registrations described in [Local model routing](../packages/llamas-and-shmit/README.md#local-model-routing).
After a client starts or connects to the router, inspect its reported inventory:

```bash
curl --fail http://127.0.0.1:8080/models
```

Use the configured port in this command. Confirm the selected native client model ID appears
in the response. A valid inventory verifies the router connection; model generation also
requires a readable GGUF and sufficient compute resources.

## Rust crate manifest

Read each package's active Rust declarations and lockfile before changing a native boundary.

```bash
python3 - <<'PY'
import tomllib
from pathlib import Path
for root in (Path('extensions'), Path('packages')):
    paths = [*root.glob('*/Cargo.toml'), *root.glob('*/native/Cargo.toml')]
    for path in sorted(paths):
        data = tomllib.loads(path.read_text())
        for group in ('dependencies', 'build-dependencies', 'dev-dependencies'):
            print(f'{path} [{group}]')
            for name, spec in sorted(data.get(group, {}).items()):
                print(f'  {name}: {spec}')
PY
```

The current nested install script invokes Cargo to fetch the locked graph and build the N-API
module. It may also install an optional local LSP helper. Inspect
`extensions/pi-files-and-shmit/scripts/postinstall.cjs` for the current commands, version, fallback,
and opt-out environment variable.

## Manual installation

### Knowledge ontology tooling

The ontology commands and MCP tools use the Python packages in
`packages/shmitty-system/bin/requirements-ontology.txt`, a Java runtime,
and the packaged HermiT OWL API JAR. Install the Python packages in the
environment that runs `knowledge-cli`. The Codex plugin starts the `python3` found by the Codex
process, so activate the prepared environment before starting Codex. Use JPype1 1.5.2 with Java 8.

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r packages/shmitty-system/bin/requirements-ontology.txt
```

Activate the environment before using the `knowledge-cli` launcher or starting Codex. A direct CLI
call can also run the launcher with `.venv/bin/python`.

Download the [packaged HermiT JAR](https://github.com/owlcs/hermit-reasoner/wiki/HermiT-FAQ)
to a stable local location and set `SHMIT_OWL_JAR` to its absolute path. The
tested artifact is `org.semanticweb.hermit-packaged-1.4.6.519-SNAPSHOT.jar`
from `https://raw.githubusercontent.com/owlcs/releases/master/HermiT/`.
Its SHA-256 is
`420d504d163ee1ce1a0082b212308344b018cc07c02195c8bc19218753e418be`.
Check the digest before use because the upstream artifact is labeled a snapshot.
The runtime fails with a clear error when the JAR or Python packages are absent.

```bash
curl -fL https://raw.githubusercontent.com/owlcs/releases/master/HermiT/org.semanticweb.hermit-packaged-1.4.6.519-SNAPSHOT.jar -o .venv/hermit-packaged.jar
sha256sum .venv/hermit-packaged.jar
export SHMIT_OWL_JAR="$PWD/.venv/hermit-packaged.jar"
```

Compare the printed digest with the value above before running the CLI.


1. Install a Node.js version that satisfies each package's `engines.node` declaration and
   install npm. Install a Rust toolchain that provides `cargo` for the native build.
2. From the repository root, run `npm install`. For package development, install each package's
   development dependencies, then build imported component packages before capability packages.
   Build the stock capability's public core API with its client entries. Run TypeScript checks and
   tests after those builds.
3. Install Pi and `tmux` when running a full terminal render test.

Client registration is separate from npm and Cargo dependencies.
