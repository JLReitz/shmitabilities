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

Inspect the `scripts`, `engines`, `pi`, and `files` fields in the same manifests before an install.
The root `postinstall` installs a nested package with production dependencies; that package's
`postinstall` applies its package patch and builds its native module. Confirm the exact targets and
commands in the live `scripts` fields.

```bash
python3 - <<'PY'
import json
from pathlib import Path
paths = [Path('package.json')]
for root in (Path('extensions'), Path('packages')):
    paths.extend(sorted(root.glob('*/package.json')))
for path in paths:
    data = json.loads(path.read_text())
    fields = {key: data.get(key) for key in ('scripts', 'engines', 'pi', 'files')}
    print(path, json.dumps(fields, indent=2))
PY
```

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

The ontology commands use the Python packages in
`skills/shmitty-knowledge/scripts/requirements-ontology.txt`, a Java runtime,
and the packaged HermiT OWL API JAR. Install the Python packages in the
environment that runs `knowledge-cli`. Use JPype1 1.5.2 with Java 8.

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r skills/shmitty-knowledge/scripts/requirements-ontology.txt
```

Activate the environment before using the `knowledge-cli` launcher, or run the
launcher with `.venv/bin/python`.

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
   development dependencies, then build imported port packages before capability packages.
   Build the stock capability's public core API with its client entries. Run TypeScript checks and
   tests after those builds.
3. Use Python with `tomllib` available for `scripts/codex-bootstrap.py`. Install the Codex CLI for
   plugin installation. Install Pi and `tmux` when running a full terminal render test.

The Codex manifest, workspace config, and agent files describe client registration rather than
npm or Cargo dependencies. Read [Codex Bootstrap](codex-bootstrap.md) for local setup.
