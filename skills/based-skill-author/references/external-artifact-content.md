## External-artifact content rule

- **No bare internal ids or artifacts.** Internal identifiers/artifacts are never exposed externally — an external reader cannot resolve them.
- **Cross-system reference containment.** Content shall not include foreign keys, review ids, chat links, registry ids, or local workspace paths.
- **Every identification carries context OR an external reference.** Wherever the artifact names a thing, it shall either (a) accompany the name with plain-language context — what it is, where it comes from, what it concerns — or (b) reference a specific external document of record the reader can open..