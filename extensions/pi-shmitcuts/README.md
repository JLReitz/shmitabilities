# Pi-ShmitKeys

Remap pi hotkeys to claude-style or any other customization.

## Reserved Pi Shortcuts (from KEYBINDINGS + APP_RESERVED_SHORTCUTS)

### App-level hotkeys:

| Shortcut       │ Action                       |
| -------------- | ---------------------------- |
| escape         │ Interrupt/cancel             │
| ctrl+c         │ Clear editor                 │
| ctrl+d         │ Exit when empty              │
| ctrl+z         │ Suspend                      │
| shift+tab      │ Cycle thinking level         │
│ ctrl+p         │ Cycle model forward          │
│ shift+ctrl+p   │ Cycle model backward         │
│ ctrl+l         │ Open model selector          │
│ ctrl+o         │ Toggle tool output           │
│ ctrl+t         │ Toggle thinking blocks       │
│ ctrl+n         │ Toggle named session filter  │
│ ctrl+g         │ Open external editor         │
│ alt+enter      │ Queue follow-up message      │
│ alt+up         │ Restore queued messages      │
│ alt+down       │ (reserved)                   │
│ ctrl+v / alt+v │ Paste image                  │
│ ctrl+s         │ Toggle session sort          │
│ shift+l        │ Edit tree label              │
│ shift+t        │ Toggle tree label timestamps │
│ ctrl+r         │ (reserved)                   │
│ alt+s          │ (extra reserved)             │

### TUI-level hotkeys (tui.editor.*):

│ Shortcut                             │ Action                 │
| ------------------------------------ | ---------------------- |
│ up / down / left / right             │ Cursor movement        │
│ ctrl+b / ctrl+f                      │ Word movement          │
│ alt+left / alt+right / alt+b / alt+f │ Cursor word left/right │
│ home / end                           │ Line start/end         │
│ ctrl+a / ctrl+e                      │ Line start/end         │
│ ctrl+] / ctrl+alt+]                  │ Jump forward/backward  │
│ pageUp / pageDown                    │ Page up/down           │
│ backspace / delete                   │ Delete char            │
│ ctrl+d                               │ Delete char forward    │
│ ctrl+w / alt+backspace               │ Delete word backward   │
│ alt+d / alt+delete                   │ Delete word forward    │
│ ctrl+u                               │ Delete to line start   │
│ ctrl+k                               │ Delete to line end     │
│ ctrl+y                               │ Yank                   │
│ alt+y                                │ Yank pop               │
│ ctrl+-                               │ Undo                   │
│ shift+enter / ctrl+j                 │ New line               │
│ enter                                │ Submit                 │
│ tab                                  │ Autocomplete           │
│ ctrl+c                               │ Copy selection         │