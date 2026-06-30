import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createMockPi } from "./mocks.ts";
vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  return {
    ...actual,
    spawn: vi.fn(),
    spawnSync: vi.fn(() => ({ stdout: "", stderr: "", status: 0 })),
  };
});
import piShmitline, { copyTextToClipboard, scanChatTargets } from "../index.ts";
import { spawn, spawnSync } from "node:child_process";

describe("pi-shmitline extension", () => {
  let pi: any;
  let mockTerminal: any;
  let mockTui: any;
  let mockUi: any;
  let mockEditor: any;
  let mock: any;
  let ctx: any;

  beforeEach(() => {
    mock = createMockPi();
    pi = mock.pi;
    mockTerminal = mock.mockTerminal;
    mockTui = mock.mockTui;
    mockUi = mock.mockUi;
    mockEditor = mock.mockEditor;
    ctx = mock.ctx;
  });

  afterEach(() => {
    pi?.emit?.("session_shutdown");
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    rmSync("/tmp/pi-shmitline-mock-cwd", { recursive: true, force: true });
  });

  describe("lifecycle", () => {
    it("should install the compositor on session_start", () => {
      piShmitline(pi);

      pi.emit("session_start", { type: "session_start", entries: [] }, ctx);

      expect(pi.ui.setWidget).toHaveBeenCalledWith(
        "pi-shmitline.bridge",
        expect.any(Function),
        { placement: "aboveEditor" },
      );
      expect(mockTui.addInputListener).toHaveBeenCalled();
    });

    it("should install the compositor on session start events from the real host lifecycle", () => {
      piShmitline(pi);

      pi.emit("session", { type: "session", entries: [], reason: "start" }, ctx);

      expect(pi.ui.setWidget).toHaveBeenCalledWith(
        "pi-shmitline.bridge",
        expect.any(Function),
        { placement: "aboveEditor" },
      );
      expect(mockTui.addInputListener).toHaveBeenCalled();
    });

    it("should install the compositor when the bridge widget attaches after session bootstrap", () => {
      let bridgeFactory: ((tui: any) => any) | null = null;
      mockUi.setWidget = vi.fn((key: string, content: any, options?: { placement?: "aboveEditor" | "belowEditor" }) => {
        if (key === "pi-shmitline.bridge" && content && (options?.placement ?? "aboveEditor") === "aboveEditor") {
          bridgeFactory = content;
          return;
        }
      });
      pi.ui = mockUi;
      ctx.ui = mockUi;

      piShmitline(pi);

      pi.emit("session", { type: "session", entries: [], reason: "start" }, ctx);
      expect(mockTui.addInputListener).not.toHaveBeenCalled();

      expect(bridgeFactory).toBeTruthy();
      bridgeFactory?.(mockTui);

      expect(mockTui.addInputListener).toHaveBeenCalled();
    });

    it("should keep the host footer in the fixed cluster and leave editor rendering untouched", () => {
      piShmitline(pi);

      pi.emit("session_start", { type: "session_start", entries: [] }, ctx);

      const editorLines = mockEditor.render(80);
      expect(editorLines[0]).toBe(`╭${"─".repeat(78)}╮`);
      expect(mock.mockFooter.render(80)).toEqual([]);
      expect(mockUi.setWidget).not.toHaveBeenCalledWith(
        "pi-shmitline.footer",
        expect.anything(),
        expect.anything(),
      );
    });

    it("should reuse compositor and shortcut listeners on repeated session startup", () => {
      piShmitline(pi);

      pi.emit("session_start", { type: "session_start", entries: [] }, ctx);
      const firstListenerCount = mock.activeInputListeners.size;
      const firstListeners = [...mock.activeInputListeners];

      pi.emit("session_start", { type: "session_start", entries: [] }, ctx);

      expect(firstListenerCount).toBe(7);
      expect(mock.activeInputListeners.size).toBe(firstListenerCount);
      expect([...mock.activeInputListeners]).toEqual(firstListeners);
      expect(mockTui.addInputListener).toHaveBeenCalledTimes(firstListenerCount);
    });

    it("should restore the host layout and remove all listeners on session_shutdown", () => {
      piShmitline(pi);
      pi.emit("session_start", { type: "session_start", entries: [] }, ctx);
      expect(mock.activeInputListeners.size).toBe(7);
      expect(mockTui.children).toHaveLength(5);

      pi.emit("session_shutdown");

      expect(mock.activeInputListeners.size).toBe(0);
      expect(mockTui.children).toHaveLength(6);
      expect(mockTerminal.rows).toBe(24);
      expect(mock.mockAboveWidgetContainer.children).toEqual([]);
    });
  });

  describe("error handling", () => {
    it("should handle malformed context gracefully", () => {
      piShmitline(pi);

      // Simulate session with malformed context
      expect(() => {
        pi.emit("session_start", { type: "session_start", entries: [] }, null);
      }).not.toThrow();
    });

    it("should handle missing UI context gracefully", () => {
      piShmitline(pi);

      // Simulate session with no UI
      expect(() => {
        pi.emit("session_start", { type: "session_start", entries: [] }, { hasUI: false });
      }).not.toThrow();
    });
  });

  describe("clipboard", () => {
    it("uses the X11 clipboard command and reports success", () => {
      vi.stubEnv("DISPLAY", ":1");
      vi.stubEnv("WAYLAND_DISPLAY", "");
      vi.stubEnv("TERMUX_VERSION", "");
      vi.stubEnv("SSH_CONNECTION", "");
      vi.mocked(spawnSync).mockReturnValue({ status: 0 } as any);
      const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

      copyTextToClipboard(ctx, "selected text");

      expect(spawnSync).toHaveBeenCalledWith("xclip", ["-selection", "clipboard"], expect.objectContaining({
        input: "selected text",
      }));
      expect(stdoutWrite).not.toHaveBeenCalled();
      expect(mockUi.notify).toHaveBeenCalledWith("Copied selection to clipboard", "info");
    });

    it("falls back to OSC52 when no local clipboard transport is available", () => {
      vi.stubEnv("DISPLAY", "");
      vi.stubEnv("WAYLAND_DISPLAY", "");
      vi.stubEnv("TERMUX_VERSION", "");
      vi.stubEnv("SSH_CONNECTION", "");
      const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

      copyTextToClipboard(ctx, "copy me");

      expect(stdoutWrite).toHaveBeenCalledWith("\x1b]52;c;Y29weSBtZQ==\x07");
      expect(mockUi.notify).toHaveBeenCalledWith("Copied selection to clipboard", "info");
    });

    it("reports an error when an OSC52 fallback is too large", () => {
      vi.stubEnv("DISPLAY", "");
      vi.stubEnv("WAYLAND_DISPLAY", "");
      vi.stubEnv("TERMUX_VERSION", "");
      vi.stubEnv("SSH_CONNECTION", "");
      const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

      copyTextToClipboard(ctx, "x".repeat(75_001));

      expect(stdoutWrite).not.toHaveBeenCalled();
      expect(mockUi.notify).toHaveBeenCalledWith(
        "Failed to copy selection: no supported clipboard transport is available",
        "error",
      );
    });
  });

  describe("config validation", () => {
    it("should clear startup config errors on first submitted prompt", () => {
      const configDir = join(pi.cwd, ".pi");
      mkdirSync(configDir, { recursive: true });
      writeFileSync(
        join(configDir, "shmitline.json"),
        JSON.stringify({ statusScript: "/definitely/missing/script.sh" }, null, 2),
      );

      piShmitline(pi);
      pi.emit("session_start", { type: "session_start", entries: [] }, ctx);

      const rendersBeforeInput = mockTui.requestRender.mock.calls.length;
      pi.emit("input", { type: "input", text: "hello", source: "interactive" }, ctx);
      const rendersAfterInput = mockTui.requestRender.mock.calls.length;
      pi.emit("before_agent_start", { type: "before_agent_start", prompt: "hello" }, ctx);
      const rendersAfterFirstPrompt = mockTui.requestRender.mock.calls.length;
      pi.emit("before_agent_start", { type: "before_agent_start", prompt: "second" }, ctx);
      const rendersAfterSecondPrompt = mockTui.requestRender.mock.calls.length;

      expect(rendersAfterInput).toBe(rendersBeforeInput);
      expect(rendersAfterFirstPrompt).toBeGreaterThan(rendersAfterInput);
      expect(rendersAfterSecondPrompt).toBe(rendersAfterFirstPrompt);
    });

    it("should not wire shortcut listeners when shortcut config is invalid", () => {
      const configDir = join(pi.cwd, ".pi");
      mkdirSync(configDir, { recursive: true });
      writeFileSync(
        join(configDir, "shmitline.json"),
        JSON.stringify({
          shortcuts: {
            jumpPreviousUserMessage: 123,
          },
        }, null, 2),
      );

      piShmitline(pi);
      pi.emit("session_start", { type: "session_start", entries: [] }, ctx);

      expect(mockTui.addInputListener).toHaveBeenCalledTimes(1);
    });
  });

  describe("script execution", () => {
    it("should register script refresh events", () => {
      piShmitline(pi);

      expect(mock.listeners.get("turn_end")).toHaveLength(1);
      expect(mock.listeners.get("session")).toHaveLength(1);
      expect(mock.listeners.get("model_select")).toHaveLength(1);
      expect(mock.listeners.get("thinking_level_select")).toHaveLength(1);
      expect(mock.listeners.get("model_change")).toHaveLength(1);
      expect(mock.listeners.get("thinking_level_change")).toHaveLength(1);
      expect(mock.listeners.get("message_end") ?? []).toHaveLength(0);
    });

    it("should throttle only turn_end and allow immediate model/thinking refreshes", async () => {
      const scriptPath = join(pi.cwd, ".pi", "status-script.sh");
      mkdirSync(join(pi.cwd, ".pi"), { recursive: true });
      writeFileSync(join(pi.cwd, ".pi", "shmitline.json"), JSON.stringify({ statusScript: scriptPath }, null, 2));
      writeFileSync(scriptPath, "#!/bin/sh\nprintf 'ok'\n");
      chmodSync(scriptPath, 0o755);

      const mockSpawn = vi.mocked(spawn);
      mockSpawn.mockImplementation(() => ({
        stdout: { on: vi.fn((event: string, cb: any) => event === "data" && setTimeout(() => cb(Buffer.from("ok")), 0)) },
        stderr: { on: vi.fn() },
        on: vi.fn((event: string, cb: any) => event === "close" && setTimeout(() => cb(0), 0)),
      }) as any);

      const now = vi.spyOn(Date, "now");
      now.mockReturnValue(1_000);

      piShmitline(pi);
      pi.emit("session_start", { type: "session_start", entries: [] }, ctx);
      await new Promise((resolve) => setTimeout(resolve, 0));

      const callsAfterSessionStart = mockSpawn.mock.calls.length;
      pi.emit("turn_end", { type: "turn_end", message: { usage: { input: 100, output: 50 } } }, ctx);
      await new Promise((resolve) => setTimeout(resolve, 0));
      const callsAfterFirstTurnEnd = mockSpawn.mock.calls.length;

      pi.emit("turn_end", { type: "turn_end", message: { usage: { input: 100, output: 50 } } }, ctx);
      await new Promise((resolve) => setTimeout(resolve, 0));
      const callsAfterSecondTurnEnd = mockSpawn.mock.calls.length;

      pi.emit("model_change", { type: "model_change", modelId: "gpt-next" }, ctx);
      await new Promise((resolve) => setTimeout(resolve, 0));
      const callsAfterModelChange = mockSpawn.mock.calls.length;

      pi.emit("thinking_level_change", { type: "thinking_level_change", thinkingLevel: "high" }, ctx);
      await new Promise((resolve) => setTimeout(resolve, 0));
      const callsAfterThinkingChange = mockSpawn.mock.calls.length;

      expect(callsAfterFirstTurnEnd).toBe(callsAfterSessionStart + 1);
      expect(callsAfterSecondTurnEnd).toBe(callsAfterFirstTurnEnd);
      expect(callsAfterModelChange).toBe(callsAfterSecondTurnEnd + 1);
      expect(callsAfterThinkingChange).toBe(callsAfterModelChange + 1);
    });

    it("should serialize footer extension statuses and refresh when they change", async () => {
      const scriptPath = join(pi.cwd, ".pi", "status-script.mjs");
      mkdirSync(join(pi.cwd, ".pi"), { recursive: true });
      writeFileSync(join(pi.cwd, ".pi", "shmitline.json"), JSON.stringify({ statusScript: scriptPath }, null, 2));
      writeFileSync(scriptPath, "#!/usr/bin/env node\n");
      chmodSync(scriptPath, 0o755);

      mock.extensionStatuses.set("z-last", "last");
      mock.extensionStatuses.set("a-first", "first");
      const stdinEnd = vi.fn();
      vi.mocked(spawn).mockImplementation(() => ({
        stdin: { on: vi.fn(), end: stdinEnd },
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn((event: string, cb: any) => event === "close" && setTimeout(() => cb(0), 0)),
      }) as any);

      piShmitline(pi);
      pi.emit("session_start", { type: "session_start", reason: "startup" }, ctx);
      await new Promise((resolve) => setTimeout(resolve, 0));

      const initialInput = JSON.parse(stdinEnd.mock.calls[0][0]);
      expect(initialInput.extensionStatuses).toEqual([
        { key: "a-first", text: "first" },
        { key: "z-last", text: "last" },
      ]);

      mock.extensionStatuses.set("build", "running");
      mock.renderCustomFooter();
      await new Promise((resolve) => setTimeout(resolve, 0));

      const refreshedInput = JSON.parse(stdinEnd.mock.calls.at(-1)![0]);
      expect(refreshedInput.extensionStatuses).toContainEqual({ key: "build", text: "running" });
      expect(stdinEnd).toHaveBeenCalledTimes(2);
    });
  });

  describe("message jumping", () => {
    it("should account for transcript separators and stripped blank edges", () => {
      const userMessage = {
        constructor: { name: "UserMessageComponent" },
        render: vi.fn().mockReturnValue(["", "user", ""]),
      };
      const assistantMessage = {
        constructor: { name: "AssistantMessageComponent" },
        render: vi.fn().mockReturnValue(["assistant"]),
      };
      const llmMessage = {
        constructor: { name: "LlmMessageComponent" },
        render: vi.fn().mockReturnValue(["", "llm line 1", "llm line 2", ""]),
      };
      const chatContainer = {
        constructor: { name: "ChatTranscript" },
        children: [userMessage, assistantMessage, llmMessage],
      };
      const tui = {
        terminal: { columns: 80 },
        children: [chatContainer],
      };
      const compositor = {
        getRootChildLineOffset: vi.fn().mockReturnValue(3),
      };

      expect(scanChatTargets(tui, compositor as any)).toEqual({
        userLines: [3],
        assistantLines: [5, 7],
      });
    });

    it("should measure child rows at the real terminal width", () => {
      const userMessage = {
        constructor: { name: "UserMessageComponent" },
        render: vi.fn().mockImplementation((width: number) => width >= 100 ? ["wide row"] : ["narrow row 1", "narrow row 2"]),
      };
      const assistantMessage = {
        constructor: { name: "AssistantMessageComponent" },
        render: vi.fn().mockReturnValue(["assistant"]),
      };
      const chatContainer = {
        constructor: { name: "ChatTranscript" },
        children: [userMessage, assistantMessage],
      };
      const tui = {
        terminal: { columns: 120 },
        children: [chatContainer],
      };
      const compositor = {
        getRootChildLineOffset: vi.fn().mockReturnValue(10),
      };

      expect(scanChatTargets(tui, compositor as any)).toEqual({
        userLines: [10],
        assistantLines: [12],
      });
      expect(userMessage.render).toHaveBeenCalledWith(120);
    });

    it("should anchor offsets to the top-level root child that owns the chat container", () => {
      const assistantMessage = {
        constructor: { name: "AssistantMessageComponent" },
        render: vi.fn().mockReturnValue(["assistant"]),
      };
      const chatContainer = {
        constructor: { name: "ChatTranscript" },
        children: [assistantMessage],
      };
      const nestedRootChild = {
        constructor: { name: "Pane" },
        children: [chatContainer],
      };
      const tui = {
        terminal: { columns: 90 },
        children: [nestedRootChild],
      };
      const compositor = {
        getRootChildLineOffset: vi.fn().mockImplementation((target: any) => target === nestedRootChild ? 14 : null),
      };

      expect(scanChatTargets(tui, compositor as any)).toEqual({
        userLines: [],
        assistantLines: [14],
      });
    });
  });
});
