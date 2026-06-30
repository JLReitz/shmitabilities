# pi-shmitline — ROADMAP

## Vision

A minimal floating editor cluster extension for pi with three features:

1. **Pinned bottom layout** — a fixed bottom stack that keeps the editor above the footer while the scrollable chat remains above both.
2. **Message jumping** — keyboard shortcuts to jump between user and assistant messages in the chat transcript.
3. **Footer customization via user-provided script** — on relevant runtime status changes, invoke a user-provided script with a JSON snapshot on stdin. The script's stdout becomes the footer. Empty config or non-zero exit falls back to the default Pi footer.

This is a **subset** of [pi-powerline-footer](../../pi-powerline-footer/). We borrow the compositor primitives (fixed bottom layout, message jumping) but drop bash mode, working vibes, prompt history, and the full built-in segment rendering system.

## Feature 1: Pinned Bottom Layout

The extension reserves a fixed bottom stack for the editor and footer. The scrollable chat area sits above that stack. Runtime script errors render as part of the bottom of the conversation viewport rather than in a separate boxed panel.

### Cluster composition order (top to bottom)

1. **Conversation viewport** — scrollable chat transcript
2. **Runtime script error block** — optional multiline `「 ... 」` block, inline at the bottom of the conversation region
3. **Editor lines** — the pi built-in editor content (captured from TUI children)
4. **Footer lines** — either script stdout, the default Pi footer fallback, or empty when the script exits `0` with empty stdout

The `renderFixedEditorCluster` function in `src/components/cluster.ts` takes editor and footer content and produces a line array with cursor tracking. Footer height is dynamic and follows the script output line count.

### Adaptation layer: wiring the compositor to pi's TUI

`TerminalSplitCompositor` (in `src/components/terminal-split.ts`) patches `tui.terminal.write`, `tui.doRender`, and input listeners, and wraps the pre-editor child span in a proxy component that the host renders once per frame. The adaptation layer in `src/index.ts` must:

1. **Find the editor container** — scan `tui.children` to locate the container holding the built-in editor. In the current host the relevant children are `chatContainer → statusLine → hookWidgetContainerAbove → editorContainer → hookWidgetContainerBelow`. The editor container is identified by finding the `Container` whose `children` array includes the `CustomEditor` instance. See `DE-RISK.md` for full analysis.
2. **Hide renderables** — call `compositor.hideRenderable()` on the editor container and any widget containers that should not render independently (they will be captured by the cluster).
3. **Mount the scroll root** — call `compositor.mountScrollableRoot(editorIndex)` so the host keeps rendering a single proxy root above the editor and scrolling no longer needs an extra `tui.render()` pass.
4. **Install the compositor** — call `compositor.install()` which enters alternate screen, enables extended keyboard modes, patches `terminal.write`, and registers input listeners.
5. **Render the cluster** — on every render cycle, call `compositor.renderHidden()` on the editor container to get its lines, then pass them to `renderFixedEditorCluster` along with statusline (from user script), transcript, and other lines.
6. **Teardown** — on extension dispose, call `compositor.dispose()` which restores the original child layout, `terminal.write`, `tui.doRender`, removes input listeners, and exits alternate screen.

### Data extraction from hook events

The extension subscribes to pi's hook events to extract statusline data. **No npm packages needed** — git branch is read via `git rev-parse --abbrev-ref HEAD`, and all other data comes from hook events.

| Data | Source | Extraction |
|---|---|---|
| Git branch | Shell command | `git rev-parse --abbrev-ref HEAD` (simple async exec) |
| Git status | Shell command | `git status --porcelain` (simple async exec) |
| Context usage | `TurnEndEvent.message.usage` | `usage.input + usage.output + usage.cacheRead + usage.cacheWrite` divided by context window |
| Model | `SessionEvent.entries` (SessionHeader) or `ModelChangeEntry` | `modelId` from session header |
| Thinking level | `ThinkingLevelChangeEntry` | `thinkingLevel` from entry |
| Session ID | `SessionEvent.entries` (SessionHeader) | `id` from session header |
| Cost | `TurnEndEvent.message.usage` | Sum from usage (if provider provides cost data) |
| Time | JavaScript `Date` | `new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })` |

### Fixed editor installation flow

```
1. Read shmitline.json → config (statusScript, mouseScroll, shortcuts)
2. Capture the live `tui` through a host-supported `ctx.ui.setWidget(...)` bridge widget
3. Find editor container in tui.children (Container whose children includes CustomEditor)
4. Create TerminalSplitCompositor with renderCluster callback
5. compositor.hideRenderable(editorContainer)
6. compositor.mountScrollableRoot(editorIndex)
7. compositor.install()
8. tui.requestRender(true)
9. Spawn user script for initial footer content
```

## Feature 2: Message Jumping

