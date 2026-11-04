# pi-shmitline — AGENTS.md

## Development Instructions

### File layout

```
src/index.ts                — extension entrypoint (setWidget bridge, install, dispose, config, script executor)
src/components/cluster.ts   — renderFixedEditorCluster (line composition, cursor tracking)
src/components/terminal-split.ts — TerminalSplitCompositor (terminal patching, scroll, selection, message jumping)
src/components/powerline-config.ts — parsePowerlineConfig, preset resolution, custom items
src/components/shortcuts.ts — super-key matching, shortcut config resolution
src/components/types.ts     — type definitions
test/mocks.ts               — mock @earendil-works/pi-coding-agent
test/tui-mock.ts            — mock TUI interface
test/index.test.ts          — extension lifecycle tests
test/config.test.ts         — config validation tests
test/cluster.test.ts        — cluster rendering tests
test/script-executor.test.ts — script executor tests
test/helpers/terminal-split-harness.ts — mutable compositor harness for terminal input and lifecycle tests
tsconfig.test.json          — scoped typecheck for the compositor test harness
ROADMAP.md                  — forward-looking feature spec
README.md                   — user-facing documentation
```

### Current implementation

The extension is intended to provide four core features:

1. **Bottom-pinned editor** — editor stays fixed above the footer while the conversation scrolls above it
2. **Message jumping** — keyboard shortcuts to jump between user and assistant messages
3. **User-provided footer script** — sends a current JSON status snapshot to the user script on relevant runtime changes and uses stdout as footer content
4. **Scrollable conversation** — handles long conversations by wrapping the pre-editor TUI root in a proxy component and slicing that single-pass render for manual scroll

### Config system

- Config lives in `~/.pi/shmitline.json` (global) or `<cwd>/.pi/shmitline.json` (project)
- Project config overrides global (only present fields override)
- Shortcuts are merged from both configs, then defaults filled in
- Relative `statusScript` paths resolve against the config file location
- Validation checks types and script existence

### Fixed layout

The terminal is split into three regions:
- **Top**: Conversation viewport (scrollable)
- **Middle-bottom**: Fixed editor cluster made of host status, optional runtime error block, editor, and footer
- **Bottom**: Footer remains the last fixed element and may be empty when the script returns exit `0` with empty stdout

The compositor (`TerminalSplitCompositor`) handles this layout by:
- Keeping the full editor cluster pinned while the conversation scrolls
- Reserving dynamic footer height based on script stdout
- Showing runtime script errors inline in that cluster without a separator from the conversation
- Wrapping the pre-editor root children in a proxy component so scrolling does not require a second host `render()` pass

### Stock `pi-mono` host layout

The stock interactive host in `../pi-mono` arranges the lower TUI in this order:

1. `chatContainer`
2. `pendingMessagesContainer`
3. `statusContainer`
4. `Spacer(1)`
5. `editorContainer`
6. `footer`

This matters because the stock footer is a real bottom footer component, while `statusContainer` is a separate host surface above the editor.

### `pi-shmitline` mapping

`pi-shmitline` should adapt the stock host surfaces as follows:

- `chatContainer` + `pendingMessagesContainer` -> scrollable conversation root
- `statusContainer` -> fixed editor cluster, above the error widget and editor
- `Spacer(1)` -> `aboveWidgetContainer`, kept separate from `statusContainer`
- `editorContainer` -> fixed editor
- `footer` -> fixed footer at the bottom of the cluster

The important revision is that `statusContainer` belongs to the fixed editor cluster and must not be left in the scrollable root, while `aboveWidgetContainer` remains a distinct captured surface.

### Script executor

- Spawns the user script with one versioned `StatusScriptInput` JSON object on stdin and no extension-specific environment variables
- Uses a custom-footer bridge to access `ReadonlyFooterDataProvider` for Git branch and `ctx.ui.setStatus()` values
- Detects extension-status changes during footer rendering because Pi requests a render on `setStatus()` but does not expose a status-change subscription
- 200ms timeout, 5s throttle, latest-wins concurrency
- AbortController signal passed to spawn()
- Stale results prevented via invocation id check
- Empty `statusScript` falls back to the default Pi footer
- Non-zero exit falls back to the default Pi footer and surfaces a runtime error block
- Exit `0` with empty stdout leaves the footer empty

### Compositor wiring

The compositor (`TerminalSplitCompositor` in `src/components/terminal-split.ts`) patches `tui.terminal.write`, `tui.doRender`, and input listeners, and it replaces the pre-editor child span with a proxy component that the host renders once per frame. The adaptation layer in `src/index.ts`:

