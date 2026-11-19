# Task format

Store each item as `index.md` in its own directory below the registered workspace's `.agents/tasks/` directory. Use the exact POSIX path relative to `.agents/tasks/`, including `index.md`, as the item identity.

```markdown
---
title: <nonempty title>
type: epic|feature|story|task|spike|decision
status: created|started|done
tags: []
dependencies:
  - <blocking item identity>
---

<nonempty description>

---

<context and Markdown links>
```

Use exactly the five frontmatter fields shown. Write `tags` and `dependencies` as unique string lists. Keep dependencies relative to the task root and free of absolute paths, dot segments, root escapes, self edges, missing targets, symlinks, and cycles.

Put supporting Markdown documents directly in the item directory. Use `idea.md`, `design.md`, or another content name. Do not create `.agents/tasks/index.md`; each `index.md` represents a tracked item.

Derive the parent from the nearest ancestor item directory. A directory can contain its item, its direct supporting documents, and child item directories.

Write the complete item before running a query. `task-cli` validates the complete graph and returns no normal output while any item or edge is invalid.
