# Keep beads data untracked

Check the repository convention before setup:

```bash
git ls-files -- .beads
```

Preserve tracked beads data when the command returns a path. Use no visibility flag and do not add an ignore rule.

For an untracked repository owned by the user, add this exact entry to the root `.gitignore` and use no visibility flag:

```gitignore
.beads/
```

For an untracked repository cloned or forked from another owner, use `--setup-exclude` as the visibility flag. This adds the beads rule to `.git/info/exclude` without changing repository files.

After initialization, confirm that untracked beads data is ignored:

```bash
git check-ignore -v .beads/
```
