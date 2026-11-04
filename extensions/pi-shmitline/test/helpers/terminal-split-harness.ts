import { vi } from "vitest";
import { TerminalSplitCompositor } from "../../src/components/terminal-split.ts";
import type { FixedEditorClusterRender } from "../../src/components/cluster.ts";

type InputResult = { consume?: boolean; data?: string } | undefined;

interface HarnessOptions {
  columns?: number;
  rows?: number;
  rootLines?: string[];
  cluster?: FixedEditorClusterRender;
  mouseScroll?: boolean;
  keyboardScrollShortcuts?: { up: string; down: string };
  overlayVisible?: boolean;
}

export function createTerminalSplitHarness(options: HarnessOptions = {}) {
  let rawRows = options.rows ?? 6;
  let rootLines = options.rootLines ?? ["line-1", "line-2"];
  let cluster = options.cluster ?? { lines: ["editor"], cursor: null };
  let overlayVisible = options.overlayVisible ?? false;
  let inputListener: ((data: string) => InputResult) | null = null;

  const terminal = {
    columns: options.columns ?? 80,
    kittyProtocolActive: false,
    write: vi.fn(),
    get rows() {
      return rawRows;
    },
  };
  const root = {
    render: vi.fn(() => [...rootLines]),
  };
  const editor = {
    render: vi.fn(() => ["host-editor"]),
  };
  const removeInputListener = vi.fn(() => {
    inputListener = null;
  });
  const tui: any = {
    children: [root, editor],
    terminal,
    render: vi.fn((width: number) => tui.children.flatMap((child: any) => child.render?.(width) ?? [])),
    doRender: vi.fn(),
    requestRender: vi.fn(),
    hasOverlay: vi.fn(() => overlayVisible),
    addInputListener: vi.fn((listener: (data: string) => InputResult) => {
      inputListener = listener;
      return removeInputListener;
    }),
  };
  const copied: string[] = [];
  const compositor = new TerminalSplitCompositor({
    tui,
    terminal,
    renderCluster: () => cluster,
    mouseScroll: options.mouseScroll,
    keyboardScrollShortcuts: options.keyboardScrollShortcuts,
    onCopySelection: (text) => copied.push(text),
  });
  const originalChildren = [...tui.children];
  const originalWrite = terminal.write;
  const originalDoRender = tui.doRender;

  compositor.mountScrollableRoot(1);
  compositor.install();
  const installedWrite = terminal.write;
  const installedDoRender = tui.doRender;

  return {
    compositor,
    copied,
    editor,
    originalChildren,
    originalDoRender,
    originalWrite,
    installedDoRender,
    installedWrite,
    removeInputListener,
    root,
    terminal,
    tui,
    proxy: () => tui.children[0] as { render(width: number): string[] },
    renderRoot: (width = terminal.columns) => (tui.children[0] as { render(width: number): string[] }).render(width),
    sendInput: (data: string) => inputListener?.(data),
    setCluster: (next: FixedEditorClusterRender) => {
      cluster = next;
    },
    setOverlayVisible: (visible: boolean) => {
      overlayVisible = visible;
    },
    setRootLines: (lines: string[]) => {
      rootLines = lines;
    },
    setRows: (rows: number) => {
      rawRows = rows;
    },
  };
}
