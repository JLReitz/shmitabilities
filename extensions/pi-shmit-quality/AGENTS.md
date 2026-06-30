# Pi Shmit Quality — Agent Notes

Agent instructions for `extensions/pi-shmit-quality/`. This extension records
tool validation failures for quality/telemetry purposes. Shared context for
humans and agents lives in `README.md` (create one when the implementation
lands).

## Purpose

Record cases where the model emits tool-call arguments that fail the tool's
TypeBox schema validation. These are high-signal events: each one is a place
where the model misunderstood a tool's contract, and the recorded data drives
prompt-schema improvements and `prepareArguments` rescue shims.

Validation failures are produced by `validateToolArguments()` in
`@earendil-works/pi-ai/dist/utils/validation.js`. On failure it throws an
`Error` whose message starts with the literal prefix:

```
Validation failed for tool "<toolName>":
```

The Pi runtime (`pi-agent-core/dist/agent-loop.js`) catches that throw inside
`prepareToolCall()`'s try/catch and converts it into an **immediate error
tool result** (`{ kind: "immediate", result: createErrorToolResult(msg),
isError: true }`). The model receives the error text as a tool result and can
self-correct on the next turn.

## The hook must be `tool_execution_end`, not `tool_result`

This is the single most important constraint and the easiest thing to get
wrong. **The extension `tool_result` event does NOT fire for validation
failures.** Neither does `tool_call`.

Two independent bridges connect the agent loop to extension event handlers,
and they differ in what they cover:

| Extension event | Bridge | Fires on validation failure? |
|---|---|---|
| `tool_execution_start` | agent-loop `emit` EventStream → `agent-session.js` `_onAgentEvent` → `runner.emit` | ✅ Yes (with the raw model args) |
| `tool_execution_end` | agent-loop `emit` EventStream → `agent-session.js` `_onAgentEvent` → `runner.emit` | ✅ Yes (with `isError: true`) |
| `tool_call` | `agent.beforeToolCall` hook → `runner.emitToolCall` | ❌ No — runs *after* `validateToolArguments` inside `prepareToolCall`'s try block; a validation throw short-circuits to the catch before `beforeToolCall` is reached |
| `tool_result` | `agent.afterToolCall` hook → `runner.emitToolResult` | ❌ No — `afterToolCall` is only called inside `finalizeExecutedToolCall`, which the immediate (validation-failure) path skips |

The reason is structural: `tool_call` and `tool_result` are gated on the tool
*reaching* execution. A validation failure means the tool never executed, so
neither hook fires. `tool_execution_start` and `tool_execution_end`, by
contrast, are emitted unconditionally around the `prepareToolCall()` call
(see `executeToolCallsSequential` / `executeToolCallsParallel` in
`agent-loop.js` — `emitToolExecutionEnd(finalized, emit)` sits *outside* the
`if (preparation.kind === "immediate")` branch).

**Do not register a `tool_result` handler to catch validation failures. It
will silently never fire for the exact case you want to record.** If a
`tool_result` handler is added for other reasons (e.g. recording execution
errors or successful-call telemetry), it must treat validation failures as
out-of-scope — they will arrive via `tool_execution_end` instead.

## Recording validation failures

Register a `tool_execution_end` handler. On `isError: true`, inspect
`event.result.content[0].text` for the `Validation failed for tool` prefix to
distinguish validation failures from other error categories (abort, blocked,
not-found, execution throw).

### Event shape

```ts
// From @earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts
interface ToolExecutionEndEvent {
    type: "tool_execution_end";
    toolCallId: string;
    toolName: string;
    result: any;        // { content: (TextContent|ImageContent)[], details: unknown }
    isError: boolean;
}
```

Note that `tool_execution_end` carries `result` (the full result object),
unlike `tool_result` which carries `content`, `details`, and `input`
separately. Critically, **`tool_execution_end` does not include the validated
`input`** — the validated args are only on `tool_result`, which doesn't fire
here. To recover the raw model args for a validation failure, correlate
`toolCallId` with the preceding `tool_execution_start` event, whose `args`
field carries the unvalidated model output.

