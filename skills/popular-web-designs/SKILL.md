---
name: popular-web-designs
description: Reuse real-world webpage design vocabularies from the bundled template library. Use when you need to style a local HTML artifact after a known product or brand, or when a concrete visual reference system is more useful than inventing typography, spacing, and component rules from scratch.
---

# Popular Web Designs

Use the bundled templates as visual reference systems, not as literal clones.

## Workflow

1. Identify the closest reference brand or product style the user wants.
2. Read the matching file in `templates/`.
3. Pull out the parts that matter for the task:
   - palette
   - typography
   - spacing
   - radii
   - border and shadow language
   - button treatment
   - layout rhythm
4. Apply those rules to the requested artifact in local code.
5. Adapt the result to the user's content instead of copying brand copy, logos, or product claims.

## Working Rules

- Treat each template as a design system summary.
- Keep the strongest structural signals and drop low-value decoration.
- Use fallback fonts or local-safe substitutions when the original fonts are proprietary.
- Preserve accessibility and readability even when the source brand favors extreme aesthetics.
- Blend references only when the user explicitly wants a hybrid.

## Template Library

- Templates live in `templates/`.
- Choose one primary template first.
- Read additional templates only when you need a specific secondary pattern, such as navigation from one source and cards from another.

## Output Expectations

- Produce local HTML, CSS, and JavaScript artifacts that embody the reference style.
- Call out any deliberate deviations from the source style when they improve fit or implementation quality.