Keyboard shortcuts to jump between user and assistant messages in the chat transcript.

### Shortcuts (configurable)

Each shortcut accepts a string or array of strings. All configured keys are active.

| Action | Default | Config key |
|---|---|---|
| Jump to previous user message | `ctrl+up` | `jumpPreviousUserMessage` |
| Jump to next user message | `ctrl+down` | `jumpNextUserMessage` |
| Jump to previous assistant message | `ctrl+alt+up` | `jumpPreviousLlmMessage` |
| Jump to next assistant message | `ctrl+alt+down` | `jumpNextLlmMessage` |
| Jump to chat bottom | `ctrl+shift+g`, `ctrl+end` | `jumpChatBottom` |

### Implementation

1. **Collect chat targets** — scan the chat transcript lines to find the line numbers of user and assistant message boundaries. Identify by component class name: `UserMessageComponent` for user messages, `AssistantMessageComponent` for assistant messages. Account for line offset from the scrollable root proxy's cached top-level child offsets rather than by re-rendering top-level siblings. See `DE-RISK.md` for component details.
2. **Map shortcuts to compositor methods** — when a shortcut fires, call `compositor.jumpToPreviousRootTarget(targets)` or `compositor.jumpToNextRootTarget(targets)` with the appropriate target line numbers.
3. **Jump to bottom** — call `compositor.jumpToRootBottom()` to scroll the transcript to the bottom.

The `jumpToPreviousRootTarget` / `jumpToNextRootTarget` methods on `TerminalSplitCompositor` take an array of line numbers and scroll to the previous/next matching line. The `jumpChatBottom()` method scrolls to the very bottom of the transcript.

## Feature 3: User-Provided Footer Script

A user-provided script generates the footer content on every change event. This is the differentiator for pi-shmitline.

### Configuration

Configuration lives in `[~|...]/.pi/shmitline.json` (global or project scoped). Project config overrides global.

**All defaults are written to the config file on extension install.** No hidden values — the user sees and edits everything.

```json
{
  "statusScript": "",
  "mouseScroll": true,
  "shortcuts": {
    "jumpPreviousUserMessage": "ctrl+up",
    "jumpNextUserMessage": "ctrl+down",
    "jumpPreviousLlmMessage": "ctrl+alt+up",
    "jumpNextLlmMessage": "ctrl+alt+down",
    "jumpChatBottom": ["ctrl+shift+g", "ctrl+end"]
  }
}
```

- `statusScript`: absolute path or relative to the config file location. `~` is expanded to `$HOME`. Empty string means "use the default Pi footer".
- `mouseScroll`: enable mouse scroll in chat transcript (default `true`).
- `shortcuts`: each value is `string | string[]`. All configured keys are active.

### Install-time config generation

On first extension load, if `shmitline.json` does not exist at the global or project path, write the defaults. Do NOT merge over existing files — only write if the file is absent.

### Error display

Errors are split by source:

- **Config errors** are shown only at startup in the inline error widget above the editor, as a multiline `「 ... 」` block. They clear on the first submitted prompt (`before_agent_start`), not on raw `input`.
- **Runtime `statusScript` errors** are shown above the editor, without a separator from the conversation viewport, as a multiline `「 ... 」` block.

| Condition | Error message format |
|---|---|
| `statusScript` file not found | `statusScript not found: <path>` |
| `statusScript` not executable | `statusScript not executable: <path>` |
| `statusScript` exits nonzero | `statusScript exited with code <N>: <path>` |
| `statusScript` times out | `statusScript timed out: <path>` |
| `shortcuts.<key>` wrong type | `shortcuts.<key> must be string or string[]` |
| `shortcuts.<key>` conflicts with Pi | `shortcuts.<key> <value> conflicts with Pi` |

Errors clear when the underlying issue resolves (script runs successfully, config is fixed). No error is shown for empty `statusScript` — that's a valid fallback-to-default-footer configuration.

### Script invocation

- **Trigger**: on every turn completion (`turn_end` event), session start (`session_start`), and other state changes (model/select, thinking level, git branch change).
- **Throttle**: skip if last invocation was < 5 seconds ago (dedupe rapid changes).
- **Concurrency**: latest wins — if a new invocation is triggered while one is running, abort the previous and start the new one.
- **Timeout**: 200ms max. Kill the process if it exceeds the timeout.
- **Stdout**: becomes the footer content. Newlines are preserved (multi-line output renders as multiple footer lines). ANSI sequences and unicode are passed through unchanged.
- **Stderr**: logged to the extension console (not shown to user).
- **Exit code**: non-zero exit → fallback to the default Pi footer and show the runtime error widget.
- **Missing script**: fallback to the default Pi footer and show the runtime error widget.
- **Exit `0` + empty stdout**: render an empty footer.
- **Spawn cwd**: the directory containing the config file.

