# Codex Plugins

`.codex-plugin/plugin.json` defines the installable Codex plugin. Read its `skills` field to find
the exposed skill tree. Read `interface` for the current display metadata, capabilities, and
default prompts. Check each prompt against the skills that currently exist before changing it.

```bash
python3 - <<'PY'
import json
from pathlib import Path
path = Path('.codex-plugin/plugin.json')
data = json.loads(path.read_text())
print(path, json.dumps({key: data.get(key) for key in ('name', 'skills', 'interface')}, indent=2))
names = sorted(path.name for path in Path('skills').iterdir() if (path / 'SKILL.md').is_file())
print('skills:', *names)
PY
```

`.codex/config.toml` contains workspace-local Codex settings. Packaged custom agents live in
`agents/*.toml`. Read their `name`, `description`, and permission profiles to determine the roster
and runtime access. Keep the bootstrap script's registration aligned with this roster.

`codex-bootstrap.py` stages the checkout, writes a local marketplace entry, registers its root,
and installs the plugin through the Codex CLI. It obtains the plugin name and interface metadata
from the live manifest. Read [Codex Bootstrap](codex-bootstrap.md) for the installation procedure.
