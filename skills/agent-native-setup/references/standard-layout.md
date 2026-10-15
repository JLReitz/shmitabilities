# Choose the workspace layout

Place the Agent Native project in the agent workspace selected with `shmitty-project-manager`. A standalone app uses the project root as its app root. A multi-app workspace uses the project root as its workspace root and places each app below `apps/`.

## Application layout

This layout uses the Chat template scaffold as an example. Templates can add directories. Create `artifacts/`, `docs/`, `src/`, and `tests/` when the project needs them. Put application source code under `src/` and test or benchmark source under `tests/`; keep framework entry points in their prescribed directories. Read the generated `AGENTS.md` and skills for their application-specific rules.

```text
<app-root>/
├── .agents/skills/
├── .claude/skills -> ../.agents/skills
├── actions/
├── app/
│   ├── components/
│   ├── hooks/
│   ├── i18n/
│   ├── lib/
│   ├── routes/
│   │   ├── _index.tsx
│   │   └── chat.$threadId.tsx
│   ├── root.tsx
│   └── routes.ts
├── artifacts/
├── changelog/
├── data/
├── docs/
├── public/
├── scripts/
├── server/
│   ├── middleware/
│   ├── plugins/
│   └── routes/
├── src/
├── tests/
├── AGENTS.md
├── CLAUDE.md -> AGENTS.md
├── package.json
└── .env.example
```

| Directory | Purpose |
| --- | --- |
| `.agents/skills/` | Generated agent skills. Read the relevant skill before app work. |
| `.claude/` | Client-specific links to the generated agent skills. |
| `actions/` | App operations exposed through `defineAction`. These are the primary tool and UI operation surface. |
| `app/` | React frontend and its route configuration. |
| `app/components/` | React UI components. |
| `app/hooks/` | UI state and data hooks. |
| `app/i18n/` | Localized UI strings. |
| `app/lib/` | App-side helpers. |
| `app/routes/` | React Router page modules. `app/routes.ts` enables file routing. |
| `artifacts/` | Project data files and generated artifacts. |
| `changelog/` | Template change records. |
| `data/` | Local runtime data and configuration files. |
| `docs/` | Application documentation. |
| `public/` | Static assets served by the app. |
| `scripts/` | Project maintenance commands. |
| `server/` | App server code. |
| `server/middleware/` | Server request middleware. |
| `server/plugins/` | Server startup integrations. |
| `server/routes/` | HTTP handlers for endpoints that require a route rather than an action. |
| `src/` | Custom application source code. |
| `tests/` | Test and benchmark source code. |

React Router maps `_index.tsx` to the app's root page and a `$name` segment to a route parameter; `chat.$threadId.tsx` handles a thread path. A `$.tsx` segment is a catch-all. Server route filenames can include the HTTP method, as in `[...page].get.ts`. Keep app operations in `actions/`; add a server route only when the operation needs an HTTP endpoint.

## Multi-app workspace mapping

The `create` workspace flow includes Dispatch and the selected apps. Each directory below `apps/` follows the application layout above. Put code shared across apps in `packages/shared/src/` and app-specific custom code in each app's `src/`.

```text
<workspace-root>/
├── .agents/skills -> ../packages/shared/.agents/skills
├── .claude/skills -> ../.agents/skills
├── apps/
│   ├── dispatch/                 # application layout
│   └── chat/                     # application layout
├── artifacts/
├── packages/
│   └── shared/
│       ├── .agents/skills/
│       ├── .claude/skills -> ../.agents/skills
│       ├── src/
│       │   ├── client/
│       │   └── server/
│       ├── AGENTS.md
│       └── CLAUDE.md -> AGENTS.md
├── docs/
├── scripts/
├── AGENTS.md
├── CLAUDE.md -> AGENTS.md
├── package.json
├── pnpm-workspace.yaml
└── .env.example
```

| Directory | Purpose |
| --- | --- |
| `apps/` | App roots within the workspace. |
| `apps/<name>/` | One app root per selected template; its local routes and actions belong to that app. |
| `artifacts/` | Project data files and generated artifacts shared across apps. |
| `packages/` | Workspace packages. |
| `packages/shared/` | Shared code and instructions for the apps. |
| `packages/shared/.agents/skills/` | Workspace-level agent skills inherited by apps. |
| `packages/shared/src/` | Shared package source. |
| `packages/shared/src/client/` | Shared client code. |
| `packages/shared/src/server/` | Shared server integrations. |
| `docs/` | Documentation shared across the workspace. |
| `scripts/` | Workspace maintenance commands. |

For a unified deployment, the app name prefixes its public page routes: `apps/chat/app/routes/_index.tsx` serves `/chat/`, and `apps/chat/app/routes/chat.$threadId.tsx` serves a route below `/chat/`. An independent app deployment serves that app's routes at its own origin. Read the generated workspace and app instructions before changing either routing surface.

## Client configuration added during setup

The generator places instructions and skills in `AGENTS.md` and `.agents/skills/` at each app root, the workspace root, and the shared package as applicable. It links `CLAUDE.md` to `AGENTS.md` and `.claude/skills` to `../.agents/skills` at those roots. Keep generated instructions in `AGENTS.md` and shared skills in `.agents/skills/`. Use `based-harness-dev` to verify client discovery and [client integration](client-integration.md) for the selected framework connection.
