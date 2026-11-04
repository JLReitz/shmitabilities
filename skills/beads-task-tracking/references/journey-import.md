# Prevent stale journey imports

The journeyman `calling` command can use the shared Dolt server during journey initialization. Check the server with `bd dolt status` and use the shared-server setup path when it is available.

For a journey affected by repeated imports from `.beads/issues.jsonl`, run these steps from the journey root after confirming Dolt contains the current issues:

1. Run `bd config set export.auto false` in that journey's database.
2. Empty the stale snapshot with `: > .beads/issues.jsonl`.

Apply both steps together. The first stops Beads from regenerating the snapshot; the second stops startup from importing its old contents. The git `post-merge` import path uses `import.auto` separately.
