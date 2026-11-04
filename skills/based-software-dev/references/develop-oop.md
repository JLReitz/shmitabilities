# Based object-oriented development

Apply to object-oriented software development.

## API design

Use a function-oriented API over rich objects:

- Expose primary operations as public module-level functions.
- Accept and return typed domain objects.
- Classes MUST encapsulate their invariants, state transitions, and behavior.
- Keep operations that depend on one object's state on that object's class.
- Use module-level functions to construct objects, coordinate multiple objects, and manage system boundaries such as files, processes, and networks.

## Polymorphism

- Document the observable contract on each interface, trait, or protocol.
- Document the mechanism by which each implementation satisfies that contract.
- Close an implementation to further extension when the design does not define an extension contract and the language can enforce that boundary.
