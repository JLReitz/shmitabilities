---
name: presentation-design
description: Create polished one-off HTML artifacts such as scrollable presentation pages, narrative product pages, interactive reports, concept boards, component explorations, and motion studies. Use when you need to turn a brief and existing visual context into a self-contained HTML/CSS/JS artifact with strong design judgment, presentation-aware structure, and local interactive verification.
---

# Presentation Design

Build a local HTML artifact that feels intentionally designed, not scaffolded.

This skill stays inline and page-oriented. It is the default choice for polished browser-native presentation work when the output should live as a webpage rather than a slide system.

## Workflow

1. Read the brief and identify the artifact type, audience, and non-negotiable constraints.
2. Inspect any supplied repo files, screenshots, copy, or brand materials before inventing a visual language.
3. Choose the right format:
   - scrollable presentation page for reviews, explainers, and browser-native talks
   - narrative long-scroll page for product, research, or report storytelling
   - option board for side-by-side comparisons
   - component lab for UI explorations
   - interactive prototype when flow matters more than static polish
   - slide deck only when the user explicitly asks for deck-like behavior
4. Prefer a scrollable webpage over a slide deck when either format could satisfy the request.
5. Define a compact design system for the artifact:
   - typography
   - color
   - spacing
   - radii
   - motion posture
   - component treatment
6. Decide how visuals will be produced before building:
   - keep simple diagrams, charts, and UI framing browser-native when HTML/CSS/SVG is enough
   - use `manim-video` when the page needs dedicated still graphics or animated explanatory visuals
   - request GIF exports for animated embeds and still renders for static placements
7. Plan the section rhythm before building:
   - one primary signal per section or viewport moment
   - clear entry, development, and payoff across the page
   - visible contrast between primary content and supporting detail
8. Build the artifact as local code, usually a single self-contained HTML file unless the repo already dictates a stack.
9. Verify the output with an interactive review pass before finishing.

## Working Rules

- Start from context, not vibes. Reuse the repo's actual visual vocabulary when one exists.
- Prefer a single descriptive artifact file when portability matters.
- Keep CSS and JavaScript inline unless splitting files improves clarity or matches the repo.
- Use realistic copy and states. Placeholder lorem and empty shells weaken design evaluation.
- Prefer webpage behavior over presentation software metaphors unless the user explicitly wants a deck.
- Add motion only when it clarifies hierarchy, interaction, or pacing.
- Use companion-generated visuals only when they improve the explanation more than a native HTML/CSS/SVG treatment would.
- Presentation polish should strengthen comprehension. Motion, interaction, and composition are supportive devices, not the main spectacle.
- Avoid generic SaaS defaults, purple-on-white drift, and interchangeable layouts.

## Questions to Resolve Early

Ask only when the answer materially changes the artifact:

- What should exist at the end: presentation page, narrative page, prototype, board, or component exploration?
- Who is the audience, and how familiar are they with the topic?
- Is this for async review, a live presentation aid, a long-scroll narrative, or an interactive explainer?
- Is the priority explanation, persuasion, exploration, or demonstration?
- What source material already exists?
- Is the goal faithful extension, redesign, or divergence?
- Is the priority visual language, layout, interaction, motion, information density, or copy?
- Does motion or interaction materially help understanding, or would static presentation be clearer?

## Default House Style

When the user does not provide a strong stylistic direction, default to a warmed Swiss Briefing house style:

- structured, analytical layouts with a visible grid and clean sectional rhythm
- warm light surfaces instead of stark white, with comfortable contrast for long reading sessions
- sans-led typography with restrained serif or weight contrast only where it improves emphasis
- calm accent colors used sparingly for highlights, state changes, and directional cues
- generous whitespace, strong alignment, and clear separation between primary and supporting content
- professional, review-oriented tone over theatrical marketing energy

Use this as a posture, not a rigid template. The output should feel coherent and intentional without forcing every artifact into the same composition.

## Engagement And Attention

Make presentation work engaging by controlling emphasis, cadence, and reveal order:

- Give each section one primary idea, visual, or statistic to anchor attention.
- Vary cadence across the page with changes in density, scale, or layout rhythm instead of repeating one section formula.
- Use whitespace, contrast, isolation, and position before resorting to stronger motion.
- Keep supporting information secondary in size, contrast, and placement.
- Use progressive disclosure when it clarifies complexity, not when it merely decorates the page.
- Treat each viewport moment as part of a narrative sequence, especially in long-scroll review pages.

## Motion, Interaction, And Scaling

Use subtle guided motion by default:

- restrained reveals
- focus cues
- section pacing
- small state transitions that make hierarchy or interaction clearer

Disallow motion that obscures content, competes with reading, or turns the page into a spectacle.

Interaction is appropriate when it expands details, reveals secondary content, compares states, or clarifies hierarchy. Every visible interaction must:

- have an obvious affordance
- be fully implemented
- preserve readability while active
- add understanding rather than novelty

Avoid ambiguous hover traps, decorative controls, or half-built interactions that imply behavior without delivering it.

Scale pages with a hybrid document-first model:

- default to responsive reflow so typography, layout, and controls adapt to the viewport
- make desktop and mobile behavior readable and stable rather than shrinking the whole page to fit
- allow bounded stage-like regions when a hero, diagram, or composed explainer needs tighter choreography
- keep stage-like composition as the exception, not the global layout model

## Companion Guidance

`presentation-design` should own most presentation-style webpage work itself and pull in external visual pipelines only when the page benefits from dedicated rendered assets.

Recommend companions only when the content clearly shifts modes:

- `manim-video` for still or animated graphics that are better rendered than hand-built in page code, especially stepwise transformations, technical build-ups, or motion-led explanatory visuals
- `architecture-diagram` for diagram-heavy or architecture-heavy visuals that need a more dedicated diagram workflow

When using `manim-video`:

- ask for still renders when the page needs a static hero, figure, or explainer frame
- ask for GIF renders when the page needs embedded animation
- size the asset request around the actual page slot so the embed is crisp without being oversized

These are recommended companions, not required branches.

## Verification

Use an interactive review gate before considering the artifact complete:

- Confirm every referenced asset path exists.
- Check the artifact for obvious layout or syntax issues with available local tools.
- Review the page at desktop and mobile-safe sizes for layout stability, readable type, and intact spacing.
- Confirm still and GIF assets render cleanly in the page, at the intended size, without layout jumps or distracting playback.
- Exercise every visible interaction and confirm its affordance is clear and its behavior is fully implemented.
- Review motion for pacing and restraint; if motion distracts from the information, the artifact is not done.
- Report the exact output path and any caveats that still need human taste review.
