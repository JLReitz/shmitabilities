import { afterEach, describe, expect, it, vi } from "vitest";

const childProcess = vi.hoisted(() => ({
  spawn: vi.fn(),
}));

vi.mock("node:child_process", () => childProcess);

import { McpStdioClient } from "../src/runtime.ts";
import { createMcpStdioHarness } from "./harness/mcp-stdio.ts";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("McpStdioClient JSON-RPC protocol", () => {
  it("initializes with newline-delimited JSON-RPC and sends initialized notification", async () => {
    const harness = createMcpStdioHarness({ initialize: "respond" });
    childProcess.spawn.mockReturnValue(harness.child);
    const client = new McpStdioClient("headroom", ["mcp", "serve"], { HEADROOM_TRACE: "1" });

    await client.start(100);

    expect(childProcess.spawn).toHaveBeenCalledWith(
      "headroom",
      ["mcp", "serve"],
      expect.objectContaining({ env: { HEADROOM_TRACE: "1" }, stdio: "pipe" }),
    );
    expect(harness.requests).toEqual([
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "pi-headroom", version: "0.0.0" },
        },
      },
      { jsonrpc: "2.0", method: "notifications/initialized", params: {} },
    ]);
  });

  it("buffers chunked output and ignores blank, malformed, notification, and unknown-id lines", async () => {
    const harness = createMcpStdioHarness({ initialize: "respond" });
    childProcess.spawn.mockReturnValue(harness.child);
    const client = new McpStdioClient("headroom", [], {});
    await client.start(100);

    const result = client.callTool("headroom_compress", { prompt: "hello" });
    expect(harness.requests.at(-1)).toEqual({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "headroom_compress", arguments: { prompt: "hello" } },
    });
    harness.writeRaw("\nnot json\n{\"jsonrpc\":\"2.0\",\"method\":\"log\"}\n{\"jsonrpc\":\"2.0\",\"id\":999,\"result\":true}\n");
    harness.writeRaw('{"jsonrpc":"2.0","id":2,"res');
    harness.writeRaw('ult":{"compressed":true}}\n');

    await expect(result).resolves.toEqual({ compressed: true });
  });

  it("rejects RPC errors with the server message or the protocol fallback", async () => {
    const harness = createMcpStdioHarness({ initialize: "respond" });
    childProcess.spawn.mockReturnValue(harness.child);
    const client = new McpStdioClient("headroom", [], {});
    await client.start(100);

    const namedError = client.callTool("headroom_stats", {});
    const namedErrorExpectation = expect(namedError).rejects.toThrow("upstream unavailable");
    harness.respondError(2, "upstream unavailable");
    await namedErrorExpectation;

    const fallbackError = client.callTool("headroom_stats", {});
    const fallbackErrorExpectation = expect(fallbackError).rejects.toThrow("MCP request failed");
    harness.respondError(3);
    await fallbackErrorExpectation;
  });

  it("rejects pending requests on bridge exit and reports an unexpected exit", async () => {
    const harness = createMcpStdioHarness({ initialize: "respond" });
    childProcess.spawn.mockReturnValue(harness.child);
    const onUnexpectedExit = vi.fn();
    const client = new McpStdioClient("headroom", [], {}, onUnexpectedExit);
    await client.start(100);

    const pending = client.callTool("headroom_retrieve", {});
    const pendingExpectation = expect(pending).rejects.toThrow("headroom MCP bridge exited");
    harness.child.emitExit(1, null);

    await pendingExpectation;
    expect(onUnexpectedExit).toHaveBeenCalledOnce();
  });

  it("rejects an unavailable bridge, times out initialization, and stops pending work without an unexpected-exit callback", async () => {
    const unavailable = new McpStdioClient("headroom", [], {});
    await expect(unavailable.callTool("headroom_stats", {})).rejects.toThrow("MCP bridge is not running");

    vi.useFakeTimers();
    const timeoutHarness = createMcpStdioHarness();
    childProcess.spawn.mockReturnValue(timeoutHarness.child);
    const timedOut = new McpStdioClient("headroom", [], {});
    const starting = timedOut.start(1);
    const timeoutExpectation = expect(starting).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(1);
    await timeoutExpectation;
    await timedOut.stop();

    vi.useRealTimers();
    const stopHarness = createMcpStdioHarness({ initialize: "respond" });
    childProcess.spawn.mockReturnValue(stopHarness.child);
    const onUnexpectedExit = vi.fn();
    const client = new McpStdioClient("headroom", [], {}, onUnexpectedExit);
    await client.start(100);
    const pending = client.callTool("headroom_stats", {});
    const pendingExpectation = expect(pending).rejects.toThrow("headroom MCP bridge stopped");
    await client.stop();

    await pendingExpectation;
    expect(stopHarness.child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(onUnexpectedExit).not.toHaveBeenCalled();
  });
});
