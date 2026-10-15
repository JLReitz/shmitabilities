# Pi Package

The root `package.json` declares Pi interface and skill resources through `pi.extensions` and
`pi.skills`. Read those fields to identify which local resources the root package exposes. Each
registered package has its own `package.json`; compare its Pi entry point with the root registration
before changing either path. [Packages](packages.md) defines the target layout and shared-core
boundary.

```bash
python3 - <<'PY'
import json
from pathlib import Path
paths = [Path('package.json')]
for root in (Path('extensions'), Path('packages')):
    paths.extend(sorted(root.glob('*/package.json')))
for path in paths:
    data = json.loads(path.read_text())
    print(path, data.get('pi', {}))
PY
```

The root `postinstall` handles the nested source package. npm installs dependencies and runs
lifecycle scripts for the package being installed; it does not independently install nested source
packages. Keep the root lifecycle command aligned with the nested package's production install,
patch, native build inputs, and published files. Check the nested `files` list against the native
manifest, lockfile, build script, source, and smoke test before packaging.

The root package has its own publication fields, dependency groups, and test scripts. Read their
current values from the manifest. Each package's local documentation describes component
behavior. For a Pi tool or renderer, use the installed `@earendil-works/pi-coding-agent` type
contract rather than a copied interface declaration.
