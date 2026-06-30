# pi-shmitline — De-risking Analysis

Note: this file started as a pre-implementation host analysis. The current extension no longer relies on `setFooter()` or a patched `tui.render()` path. The live implementation uses a `ctx.ui.setWidget(...)` bridge to capture `tuiRef`, subscribes through `session_start` / `before_agent_start`, and wraps the pre-editor root children in a scrollable proxy so the host still performs a single authoritative render per frame.

## TUI Architecture (from `../pi-mono/packages/coding-agent/src/modes/interactive/interactive-mode.ts`)

### Child hierarchy

The `InteractiveMode` constructor builds the TUI child stack in this exact order:

```
this.ui.addChild(new Spacer(1));                    // [0] welcome spacer
this.ui.addChild(header);                           // [1] APP_NAME + instructions
this.ui.addChild(new Spacer(1));                    // [2] welcome spacer
// ... optional changelog (DynamicBorder + Markdown) ...
this.ui.addChild(this.chatContainer);               // [3] Container<AssistantMessageComponent, UserMessageComponent, BashExecutionComponent, ToolExecutionComponent, CompactionComponent>
this.ui.addChild(this.pendingMessagesContainer);    // [4] Container (queued messages)
this.ui.addChild(this.statusContainer);             // [5] Container (loading animation, compaction indicator, retry indicator)
this.ui.addChild(new Spacer(1));                    // [6] bottom spacer
this.ui.addChild(this.editorContainer);             // [7] Container<CustomEditor> (or selector components when open)
this.ui.addChild(this.footer);                      // [8] FooterComponent
```

Where `this.ui` is a `TUI extends Container` from `@mariozechner/pi-tui`.

### Key components

| Variable | Type | Role |
|---|---|---|
| `this.ui` | `TUI` (extends `Container`) | Root TUI, has `children`, `terminal`, `requestRender()`, `doRender()`, `invalidate()`, `render()`, `addInputListener()`, `hasOverlay()` |
| `this.chatContainer` | `Container` | Holds chat messages (UserMessageComponent, AssistantMessageComponent, BashExecutionComponent, ToolExecutionComponent, CompactionComponent) |
| `this.pendingMessagesContainer` | `Container` | Holds queued messages (shown between chat and status) |
| `this.statusContainer` | `Container` | Holds loading animation, compaction indicator, retry indicator (shown between pending messages and spacer) |
| `this.editorContainer` | `Container` | Holds the `CustomEditor` (or selector components when open). **This is the editor container we need to find.** |
| `this.footer` | `FooterComponent` | The built-in statusline (pwd + stats). **This remains the bottom-most footer region; pi-shmitline feeds it either script output, default Pi fallback content, or emptiness.** |
| `this.editor` | `CustomEditor` | The text input editor. Child of `editorContainer`. |

### Identifying the editor container

From pi-powerline-footer's `findContainerWithChild()`:

```ts
function findContainerWithChild(tui: any, child: any): { container: any; index: number } | null {
  const children = Array.isArray(tui?.children) ? tui.children : [];
  const index = children.findIndex((candidate: any) => 
    Array.isArray(candidate?.children) && candidate.children.includes(child)
  );
  if (index === -1) return null;
  return { container: children[index], index };
}
```

**The editor container is the first `Container` in `tui.children` whose `children` array includes the `CustomEditor` instance.**

### Identifying sibling containers

Once the editor container is found at index `N`:

| Container | Index | Role |
|---|---|---|
| Status container | `N - 2` | Loading/compaction/retry indicators |
| Widget container above | `N - 1` | Spacer between status and editor |
| **Editor container** | `N` | **Target — hide this** |
| Footer | `N + 1` | Built-in footer region — **script output, default Pi fallback, or empty footer are rendered here** |

### Hiding renderables

The compositor's `hideRenderable(target)` replaces `target.render = () => []` and stores the original. `renderHidden(target, width)` calls the original render. This is how the editor, status container, and spacers are captured for the cluster.

### The `setFooter` API

From `ExtensionUIContext`:

```ts
setFooter(factory: ((tui: TUI, theme: Theme, footerData: ReadonlyFooterDataProvider) => Component & {
  dispose?(): void;
}) | undefined): void;
```

The `ReadonlyFooterDataProvider` provides:
- `getGitBranch()` — current git branch
- `getExtensionStatuses()` — statuses set via `ctx.ui.setStatus()`
- `onBranchChange(callback)` — subscribe to branch changes
- `getAvailableProviderCount()` — number of providers with models

