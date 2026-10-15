# Task Tracking

Shmitabilities uses the shared Beads Dolt server with database `shmitabilities` and issue prefix `shmit`. The project-local `.beads/` directory contains connection metadata and is ignored by Git. Its `.env` sets `BEADS_SHARED_SERVER_DIR=${HOME}/.agents/beads` so Beads selects the shared server.

The `headroom-and-shmit-v1` epic is `shmit-cgi`. Its feature and task hierarchy covers native settings, shared runtime, Pi, DSH, argument passthrough, and package integration. The multi-upstream design spike `shmit-cgi.7` has seven question spikes, each with a child evidence task, and a synthesis task that depends on their answers. The package plan is on branch `headroom-and-shmit` at `packages/headroom-and-shmit/docs/refactor.md` until that branch is integrated.

From the repository root, run `bd context`, `bd where`, and `bd dolt show` before changing issues. Use `bd children shmit-cgi.7` to inspect the multi-upstream spike and `bd ready` to find unblocked work. Record methods and observations on each evidence task, then post its result to the parent question spike before closing the task. Close a question spike after its linked evidence task is complete and its answer is recorded.
