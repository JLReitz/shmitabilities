import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const runtime = {
    start: vi.fn(),
    refreshRoute: vi.fn(),
    stop: vi.fn(),
    callMcpTool: vi.fn(),
  };
  return {
    runtime,
    HeadroomRuntime: vi.fn(function () { return runtime; }),
    metadataFromModelEvent: vi.fn((model) => ({ modelId: model.id, providerName: model.provider })),
  };
});

vi.mock("../src/runtime.ts", () => ({
  HeadroomRuntime: mocks.HeadroomRuntime,
  metadataFromModelEvent: mocks.metadataFromModelEvent,
}));

import registerHeadroomExtension from "../index.ts";

afterEach(() => {
  vi.clearAllMocks();
});

describe("pi-headroom entrypoint", () => {
  it("registers each MCP tool and forwards lifecycle events", async () => {
    const tools: any[] = [];
    const handlers = new Map<string, any>();
    const pi = {
      registerTool: vi.fn((tool) => tools.push(tool)),
      on: vi.fn((event, handler) => handlers.set(event, handler)),
    };
    const ctx = { cwd: "/workspace" };

    registerHeadroomExtension(pi);

    expect(tools.map((tool) => tool.name)).toEqual(["headroom_compress", "headroom_retrieve", "headroom_stats"]);
    expect([...handlers.keys()]).toEqual(["session_start", "model_select", "model_change", "session_shutdown"]);

    await handlers.get("session_start")({}, ctx);
    await handlers.get("model_select")({ model: { id: "model-1", provider: "OpenRouter" } }, ctx);
    await handlers.get("model_change")({ modelId: "model-2" }, ctx);
    await handlers.get("session_shutdown")();

    expect(mocks.runtime.start).toHaveBeenCalledWith(ctx, pi);
    expect(mocks.metadataFromModelEvent).toHaveBeenCalledWith({ id: "model-1", provider: "OpenRouter" });
    expect(mocks.runtime.refreshRoute).toHaveBeenNthCalledWith(1, ctx, pi, { modelId: "model-1", providerName: "OpenRouter" });
    expect(mocks.runtime.refreshRoute).toHaveBeenNthCalledWith(2, ctx, pi, { modelId: "model-2", modelName: "model-2" });
    expect(mocks.runtime.stop).toHaveBeenCalledWith(pi);
  });

  it("wraps successful and failed MCP tool calls for Pi", async () => {
    const tools: any[] = [];
    registerHeadroomExtension({ registerTool: (tool: any) => tools.push(tool), on: vi.fn() });
    const tool = tools[0];

    mocks.runtime.callMcpTool.mockResolvedValueOnce({ content: [{ type: "text", text: "compressed" }, { type: "image", url: "x" }] });
    await expect(tool.execute("call-1", { prompt: "hello" })).resolves.toEqual({
      content: [{ type: "text", text: 'compressed\n{"type":"image","url":"x"}' }],
      details: { content: [{ type: "text", text: "compressed" }, { type: "image", url: "x" }] },
    });
    expect(mocks.runtime.callMcpTool).toHaveBeenCalledWith("headroom_compress", { prompt: "hello" });

    mocks.runtime.callMcpTool.mockResolvedValueOnce({ tokens: 12 });
    await expect(tool.execute("call-2", {})).resolves.toMatchObject({ content: [{ type: "text", text: '{\n  "tokens": 12\n}' }] });

    mocks.runtime.callMcpTool.mockResolvedValueOnce("already formatted");
    await expect(tool.execute("call-3", {})).resolves.toEqual({
      content: [{ type: "text", text: "already formatted" }],
      details: "already formatted",
    });

    mocks.runtime.callMcpTool.mockRejectedValueOnce(new Error("bridge down"));
    await expect(tool.execute("call-4", {})).resolves.toEqual({
      content: [{ type: "text", text: "bridge down" }],
      details: undefined,
      isError: true,
    });

    mocks.runtime.callMcpTool.mockRejectedValueOnce("plain failure");
    await expect(tool.execute("call-5", {})).resolves.toEqual({
      content: [{ type: "text", text: "plain failure" }],
      details: undefined,
      isError: true,
    });
  });
});
