# Progressive disclosure

Prompt agents through a task with CLI outputs and compounding skills, avoid frontloading all instructions in to an AGENTS.md

## Prompt progression

- Connect steps by instructing the activation of a new skill or CLI command
- Reveal information as it becomes relevant

## Recover from errors

CLI calls MUST append an actionable guidance prompt with each recoverable error description. Expose the information needed for the next agent action with minimal repeated content.

## Data formats

| Data type | Format |
|---|---|
| Context, documentation, prompts, and guidance | Markdown prose with headings, bold text, italic text, and lists as needed |
| Tabular data | TSV |
| Data structures | Raw representation in a fenced code block with a language tag |