**The TUI `tui` reference is passed to the footer factory.** This is how pi-powerline-footer gets `tuiRef` — it's the same `TUI` instance that has `children`, `terminal`, `requestRender()`, etc.

### The `setEditorComponent` API

```ts
setEditorComponent(factory: EditorFactory | undefined): void;
```

Where `EditorFactory = (tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) => EditorComponent`.

**This is how pi-powerline-footer gets `currentEditor`** — it wraps the default editor factory with a `BashModeEditor`. For pi-shmitline, we don't need a custom editor, but we need to track the editor reference. We can either:
1. Use `getEditorComponent()` to get the current factory, then call it ourselves
2. Or find the editor by scanning `editorContainer.children` after the compositor is installed

### Getting context data (from hook events)

The extension subscribes to pi's hook events to extract statusline data. **No direct API calls needed.**

| Data | Hook Event | Field |
|---|---|---|
| Git branch | N/A (shell) | `git rev-parse --abbrev-ref HEAD` |
| Git status | N/A (shell) | `git status --porcelain` |
| Context usage | `TurnEndEvent` | `message.usage.input + output + cacheRead + cacheWrite` |
| Model | `SessionEvent` | `entries[].modelId` (SessionHeader) |
| Thinking level | `ThinkingLevelChangeEntry` | `thinkingLevel` |
| Session ID | `SessionEvent` | `entries[].id` (SessionHeader) |
| Cost | `TurnEndEvent` | `message.usage.cost.total` (if provider provides) |
| Time | JavaScript | `new Date().toLocaleTimeString()` |

### Event triggers for script re-invocation

From pi-mono's hook system (`packages/coding-agent/src/core/hooks/types.ts`), the relevant events are:

| Event | When to invoke script |
|---|---|
| `session` (reason: "start") | Yes (session started) |
| `turn_end` | Yes (turn completed, includes message with usage) |
| `message_end` | Yes (assistant response done) |
| `model_change` | Yes (model changed, includes new modelId) |
| `thinking_level_change` | Yes (thinking changed) |
| `branch` | Maybe (session branched) |

**Note:** The hook system uses `session` (not `session_start`), `turn_end` (with `message` and `toolResults`), `model_change`, and `thinking_level_change` events.

## Adaptation Layer Risks

### Risk 1: TUI API compatibility ✅ LOW RISK

The `TUI` class from `@mariozechner/pi-tui` is stable. The `Component` interface (`render(width)`, `invalidate()`, `handleInput?(data)`) is well-defined. The `Container` class (`children`, `addChild`, `removeChild`, `render`) is straightforward.

**The `tui.children` array, `tui.terminal.write()`, `tui.requestRender()`, `tui.hasOverlay()`, and `tui.addInputListener()` are all confirmed available.**

### Risk 2: Editor identification ✅ LOW RISK

The `findContainerWithChild(tui, editor)` pattern from pi-powerline-footer works by scanning `tui.children` for a Container whose `children` includes the editor. This is robust because:
- The editor is always a child of `editorContainer`
- `editorContainer` is always a `Container` in `tui.children`
- The pattern doesn't depend on component class names

**We need to get a reference to the `CustomEditor` instance.** Options:
1. Call `ctx.ui.getEditorComponent()` to get the current factory, then invoke it with `(tui, theme, keybindings)` to create a new instance (but this creates a NEW editor, not the existing one)
2. After `setFooter` gives us `tuiRef`, scan `tuiRef.children` for the editor container, then get `editorContainer.children[0]` (the editor)
3. Use `ctx.ui.setEditorComponent()` to install our own wrapper that captures the editor reference

**Option 2 is simplest** — after `setFooter` gives us `tuiRef`, we know the editor container is at some index in `tuiRef.children`, and the editor is its first child.

### Risk 3: Chat transcript line scanning ⚠️ MEDIUM RISK

For message jumping, we need to scan the chat transcript to find user/assistant message boundaries. The chat container holds:
- `UserMessageComponent` — user messages
- `AssistantMessageComponent` — assistant messages
- `BashExecutionComponent` — bash output
- `ToolExecutionComponent` — tool calls/results
- `CompactionComponent` — compaction summaries

**We can identify message boundaries by component class name:**
- `UserMessageComponent` → user message start
- `AssistantMessageComponent` → assistant message start

The `renderLineCount(component, width)` function from pi-powerline-footer shows the pattern: call `component.render(width)` and count the returned lines.

