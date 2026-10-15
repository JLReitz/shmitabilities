---
name: based-oop-dev
description: Design and implement function-oriented APIs over rich object models. Use when creating or modifying object-oriented APIs, domain objects, or operations that coordinate objects.
---

# Based object-oriented development

## API design

Use a function-oriented API over rich objects:

- Expose primary operations as public module-level functions.
- Accept and return typed domain objects.
- Classes MUST encapsulate their invariants, state transitions, and behavior.
- Keep operations that depend on one object's state on that object's class.
- Use module-level functions to construct objects, coordinate multiple objects, and manage system boundaries such as files, processes, and networks.
