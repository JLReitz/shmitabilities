# Packages

A `Package` reference is `references/packages/<package>/index.md`. Name the directory for the package. Set its `resource` to the package man page or documentation.

The Package abstract MUST identify the tools the package provides and the purpose of each tool. It MUST record the host installation paths; mutable state, cache, data, and log locations; configuration files and precedence; persistent settings that affect operation; and expected host behavior such as command resolution, required privileges, services, environment variables, and update behavior. State an applicable location or setting as `Not present` only after inspection establishes its absence. Separate source-faithful package behavior from observed host state with literal headings.

Place any sanctioned execution subtype under the Package when it operates the package or a tool that the package provides. Link those executions from `# Contents` below the index separator. The contents MAY also link ordinary source References that provide additional package documentation.

```markdown
---
type: Reference
reference_type: Package
title: Widget command line package
description: Documents the Widget command line package.
tags: [references, packages, widget, cli]
timestamp: 2026-09-20T12:00:00-07:00
resource: https://docs.example.com/widget-cli
resource_type: Webpage
---

The Widget package provides `widget` for managed widget requests and `widget-admin` for service administration.

## Host state

| Item | Host value |
|---|---|
| Installation | `/usr/bin/widget`, `/usr/bin/widget-admin`, and `/usr/share/widget` |
| Mutable state | `/var/lib/widget` |
| Cache | `/var/cache/widget` |
| Logs | `widget.service` journal records |
| Configuration | `/etc/widget/config.yaml`; command options override file settings |
| Persistent settings | `mode: managed` in `/etc/widget/config.yaml` |
| Expected behavior | `widget` resolves from `/usr/bin`; administration requires root; `widget.service` reads the persistent configuration at startup |

---

# Contents

- [Run a widget request](run.md) - Submit one managed widget request.
- [Inspect widget service status](status.md) - Report the service state.
```