**Risk:** The line offset calculation must account for all components rendered before the chat container (welcome spacer, header, etc.). The chat container's first line is at line offset = number of lines from all preceding children.

### Risk 4: Script execution ⚠️ MEDIUM RISK

The user script is an executable run via `child_process.spawn` with a JSON document on stdin. Risks:
- **Path resolution**: `~` expansion, relative paths resolved against config file location
- **Timeout**: 200ms kill is very short; scripts that do git status or network calls will time out
- **Non-zero exit**: fallback to the default Pi footer, plus runtime error display
- **Concurrency**: latest wins, abort previous

**Mitigation:** Use `spawn` with `timeout` + `signal.abort()` for cancellation. The 200ms timeout is aggressive but matches the spec.

### Risk 5: Config file resolution ✅ LOW RISK

Configuration lives in `[~|...]/.pi/shmitline.json`. The pattern from pi-powerline-footer:
- Global: `~/.pi/agent/settings.json` with `powerline` key
- Project: `<cwd>/.pi/settings.json` with `powerline` key
- Merge: project overrides global

For pi-shmitline, we can use a similar pattern but with `shmitline.json` as the filename.

## Footer Requirements (Confirmed)

The footer is driven by a user-provided executable script:

1. **Literal stdout** — the user owns the footer content when the script succeeds
2. **Trigger**: session start and relevant turn, model, thinking-level, Git-branch, extension-status, and width changes
3. **Throttle**: minimum 5 seconds between turn-completion invocations; other changes refresh immediately
4. **Timeout**: 200ms max
5. **Fallback**: default Pi footer if `statusScript` is empty or the script fails
6. **Concurrency**: latest wins, previous aborted
7. **Output**: stdout → footer rows (multi-line = multiple rows)
8. **Empty success**: exit `0` with empty stdout leaves the footer empty
9. **Errors**: config errors show only at startup in the welcome splash; runtime script errors show above the editor as a multiline `「 ... 」` block
10. **Input**: one versioned `StatusScriptInput` JSON document on stdin, including sorted extension statuses from Pi's footer data provider

## Implementation Summary

### What's already in place
- `src/components/cluster.ts` — cluster rendering (identical to pi-powerline-footer)
- `src/components/terminal-split.ts` — full compositor with scroll, selection, mouse, keyboard (identical)
- `src/components/shortcuts.ts` — shortcut matching (slightly modified)
- `src/components/types.ts` — type definitions (identical)
- `src/components/powerline-config.ts` — config parsing (identical)

### What needs to be copied from pi-powerline-footer

**Nothing.** The extension extracts all data from hook events and simple shell commands — no modules need to be copied.

| Data | Source | Implementation |
|---|---|---|
| Git branch | `git rev-parse --abbrev-ref HEAD` | Simple async exec via `ctx.exec()` |
| Git status | `git status --porcelain` | Simple async exec via `ctx.exec()` |
| Context usage | `TurnEndEvent.message.usage` | Sum `input + output + cacheRead + cacheWrite` from usage |
| Model | `SessionEvent.entries` (SessionHeader) | `modelId` from session header |
| Thinking level | `ThinkingLevelChangeEntry` | `thinkingLevel` from entry |
| Session ID | `SessionEvent.entries` (SessionHeader) | `id` from session header |
| Cost | `TurnEndEvent.message.usage` | Sum from usage (if provider provides cost data) |
| Time | JavaScript `Date` | `new Date().toLocaleTimeString()` |

**No npm packages needed.** The `git-branch` dependency in package.json is removed. No `simple-git`, no `git-status.ts`, no `context-usage.ts`. All data comes from pi's hook events or simple shell commands.

### What needs to be written
1. **`index.ts` rewrite** — the main extension entry point:
   - Read `shmitline.json` config
   - Set up a `setWidget` bridge to get `tuiRef`
   - Install compositor on `session_start`
   - Spawn user script on trigger events (with throttle/timeout)
   - Pass script output as footer lines to compositor
   - Wire message jumping shortcuts
   - Handle extension disposal

2. **`test/tui-mock.ts`** — extended TUI mock with:
   - `terminal.write()`, `terminal.columns`, `terminal.rows`
   - `tui.children`, `tui.requestRender()`, `tui.hasOverlay()`
   - `tui.addInputListener()`, `tui.doRender()`, root-child proxy wrapping
   - `Component` interface (render, invalidate)
   - `Container` class (children, addChild)
