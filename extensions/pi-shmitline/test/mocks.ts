import { vi } from "vitest";

function createContainer() {
  return {
    children: [] as any[],
    render(width: number) {
      return this.children.flatMap((child) => {
        if (typeof child?.render === "function") {
          return child.render(width);
        }
        return [];
      });
    },
    invalidate: vi.fn(),
  };
}

export function createMockPi() {
  const listeners = new Map<string, Array<(event: any, ctx: any) => void>>();
  const widgetsAbove = new Map<string, any>();
  const activeInputListeners = new Set<(data: string) => any>();
  const inputListenerDisposers: ReturnType<typeof vi.fn>[] = [];

  const terminalWrite = vi.fn();
  const mockTerminal = {
    columns: 80,
    rows: 24,
    write: terminalWrite,
  };

  const mockEditor = {
    render: vi.fn((width: number) => [`╭${"─".repeat(Math.max(0, width - 2))}╮`, "Mock editor", `╰${"─".repeat(Math.max(0, width - 2))}╯`]),
    invalidate: vi.fn(),
    getText: vi.fn().mockReturnValue(""),
    handleInput: vi.fn(),
  };

  const mockEditorContainer = {
    children: [mockEditor],
    render: vi.fn((width: number) => mockEditor.render(width)),
    invalidate: vi.fn(),
  };

  const mockChatContainer = {
    constructor: { name: "ChatContainer" },
    children: [],
    render: vi.fn().mockReturnValue(["Mock chat"]),
    invalidate: vi.fn(),
  };

  const mockPendingMessagesContainer = {
    constructor: { name: "PendingMessagesContainer" },
    children: [],
    render: vi.fn().mockReturnValue([]),
    invalidate: vi.fn(),
  };

  const mockStatusContainer = {
    constructor: { name: "StatusContainer" },
    render: vi.fn().mockReturnValue(["Mock status line"]),
    invalidate: vi.fn(),
  };

  const mockAboveWidgetContainer = createContainer();
  const mockFooter = {
    constructor: { name: "FooterComponent" },
    render: vi.fn().mockReturnValue(["Mock Pi footer"]),
    invalidate: vi.fn(),
  };

  const extensionStatuses = new Map<string, string>();
  const branchChangeCallbacks = new Set<() => void>();
  const mockFooterData = {
    getGitBranch: vi.fn().mockReturnValue("main"),
    getExtensionStatuses: vi.fn(() => extensionStatuses),
    getAvailableProviderCount: vi.fn().mockReturnValue(1),
    onBranchChange: vi.fn((callback: () => void) => {
      branchChangeCallbacks.add(callback);
      return () => branchChangeCallbacks.delete(callback);
    }),
  };

  const mockTui = {
    children: [
      mockChatContainer,
      mockPendingMessagesContainer,
      mockStatusContainer,
      mockAboveWidgetContainer,
      mockEditorContainer,
      mockFooter,
    ],
    terminal: mockTerminal,
    requestRender: vi.fn(),
    hasOverlay: vi.fn().mockReturnValue(false),
    addInputListener: vi.fn((listener: (data: string) => any) => {
      activeInputListeners.add(listener);
      const disposer = vi.fn(() => activeInputListeners.delete(listener));
      inputListenerDisposers.push(disposer);
      return disposer;
    }),
    render: vi.fn((width: number) => mockTui.children.flatMap((child: any) => child.render?.(width) ?? [])),
    doRender: vi.fn(),
  };

  const rebuildWidgets = () => {
    mockAboveWidgetContainer.children = [...widgetsAbove.values()];
  };
  let renderCustomFooter = () => [] as string[];

  const mockUi = {
    notify: vi.fn(),
    setFooter: vi.fn((factory: any) => {
      const footerIndex = mockTui.children.length - 1;
      if (factory) {
        const component = factory(mockTui, {}, mockFooterData);
        renderCustomFooter = component.render.bind(component);
        mockTui.children[footerIndex] = component;
      } else {
        mockTui.children[footerIndex] = mockFooter;
      }
    }),
    setWidget: vi.fn((key: string, content: any, options?: { placement?: "aboveEditor" | "belowEditor" }) => {
      if ((options?.placement ?? "aboveEditor") === "belowEditor") {
        return;
      }
      if (content === undefined) {
        widgetsAbove.delete(key);
        rebuildWidgets();
        return;
      }
      const component = Array.isArray(content)
        ? { render: () => [...content], invalidate: vi.fn(), dispose: vi.fn() }
        : content(mockTui, {});
      widgetsAbove.set(key, component);
      rebuildWidgets();
    }),
  };

  const mockSessionManager = {
    getBranch: vi.fn().mockReturnValue([]),
    getSessionId: vi.fn().mockReturnValue("mock-session-id"),
  };

  const pi = {
    on: (event: string, handler: (event: any, ctx: any) => void) => {
      if (!listeners.has(event)) {
        listeners.set(event, []);
      }
      listeners.get(event)!.push(handler);
      return pi;
    },
    off: (event: string, handler: (event: any, ctx: any) => void) => {
      const handlers = listeners.get(event);
      if (handlers) {
        const index = handlers.indexOf(handler);
        if (index !== -1) {
          handlers.splice(index, 1);
        }
      }
      return pi;
    },
    emit: (event: string, ...args: any[]) => {
      const handlers = listeners.get(event) || [];
      handlers.forEach((handler) => handler(...args));
    },
    removeAllListeners: (event?: string) => {
      if (event) {
        listeners.delete(event);
      } else {
        listeners.clear();
      }
    },
    ui: mockUi,
    sessionManager: mockSessionManager,
    cwd: "/tmp/pi-shmitline-mock-cwd",
    model: {
      id: "mock-model",
      contextWindow: 100000,
    },
    thinkingLevel: "off",
    getThinkingLevel: vi.fn().mockReturnValue("low"),
    sessionStartTime: Date.now(),
    hasUI: true,
    exec: vi.fn().mockResolvedValue({ stdout: "", stderr: "", code: 0 }),
  };

  const ctx = {
    hasUI: true,
    ui: mockUi,
    cwd: pi.cwd,
    sessionManager: mockSessionManager,
    model: pi.model,
    thinkingLevel: pi.thinkingLevel,
    terminal: mockTerminal,
  };

  return {
    pi,
    ctx,
    mockTerminal,
    terminalWrite,
    mockTui,
    mockUi,
    mockSessionManager,
    mockStatusContainer,
    mockAboveWidgetContainer,
    mockFooter,
    mockFooterData,
    extensionStatuses,
    renderCustomFooter: () => renderCustomFooter(),
    mockEditor,
    mockEditorContainer,
    listeners,
    activeInputListeners,
    inputListenerDisposers,
    sendInput: (data: string) => [...activeInputListeners].map((listener) => listener(data)),
  };
}
