---
name: architecture-diagram
description: Generate standalone HTML architecture diagrams with inline SVG for software systems, cloud infrastructure, service topologies, API maps, and deployment views. Use when you need a clean technical diagram artifact that can be edited locally without external rendering tools.
---

# Architecture Diagram

Produce a single HTML file with inline SVG and a dark technical aesthetic.

## Output

- Create one self-contained `.html` file.
- Keep CSS and SVG inline.
- Avoid JavaScript unless it adds a small, meaningful interaction.
- Save to a user-requested path or a descriptive filename in the working directory.

## Workflow

1. Extract the system boundary, major components, trust zones, and primary flows.
2. Group nodes by role:
   - frontend
   - backend
   - data
   - infrastructure
   - security
   - external dependencies
3. Draft the layout before coding:
   - left-to-right for request flow
   - top-to-bottom for layered stacks
   - boxed regions for environments, regions, or network boundaries
4. Build the HTML artifact by reusing the structure and visual patterns from `templates/template.html`.
5. Add summary cards below the diagram only when they clarify the system.
6. Verify that arrows, legends, and boundaries do not overlap important nodes.

## Visual Rules

- Use semantic colors consistently per component category.
- Draw connectors behind boxes when transparency would otherwise create visual clutter.
- Keep labels short and scannable.
- Place legends outside the main diagram boundary.
- Favor clear spacing over dense fidelity.

## Template Usage

Read `templates/template.html` before generating a new diagram. Reuse its:

- page structure
- card styling
- SVG component patterns
- connector styles
- legend treatment

Adapt the layout to the actual system instead of copying the sample geometry literally.
