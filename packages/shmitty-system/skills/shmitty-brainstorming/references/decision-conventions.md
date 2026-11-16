# Decision conventions

Review a **decision** with the user until shared understanding is reached. Structure the discussion as a *decision tree* in which every **decision** may branch into **decisions** that depend on it, then wire blocking edges. Leave imprecise thinking under the **idea model's** **Unformed questions**.

Close approved designs and list them under the **idea model's** **Design clarification** with each ticket ID, title, and summary.

## Idea weight

The weight of an idea is determined by its completeness:

- **light** — the idea is **short and hedged** ("maybe", "could", "might", "not sure", "wondering", "what if") with **few concrete specifics**. The user is still feeling out the problem space.
- **medium** — the idea has **some structure** (lists, named components/modules/interfaces, a rough architecture) but is **missing the relationships** between the pieces, or names a few constraints without tying them together.
- **heavy** — the idea is **detailed**, names **specific components**, and states **established constraints** (must/shall/requires, deadlines, versions, protocols, standards, specifications). The vision is concrete enough to decompose and pressure-test.

Weight fixes the behavioral contract for the whole **decision**:

- **light** — Keep **decisions** shallow and breadth-first; map the problem space at surface level. Confine to reversible **decisions** only. Do NOT follow any single thread deeply.
- **medium** — Connections are missing. Explore approaches, give detailed explanations, and explicitly mark which boundaries are rigid vs. flexible.
- **heavy** — the vision is fairly clear. Decompose the idea, confirm interpretations for alignment, challenge stated confidence, and surface gaps.

# Fact-finding vs. judgement-calls

Finding facts is the agent's responsibility. When a ready-set **decision** needs facts from the filesystem, tools, or external sources, create a **Question** ticket.

Judgement calls, as **decisions**, belong to the user. Do not act on the result before that confirmation.
