---
name: manim-video
description: Create Manim Community Edition animations for math explainers, algorithm walkthroughs, technical concept videos, data stories, and research visualizations. Use when you need a local Python-based animation pipeline with scene planning, rendering guidance, and production-quality visual structure.
---

# Manim Video

Build clear, teachable animations with a single local Manim pipeline.

## Start Here

1. Run `scripts/setup.sh` when the environment needs a dependency check.
2. Decide the mode:
   - concept explainer
   - equation derivation
   - algorithm visualization
   - data story
   - architecture buildup
   - paper explainer
   - 3D visualization
3. Write the narrative arc before writing scene code.

## Workflow

1. Write a short plan with:
   - the teaching goal
   - the scene sequence
   - the color palette
   - the visual metaphor for each section
2. Implement one Python script with one scene class per section unless the project clearly benefits from another structure.
3. Draft-render quickly, then fix layout, timing, and readability before high-quality renders.
4. Stitch or export the final deliverable with ffmpeg when the output spans multiple scenes.

## Read Only the References You Need

- `references/scene-planning.md`: scene structure and sequencing
- `references/animation-design-thinking.md`: choosing what should animate
- `references/equations.md`: math typesetting and derivations
- `references/graphs-and-data.md`: charts, algorithms, and data movement
- `references/mobjects.md`: core object patterns
- `references/animations.md`: animation primitives and transforms
- `references/updaters-and-trackers.md`: dynamic relationships
- `references/decorations.md`: labels, highlights, braces, and polish
- `references/camera-and-3d.md`: camera motion and 3D scenes
- `references/rendering.md`: render commands, stitching, and output review
- `references/production-quality.md`: visual consistency and pacing checks
- `references/troubleshooting.md`: common Manim and ffmpeg issues
- `references/visual-design.md`: palette, hierarchy, and compositional guidance
- `references/paper-explainer.md`: turning research into scene structure

## Working Rules

- Teach one idea at a time.
- Show geometry or structure before dense notation when possible.
- Give each important reveal enough on-screen time to be understood.
- Keep typography, color, and pacing consistent across scenes.
- Prefer readable composition over maximal animation count.

## Verification

- Draft render at low or medium quality first.
- Render stills for text-heavy or dense scenes when needed.
- Check that equations are legible, labels do not collide, and scene timing matches the intended explanation.
