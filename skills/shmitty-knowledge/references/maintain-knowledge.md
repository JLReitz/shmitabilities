# Maintain knowledge

- Verify the document, inspect its connections, and evaluate investment with [knowledge-cli](./knowledge-cli.md)
    - Resolve each missing topical or term tag, prohibited or missing link, invalid history value, and consistency-policy error before investment evaluation.
- Treat confidence as the evidence gate. Add support for each non-open Concept whose confidence is `0.0`, or make it an open Concept by emptying its body.
- Raise investment by finding persistent References whose term tags cover more of each Concept's term tag set.
- Decompose a broad topic into narrower concepts when its sources support distinct sets of claims. Give each concept one coherent claim set, cite it at the fullest valid coverage, and link related concepts through the topic tree.
- Follow procedure when [adding knowledge](./add-knowledge.md)
- When resource access is available, verify each changed Reference against its online resource and refine its body. Update its `timestamp` when the resource changes. When access is unavailable, retain the last verified content and do not claim a new verification. Append to a concept's `history.updates` when its content changes meaningfully.
- Preserve unknown frontmatter fields during edits.
- Repair stale indexes and invalid knowledge-document links as part of the change that exposes them.
- Keep reference bodies source-faithful. Move interpretation into a concept.
- Remove ephemeral artifacts stored as knowledge material. Repair affected knowledge links and indexes in the same change.