1. Finds the editor container by scanning `tui.children`
2. Captures `statusContainer`, `aboveWidgetContainer`, `editorContainer`, and the host footer as separate hidden renderables for the fixed cluster
3. Calls `compositor.mountScrollableRoot(...)` so only the conversation region remains in the scrollable root
4. Calls `compositor.install()` to enter alternate screen and patch the terminal
5. On render, captures the fixed cluster surfaces separately, then passes them to `renderFixedEditorCluster`
6. On dispose, calls `compositor.dispose()` to restore the original child layout and terminal behavior

Config validation errors are presented only at startup in the inline error widget above the editor, as a multiline `「 ... 」` block. They clear on `before_agent_start`, which maps to the first submitted user prompt after slash-command handling.

### Message jumping

- Scans chat container for `UserMessageComponent`/`AssistantMessageComponent`
- Re-scans targets on each shortcut press (avoids stale snapshots)
- Uses root-child offsets cached by the scrollable root proxy instead of re-rendering top-level siblings
- Registers function listeners via `tui.addInputListener()`
- Listeners stored and cleaned up via `disposeShortcutListeners()`
- Calls `compositor.jumpToPreviousRootTarget()`/`jumpToNextRootTarget()`/`jumpToRootBottom()`

### Scrollable conversation

- The proxy component renders the full pre-editor root once, records the composed lines, and returns either the full frame (at bottom) or a viewport slice (when scrolled up)
- `TerminalSplitCompositor` keeps `rootLines`, `visibleRootLines`, and `scrollOffset` as the scroll model used by selection, repaint, and message jumps
- Properly tracks scroll position via `scrollOffset`
- Handles conversations longer than terminal height by slicing cached root lines instead of re-entering the host render path

### Testing

Run from workspace root:
```bash
npm test -- --run extensions/pi-shmitline
```

Tests mock `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui` via `test/mocks.ts` and `test/tui-mock.ts`. The mock host supplies footer data through `setFooter`, exposes the real widget surface via `setWidget`, and drives lifecycle through `session_start`. Current tests cover:
- Config validation (types, defaults)
- Global/project config-layer merging through the production merge helper
- Cluster rendering (lines, cursor, truncation)
- Script executor (success, error, timeout, JSON stdin)
- Shortcut matching and resolution
- Extension lifecycle (idempotent startup, listener cleanup, layout restoration, session events)
- Root-proxy compositor behavior (single-pass scroll wrapping, wheel and keyboard input, dynamic cluster sizing, overlays, and cleanup)
- Application selection behavior (root and cluster selection, multiline and reverse drags, double-click, OSC/wide glyph handling, right-click, and Ctrl+C fallthrough)
- Clipboard delivery (local command success, OSC52 fallback, size rejection, and user notifications) without writing to the host clipboard

Run `npx tsc -p extensions/pi-shmitline/tsconfig.test.json` before the targeted compositor tests whenever the harness or its imported test surfaces change.

For pi-shmitline input tests, keep the fast compositor tests as the exhaustive layer: capture the function registered through `tui.addInputListener()` and pass complete terminal input packets to it. Use these SGR mouse packets unless the protocol handling changes:

- `\x1b[<64;<col>;<row>M` — wheel up
- `\x1b[<65;<col>;<row>M` — wheel down
- `\x1b[<0;<col>;<row>M` — left-button press
- `\x1b[<32;<col>;<row>M` — left-button drag
- `\x1b[<0;<col>;<row>m` — left-button release
- `\x1b[<2;<col>;<row>M` — right-button press

Coordinates are one-based terminal columns and rows. Tests must cover packets concatenated in one input chunk and modifier bits on wheel packets, because `parseSgrMousePackets()` accepts only input made entirely of complete SGR packets. Keyboard tests should pass the same escape sequences Pi receives, including PageUp/PageDown and Ctrl+C.

Selection tests must preserve the interaction contract: drag release copies while leaving the selection highlighted; the first Ctrl+C with a selection copies it again, clears the highlight, and returns `undefined` so Pi still receives Ctrl+C. Assertions should verify both the copy callback and the fallthrough result.

Add a smaller full-host tmux layer when changing compositor installation, terminal modes, fixed-region placement, or input routing. Follow the repository-level model-free TUI procedure, use a fixed terminal size, wait for the `pi-shmitline` extension sentinel, and assert that conversation rows remain above the fixed status/editor/footer cluster after injected wheel or keyboard input. Inject raw SGR packets for mouse behavior; do not depend on a physical pointer. Use `PI_TUI_WRITE_LOG` only to diagnose emitted mode or repaint sequences, not as the visible-screen oracle.

### Validation

```bash
npm test -- --run extensions/pi-shmitline
```

All imports in `index.ts` resolve to existing files. The extension is listed in root `package.json` under `pi.extensions`.
