# Advisor Feature Architecture Observations

This document records the architectural components and dependencies identified for the "advisor" feature in the `oh-my-pi` monorepo.

## Core Components

### 1. Secondary "Advisor" Model
- **Function:** Runs a second, typically smaller/faster model (e.g., Claude Haiku) alongside the primary model to review its work.
- **Usage:** Used in benchmarking (e.g., `terminal-bench` via `--advisor-model`) and real-time agent monitoring.
- **Logging:** Advisor turns are flushed to a dedicated file, `__advisor.jsonl`, to track specific spend and activity separately from the primary model.

### 2. Advisory Metadata (Wrapper Tags)
- **Mechanism:** Uses specialized markup, such as `<advisory severity="..." guidance="...">...</advisory>`, to signal content intended as advice, nudges, or reminders.
- **Content Types:** Includes "advisor cards," "capture nudges," and "file-mention companions" used for agent-owned developer reminders.

### 3. Advisory Management (Agent Package)
- **Advisory Reset:** Mechanism within the agent's context management (see `append-only-context.ts`) to clear the public log of advisory turns.
- **Context Integration:** Manages how advisory turns are interleaved with primary turns, including converting them to `user` turns to optimize for model prompt caching (e.g., for `llama.cpp`).

### 4. Advisory Budget/Loop
- **Mechanism:** An "advisory loop budget" (integrated with `task_budget` in the `ai` package) to control resource expenditure for auxiliary reasoning/review processes.

## UI & Rendering Components

### 1. `@oh-my-pi/collab-web` (Collaborative UI)
- **Function:** Handles the transcript rendering for collaborative sessions.
- **Behavior:** Strips the `<advisory>` wrapper tags while preserving the inner text content to ensure a clean user interface for the main conversation.

## Key Dependencies

The feature requires coordinated logic across these internal packages:

- **`@oh-my-pi/ai`**: Manages serialization, parsing, and routing of advisory metadata and budget constraints.
- **`@oh-my-pi/agent`**: Manages the lifecycle of the advisory context and integration into agent memory.
- **`@oh-my-pi/collab-web`**: Provides specialized Markdown/HTML rendering for the shared session view.
- **External AI Providers**: Requires a secondary model via a provider (e.g., Anthropic) for the review task.