### Reference handler

```ts
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

const VALIDATION_PREFIX = "Validation failed for tool";

// Track raw args from tool_execution_start so they can be correlated with
// the validation error on tool_execution_end. tool_execution_end does not
// carry the input.
const pendingArgs = new Map<string, Record<string, unknown>>();

export function activate(pi: ExtensionContext): void {
    pi.on("tool_execution_start", (event) => {
        pendingArgs.set(event.toolCallId, event.args ?? {});
    });

    pi.on("tool_execution_end", (event) => {
        pendingArgs.delete(event.toolCallId);  // always clean up

        if (!event.isError) return;
        const text = firstText(event.result);
        if (!text || !text.startsWith(VALIDATION_PREFIX)) return;

        // This is a validation failure. Record it.
        recordValidationFailure({
            toolName: event.toolName,
            toolCallId: event.toolCallId,
            // The raw, unvalidated args the model emitted. Reconstruct from
            // the start event because tool_execution_end has no input field.
            // If the start event was missed (handler installed mid-call),
            // this will be undefined — handle that gracefully.
            rawArgs: pendingArgs.get(event.toolCallId),
            errorMessage: text,
        });
    });
}

function firstText(result: unknown): string | undefined {
    if (!result || typeof result !== "object") return undefined;
    const content = (result as any).content;
    if (!Array.isArray(content)) return undefined;
    const first = content[0];
    return first?.type === "text" ? first.text : undefined;
}

function recordValidationFailure(entry: {
    toolName: string;
    toolCallId: string;
    rawArgs: Record<string, unknown> | undefined;
    errorMessage: string;
}): void {
    // TODO: persist to whatever sink this extension owns. Keep it append-only
    // and bounded — validation failures can burst if a model gets confused.
}
```

### Distinguishing error categories

`tool_execution_end` with `isError: true` covers several distinct failure
modes. The only way to tell them apart is the `result.content[0].text`
prefix, because stock Pi exposes no structured error category on the event:

| Prefix / shape of `result.content[0].text` | Category |
|---|---|
| `Validation failed for tool "<name>":` | Schema validation failure (what we record) |
| `Tool <name> not found` | Tool not registered |
| `Operation aborted` | AbortSignal fired |
| `Tool execution was blocked` (or a custom `reason`) | `tool_call` handler returned `{ block: true }` |
| Anything else | Thrown from `execute()` (execution error) |

The `Validation failed for tool` prefix is stable as of Pi v0.80.2 (see
`validateToolArguments` in `pi-ai/dist/utils/validation.js`). If a future Pi
release changes the wording, the handler will silently stop recording — add a
test that pins the prefix so the regression is caught on upgrade.

## What not to do

- **Do not use `tool_result` to catch validation failures.** It does not fire
  for them. See the bridge table above.
- **Do not use `tool_call` to catch validation failures.** It runs after
  validation succeeds, so it never sees the failure case. (It can *prevent*
  one via `{ block: true }`, but that's a gate, not a recorder.)
- **Do not parse the `Received arguments:` JSON block out of the error
  message as the source of truth for raw args.** It's a pretty-printed debug
  dump and may be reformatted on upgrade. Correlate with
  `tool_execution_start` instead.
- **Do not mutate `event.result` to "fix" a validation failure.**
  `tool_execution_end` handlers cannot change the result — unlike
  `tool_result` handlers, they return nothing. The error has already been
  sent to the model by the time this event fires.
- **Do not assume `event.result.content[0]` is always text.** It's typed as
  `TextContent | ImageContent`. Guard with a `type === "text"` check before
  reading `.text`.

## Implementation status

Not yet implemented. This file documents the approach so the first
implementation lands correct-by-construction. When the implementation lands,
add a `README.md` with the user-facing sink description and keep this
`AGENTS.md` focused on the hook mechanics and the `tool_execution_end` vs
`tool_result` constraint.
