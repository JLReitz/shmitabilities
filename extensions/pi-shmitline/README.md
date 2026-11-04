# pi-shmitline

A bottom-pinned editor and dynamic footer extension for pi.

## Features

### Pinned layout

The extension keeps the editor fixed at the bottom of the TUI, directly above the footer. The conversation viewport scrolls above that fixed bottom stack.

Rendered top-to-bottom:

1. **Conversation viewport** — scrollable chat/messages
2. **Runtime script error widget** — shown only when `statusScript` fails after startup; rendered inline inside the conversation region with multiline `「 ... 」` bracketing
3. **Editor** — the pi built-in editor content, permanently fixed above the footer
4. **Footer** — dynamic-height footer owned by the status script, rendered through the fixed bottom cluster below the editor

### Message jumping

Keyboard shortcuts to jump between user and assistant messages in the chat transcript.

| Action | Default shortcut(s) |
|---|---|
| Jump to previous user message | `Ctrl+Up` |
| Jump to next user message | `Ctrl+Down` |
| Jump to previous assistant message | `Ctrl+Alt+Up` |
| Jump to next assistant message | `Ctrl+Alt+Down` |
| Jump to chat bottom | `Ctrl+Shift+G`, `Ctrl+End` |

Shortcuts are configurable in `shmitline.json`. Each shortcut accepts a string or array of strings — all configured keys are active.

### Conversation selection and copy

With mouse scrolling enabled, drag across conversation or fixed-cluster text to select it. Releasing the mouse copies the selected text to the system clipboard and leaves the selection highlighted. The first `Ctrl+C` copies the selection again, clears the highlight, and then falls through to Pi's normal `Ctrl+C` behavior. Scrolling or starting another selection also clears or replaces the current selection.

### User-provided footer script

Generate the footer with a custom executable script. Configure the script path in `shmitline.json`:

```json
{
  "statusScript": "~/.config/pi/statusline.sh"
}
```

The script's stdout becomes the footer content. Multi-line output produces a multi-line footer and increases the reserved footer height to match. ANSI sequences and unicode are fully supported.

Footer behavior:

- If `statusScript` is an empty string, pi-shmitline falls back to the default Pi footer.
- If the script exits non-zero, pi-shmitline falls back to the default Pi footer and shows the runtime error widget above the editor.
- If the script exits `0` with non-empty stdout, the footer renders exactly that stdout.
- If the script exits `0` with empty stdout, the footer stays empty.

#### Trigger

The script is invoked at session start and after turn, model, thinking-level, Git-branch, or extension-status changes. Only turn-completion invocations use the 5-second throttle.

#### JSON input

The script receives one versioned JSON object on standard input. Pi-shmitline does not define `PI_SHMITLINE_*` environment variables.

```ts
interface StatusScriptInput {
  version: 1;
  terminal: { width: number };
  context: { tokens: number | null; contextWindow: number; percent: number | null };
  usage: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    totalTokens: number;
    cacheHitPercent: number;
    cost: number;
  };
  model: {
    id: string;
    name: string;
    provider: string;
    reasoning: boolean;
    contextWindow: number;
    maxTokens: number;
  } | null;
  thinkingLevel: string | null;
  session: { id: string; name: string | null; cwd: string };
  git: { branch: string | null; status: string };
  extensionStatuses: Array<{ key: string; text: string }>;
  time: string;
}
```

Usage totals include completed assistant messages across all session entries. `cacheHitPercent` is the cache-read share of input, cache-read, and cache-write tokens. Extension statuses come from Pi's footer data provider, are sorted by key, and refresh the script when `ctx.ui.setStatus()` changes them.

#### Behavior

- **Throttle**: turn-completion invocations are deduplicated within 5 seconds; other status changes refresh immediately.
- **Timeout**: scripts are killed after 200ms.
- **Fallback**: empty `statusScript` or non-zero exit uses the default Pi footer. Exit `0` with empty stdout renders an empty footer.
- **Concurrency**: latest invocation wins (previous is aborted).

#### Example script

[`examples/session-status.mjs`](examples/session-status.mjs) renders a two-line session status with context utilization, cumulative token and cache statistics, model/reasoning information, working directory, and an optional Git branch. It uses Node.js, which is already required by Pi, and reads the JSON document directly from stdin.

## Configuration

Configuration lives in `[~|...]/.pi/shmitline.json` (global or project scoped). Project config overrides global.

**All defaults are written to the config file on extension install.** Edit the file directly to customize.

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

- `statusScript`: absolute path or relative to the config file location. `~` expands to `$HOME`. Empty string means "use the default Pi footer".
- `mouseScroll`: enable mouse scroll in chat transcript (default `true`).
- `shortcuts`: each value is `string | string[]`. All configured keys are active.

### Error display

Config and runtime errors are split:

- **Config errors** are shown only at startup in the inline error widget above the editor, as a multiline `「 ... 」` block. They clear on the first submitted prompt (`before_agent_start`), not on raw `input`.
- **Runtime `statusScript` errors** are shown above the editor, without a separator from the conversation viewport, as a multiline `「 ... 」` block.

Runtime error conditions:

- `statusScript` not found → `statusScript not found: <path>`
- `statusScript` not executable → `statusScript not executable: <path>`
- `statusScript` exits nonzero → `statusScript exited with code <N>: <path>`
- `statusScript` times out → `statusScript timed out: <path>`
- Invalid shortcut type → `shortcuts.<key> must be string or string[]`

Runtime errors clear when the underlying issue resolves. Empty `statusScript` is valid and does not show an error.

## Comparison with pi-powerline-footer

| Feature | pi-powerline-footer | pi-shmitline |
|---|---|---|
| Bash mode | Full editor | Not supported |
| Welcome screen | Full overlay | Not supported |
| Working vibes | AI-generated messages | Not supported |
| Prompt history | Stash/search/restore | Not supported |
| Statusline | Built-in segments | User script footer with default Pi fallback |
| Message jumping | Yes | Yes |
| Fixed editor | Yes | Yes (permanent) |

## Requirements

- pi >= 0.1.0
- Nerd Font (for icon rendering, optional)
- Git (for branch/status display)