### Script input

The script receives the versioned `StatusScriptInput` JSON document described in `README.md` on standard input. The extension builds it from `ExtensionContext`, session message usage, the current model and thinking level, and `ReadonlyFooterDataProvider`. Extension statuses set through `ctx.ui.setStatus()` are serialized as sorted `{ key, text }` entries. No extension-specific environment variables are defined.

### Output format

The script's stdout is treated as literal footer content. Each line becomes a footer row. Multi-line output produces multiple footer rows.

Example script output:
```
 󰂖 gpt-5.4-mini  󰂖 0.02  󰂖 45%
```

### Error handling

1. If `statusScript` is empty → render the default Pi footer (no error).
2. If `statusScript` is configured but missing/non-executable → show startup config error or runtime script error as appropriate, render the default Pi footer.
3. If `statusScript` times out or exits non-zero → show runtime script error, render the default Pi footer.
4. If `statusScript` succeeds with non-empty stdout → use its output as the footer.
5. If `statusScript` succeeds with empty stdout → render an empty footer.

## Key Differences from pi-powerline-footer

| Feature | pi-powerline-footer | pi-shmitline |
|---|---|---|
| Bash mode | Full editor with completion, history, shell session | **Not in scope** |
| Welcome screen | Full welcome overlay with recent sessions | **Not in scope** |
| Working vibes | AI-generated loading messages | **Not in scope** |
| Prompt history | Stash, search, restore prompts | **Not in scope** |
| Custom editor | Own editor component | Uses pi's built-in editor via compositor |
| Statusline | Built-in segments + custom items | **User script footer with Pi fallback** |
| Message jumping | Yes (ctrl+shift+u/i, ctrl+alt+,,.) | Yes (configurable shortcuts) |
| Fixed editor | Yes (TerminalSplitCompositor) | Yes (same compositor) |
| Chat transcript | Rendered in cluster | Yes (chat only, no bash) |

## Implementation Order

1. **Write `index.ts` from scratch** — the current `index.ts` is a stub with broken imports. It needs to:
   a. On install: write default `shmitline.json` if absent (global `~/.pi/shmitline.json` or project `<cwd>/.pi/shmitline.json`)
   b. Read `shmitline.json` config (global + project, project overrides)
   c. Validate config (types, shortcut conflicts) and surface startup errors in the inline error widget above the editor
   d. Subscribe to hook events (`session_start`, `turn_end`, `model_change`, `thinking_level_change`) to extract statusline data
   e. Set up a `ctx.ui.setWidget()` bridge to capture `tuiRef`
   f. On `session_start`: find editor container, install compositor, spawn initial script
   g. On trigger events: spawn script (with 5s throttle), capture runtime errors for the inline conversation-adjacent error block
   h. Wire message jumping shortcuts to compositor jump methods
   i. On `session_shutdown`: dispose compositor, cancel pending script
2. **Implement config installer** — write defaults to `~/.pi/shmitline.json` if absent. Schema:
   ```ts
   {
     statusScript: "",
     mouseScroll: true,
     shortcuts: { jumpPreviousUserMessage, jumpNextUserMessage, jumpPreviousLlmMessage, jumpNextLlmMessage, jumpChatBottom }
   }
   ```
3. **Implement config validator** — validate types, check shortcut conflicts with Pi reserved keys, surface errors via `statusLineError`.
4. **Implement data extraction** — no npm packages needed:
   a. Git branch: `git rev-parse --abbrev-ref HEAD` via `ctx.exec()`
   b. Git status: `git status --porcelain` via `ctx.exec()`
   c. Context usage: sum `usage.input + usage.output + usage.cacheRead + usage.cacheWrite` from `TurnEndEvent.message.usage`
   d. Model: `modelId` from `SessionEvent.entries` (SessionHeader) or `ModelChangeEntry`
   e. Thinking level: `thinkingLevel` from `ThinkingLevelChangeEntry`
   f. Session ID: `id` from `SessionEvent.entries` (SessionHeader)
   g. Cost: sum from usage (if provider provides cost data)
   h. Time: `new Date().toLocaleTimeString()`
5. **Implement user script executor** — spawn the configured script with versioned JSON on stdin, a 200ms timeout, turn-only 5s throttle, and latest-wins concurrency. Capture errors (not found, not executable, nonzero exit, timeout) and route them either to startup splash config errors or runtime inline script errors.
6. **Implement error display** — render config errors only at startup in the inline error widget above the editor, clear them on the first submitted prompt, and render runtime script errors as a multiline `「 ... 」` block above the editor without a separator from the conversation viewport.
7. **Implement message jumping** — scan chat container children for `UserMessageComponent`/`AssistantMessageComponent`, map line offsets, call compositor jump methods.
8. **Add tests** — config install (idempotent, no overwrite), config validation, user script invocation (throttle, timeout, error capture), git exec, compositor install/dispose, shortcut routing.

