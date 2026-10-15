# Task Tracking

Shmitabilities uses the shared Beads Dolt server with database `shmitabilities` and issue prefix `shmit`. The project-local `.beads/` directory contains connection metadata and is ignored by Git. Its `.env` sets `BEADS_SHARED_SERVER_DIR=${HOME}/.agents/beads` so Beads selects the shared server.

The `headroom-and-shmit-v1` epic is `shmit-cgi`. Its feature and task hierarchy covers native settings, shared runtime, Pi, DSH, argument passthrough, and package integration. A related spike investigates multi-upstream instances. The package plan is on branch `headroom-and-shmit` at `packages/headroom-and-shmit/docs/refactor.md` until that branch is integrated.

From the repository root, run `bd context`, `bd where`, and `bd dolt show` before changing issues. Use `bd children shmit-cgi` to inspect the epic and `bd ready` to find unblocked work. Each task's description and acceptance field define its deliverable; record findings there as work progresses.
