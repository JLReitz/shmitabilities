---
name: visual-board
description: Create disposable or semi-polished HTML visual boards with 2-3 distinct directions for a screen, flow, concept, presentation moment, or interface exploration. Use when you need to compare concrete visual options quickly, assemble a board of layout and tone explorations, or pressure-test multiple design directions before committing to a production implementation.
---

# Visual Board

Generate a compact board of credible directions so the user can compare stance, composition, and communication strategy with real artifacts.

## Workflow

1. Resolve the minimum inputs:
   - what artifact or moment is being explored
   - what decision the board should help the user make
   - what audience or usage context matters
   - what feel, brand, or source material already exists
2. Decide the board structure before building:
   - one page containing multiple directions when comparison is the priority
   - one file per direction when interaction or layout logic differs materially
   - one focused direction plus supporting alternates when the user needs convergence more than divergence
3. Pull companion guidance when the board needs more than quick layout invention:
   - read `presentation-design` for page composition, typography, section rhythm, and stronger HTML presentation craft
   - follow the repo's existing visual language before borrowing `presentation-design`'s default house style
   - use `manim-video` when the board benefits from rendered still graphics, motion studies, diagram buildups, or looped explanatory assets that are better produced in Manim than hand-built in CSS or SVG
4. Produce 2-3 directions in one pass unless the user explicitly asks for a single focused option.
5. Make the directions genuinely different along one or two axes:
   - density
   - emphasis
   - layout structure
   - tone
   - interaction posture
   - narrative framing
   - use of static or animated supporting graphics
6. Build the board as local HTML, usually a single self-contained file unless the repo already dictates another structure.
7. Review the board locally and fix obvious layout, readability, or comparison problems before presenting it.
8. Recommend a winner, a merge direction, or a clear next refinement path with a short comparative summary.

## Working Rules

- Keep boards disposable by default, but raise polish when the decision depends on typography, pacing, or visual credibility.
- Use realistic sample content instead of lorem ipsum.
- Differentiate by stance, not by small color changes.
- Prefer fast local HTML over framework setup unless the repo already requires a stack.
- Include at least one meaningful state or comparison cue when interaction, hierarchy, or motion is part of the decision.
- Use browser-native HTML/CSS/SVG first; bring in `manim-video` only when rendered stills or animation materially improve the board.
- When using `presentation-design`, borrow its structure and craft discipline without inflating the board into a full presentation page unless the request clearly wants that outcome.

## Output

- Create one clearly named board artifact or one clearly named file per direction.
- Make the comparison obvious in the artifact itself with labels, headings, or section framing.
- Keep shared notes in the final response instead of generating extra board documentation unless the user asks for it.