## Testing

- `npm test -- --run extensions/pi-shmitline` runs vitest in the workspace root.
- Tests mock `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui` via `test/mocks.ts` and `test/tui-mock.ts`.
- `test/tui-mock.ts` must mock: `TUI` (with `children`, `terminal`, `requestRender`, `hasOverlay`, `addInputListener`), `Container` (with `children`, `addChild`), `Component` (with `render`, `invalidate`), `Terminal` (with `write`, `columns`, `rows`).
- Add tests for: user script invocation (throttle, timeout, fallback), git polling, compositor install/dispose, shortcut routing, config file resolution.

## Validation

- `npm test -- --run extensions/pi-shmitline` — must pass
- `npx tsc --noEmit -p .` — must pass (after adding missing modules)
- Check that all imports in `index.ts` resolve to existing files

## Phase 2: `pi-mono` Host Alignment and Simplification

This phase aligns the implementation with the stock `pi-mono` host layout instead of the older `oh-my-pi` assumptions still present in parts of `index.ts`.

### Goals

1. **Capture the right fixed surfaces** — treat `statusContainer` as part of the fixed editor cluster, keep it separate from `aboveWidgetContainer`, and stop leaving it in the scrollable root.
2. **Make the cluster model explicit** — represent host status, inline error widget, editor, spacer-adjacent widget surface, and footer as distinct sections instead of overloading generic `above` / `below` buckets.
3. **Remove stale top-border interception** — stop deriving the default Pi footer from editor top-border rendering and rely on the real host footer surface instead.
4. **Tighten runtime updates** — drive script refreshes from the actual state changes that matter and avoid throttling away the authoritative `turn_end` update.
5. **Simplify hot paths** — reduce unnecessary shell calls and state churn during routine renders and event handling.

### Host layout target

The stock `pi-mono` lower TUI order is:

1. `chatContainer`
2. `pendingMessagesContainer`
3. `statusContainer`
4. `Spacer(1)`
5. `editorContainer`
6. `footer`

`pi-shmitline` should map those surfaces as follows:

- `chatContainer` + `pendingMessagesContainer` -> scrollable conversation root
- `statusContainer` -> fixed editor cluster section above the inline error widget and editor
- `Spacer(1)` -> separate `aboveWidgetContainer` capture, still fixed but not merged into `statusContainer`
- `editorContainer` -> fixed editor section
- `footer` -> fixed footer section at the bottom

### Implementation plan

1. **Replace sibling-based layout discovery**
   - Replace the current immediate-sibling capture logic with an explicit layout resolver that finds `statusContainer`, `aboveWidgetContainer`, `editorContainer`, and `footer` separately.
   - Keep the scroll root limited to the conversation surfaces instead of wrapping every child above the editor container.

2. **Split cluster inputs into named sections**
   - Extend `renderFixedEditorCluster` to accept separate inputs for:
     - `statusLines`
     - `errorLines`
     - `aboveWidgetLines`
     - `editorLines`
     - `footerLines`
   - Preserve cursor tracking in the editor section and keep footer height dynamic.

3. **Delete editor top-border fallback logic**
   - Remove:
     - top-border parsing
     - `setTopBorder(...)` interception
     - stored "default footer from editor border" state
   - Use the host footer renderable directly for default Pi footer fallback behavior.

4. **Revise script event triggers and throttling**
   - Drive script calls from:
     - `turn_end`
     - `model_change`
     - `thinking_level_change`
   - Do not use `message_end` for script refresh.
   - Apply the 5 second throttle only to `turn_end` events.
   - Let `model_change` and `thinking_level_change` trigger immediate refresh so the footer reflects active runtime state promptly.

5. **Reduce unnecessary process work**
   - Avoid repeated synchronous git calls on every non-turn event.
   - Cache or defer git-derived fields where possible and refresh them on the events that can actually change them.
   - Spawn the configured script directly instead of wrapping it in `bash -c`, assuming executable validation already passed.

6. **Keep reviews host-faithful**
   - Update tests so the footer mock remains a no-op unless the host contract changes.
   - Keep runtime coverage focused on `setWidget(...)`-backed surfaces and the real `pi-mono` layout assumptions.

### Acceptance criteria

- `statusContainer` no longer scrolls with the conversation.
- `statusContainer` and `aboveWidgetContainer` are captured separately and rendered in the fixed cluster in a stable order.
- Default Pi footer fallback comes from the host footer surface, not editor top-border interception.
- Script refreshes are triggered by `turn_end`, `model_change`, and `thinking_level_change`, with the 5 second throttle applied only to `turn_end`.
- Removing `message_end` does not regress footer updates after completed turns.
- The implementation performs no second full-frame host render pass for transcript measurement.
