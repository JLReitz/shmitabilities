import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { EventEmitter } from "node:events";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  checkHeadroomHealth,
  HeadroomRuntime,
  loadHeadroomConfig,
  metadataFromModelEvent,
  proxyEnvironment,
  resolveConfigPath,
  stopProcess,
} from "../src/runtime.ts";
import { mergeConfigLayers } from "../src/config.ts";
import registerHeadroomExtension from "../index.ts";

describe("pi-headroom runtime config loading", () => {
  const originalHome = process.env.HOME;
  const temps: string[] = [];

  afterEach(() => {
    process.env.HOME = originalHome;
    vi.restoreAllMocks();
    for (const path of temps.splice(0)) rmSync(path, { recursive: true, force: true });
  });

  it("loads user and project headroom.json with project overrides", () => {
    const home = mkdtempSync(join(tmpdir(), "pi-headroom-home-"));
    const cwd = mkdtempSync(join(tmpdir(), "pi-headroom-cwd-"));
    temps.push(home, cwd);
    process.env.HOME = home;
    mkdirSync(join(home, ".pi", "agent"), { recursive: true });
    mkdirSync(join(cwd, ".pi"), { recursive: true });
    writeFileSync(
      resolveConfigPath("user", cwd),
      JSON.stringify({ proxy: { port: 8788, env: { HEADROOM_TRACE: "0" } } }),
    );
    writeFileSync(
      resolveConfigPath("project", cwd),
      JSON.stringify({ proxy: { env: { HEADROOM_TRACE: "1" } }, routing: { defaultUpstream: "openrouter" } }),
    );

    const loaded = loadHeadroomConfig(cwd);

    expect(loaded.config.proxy.port).toBe(8788);
    expect(loaded.config.proxy.env).toEqual({ HEADROOM_TRACE: "1" });
    expect(loaded.config.routing.defaultUpstream).toBe("openrouter");
    expect(loaded.issues).toEqual([]);
  });

  it("reports malformed configuration JSON as a startup issue", () => {
    const home = mkdtempSync(join(tmpdir(), "pi-headroom-home-"));
    const cwd = mkdtempSync(join(tmpdir(), "pi-headroom-cwd-"));
    temps.push(home, cwd);
    process.env.HOME = home;
    mkdirSync(join(home, ".pi", "agent"), { recursive: true });
    writeFileSync(resolveConfigPath("user", cwd), "{not JSON");

    const loaded = loadHeadroomConfig(cwd);

    expect(loaded.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ severity: "error", field: "config.user", message: expect.stringContaining("invalid JSON") }),
      ]),
    );
  });

  it("stops an active route and MCP bridge before rejecting a reload-time config error", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-headroom-cwd-"));
    temps.push(cwd);
    mkdirSync(join(cwd, ".pi"), { recursive: true });
    writeFileSync(resolveConfigPath("project", cwd), "{not JSON");
    const runtime = new HeadroomRuntime();
    const mcp = { stop: vi.fn() };
    const state = (runtime as any).state;
    state.config = mergeConfigLayers({}, {});
    state.mcp = mcp;
    state.registeredProvider = "openai-compatible";
    const unregisterProvider = vi.fn();

    await runtime.start({ cwd, ui: {} }, { unregisterProvider });

    expect(mcp.stop).toHaveBeenCalledOnce();
    expect(unregisterProvider).toHaveBeenCalledWith("openai-compatible");
    expect(runtime.getState().lastError).toContain("config.project");
  });
});

describe("pi-headroom runtime helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("requires health responses to identify Headroom", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("ok", { status: 200, headers: { "content-type": "text/plain" } })),
    );

    await expect(checkHeadroomHealth("http://127.0.0.1:8787", "/health")).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        message: "headroom: health endpoint did not identify Headroom",
      }),
    );
  });

  it("accepts Headroom-specific health responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response('{"service":"headroom","ok":true}', { status: 200 })),
    );

    await expect(checkHeadroomHealth("http://127.0.0.1:8787", "/health")).resolves.toEqual(
      expect.objectContaining({
        ok: true,
      }),
    );
  });

  it("maps model select events into harness metadata", () => {
    expect(
      metadataFromModelEvent({
        provider: "OpenRouter",
        api: "openai-compatible",
        baseUrl: "https://openrouter.ai/api/v1",
        id: "anthropic/claude-sonnet-4",
        name: "Claude Sonnet 4",
        contextWindow: 200000,
        maxTokens: 64000,
      }),
    ).toEqual({
      providerName: "OpenRouter",
      providerFamily: "openai-compatible",
      providerBaseUrl: "https://openrouter.ai/api/v1",
      modelId: "anthropic/claude-sonnet-4",
      modelName: "Claude Sonnet 4",
      contextWindow: 200000,
      maxTokens: 64000,
    });
  });

  it("combines state environment and non-secret proxy environment", () => {
    const config = mergeConfigLayers(
      {
        proxy: { env: { HEADROOM_SAVINGS_PROFILE: "coding" } },
        state: { configDir: "/tmp/headroom-config", workspaceDir: "/tmp/headroom-workspace" },
      },
      {},
    );

    expect(proxyEnvironment(config)).toEqual(
      expect.objectContaining({
        HEADROOM_CONFIG_DIR: "/tmp/headroom-config",
        HEADROOM_WORKSPACE_DIR: "/tmp/headroom-workspace",
        HEADROOM_SAVINGS_PROFILE: "coding",
      }),
    );
  });

  it("unregisters the prior provider before applying a changed route", async () => {
    const originalAnthropicApiKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "test-key";
    const runtime = new HeadroomRuntime();
    const state = (runtime as any).state;
    state.config = mergeConfigLayers({}, {});
    state.proxyUrl = "http://127.0.0.1:8787";
    state.metadata = { sessionId: "session-1" };
    state.registeredProvider = "openai-compatible";
    const unregisterProvider = vi.fn();
    const registerProvider = vi.fn();

    try {
      await runtime.refreshRoute(
        {},
        { unregisterProvider, registerProvider },
        { providerName: "anthropic", providerFamily: "anthropic", modelId: "claude" },
      );
    } finally {
      if (originalAnthropicApiKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = originalAnthropicApiKey;
    }

    expect(unregisterProvider).toHaveBeenCalledWith("openai-compatible");
    expect(registerProvider).toHaveBeenCalledWith(
      "anthropic",
      expect.objectContaining({ baseUrl: "http://127.0.0.1:8787" }),
    );
  });

  it("clears routing on a missing model credential and recovers on a valid selection", async () => {
    const originalAnthropicApiKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const runtime = new HeadroomRuntime();
    const state = (runtime as any).state;
    state.config = mergeConfigLayers({}, {});
    state.proxyUrl = "http://127.0.0.1:8787";
    state.registeredProvider = "openai-compatible";
    const unregisterProvider = vi.fn();
    const registerProvider = vi.fn();

    try {
      await runtime.refreshRoute(
        { ui: {} },
        { unregisterProvider, registerProvider },
        { providerName: "anthropic", providerFamily: "anthropic", modelId: "claude" },
      );

      expect(unregisterProvider).toHaveBeenCalledWith("openai-compatible");
      expect(registerProvider).not.toHaveBeenCalled();
      expect(runtime.getState().lastError).toBe("headroom: missing ANTHROPIC_API_KEY");

      process.env.ANTHROPIC_API_KEY = "test-key";
      await runtime.refreshRoute(
        { ui: {} },
        { unregisterProvider, registerProvider },
        { providerName: "anthropic", providerFamily: "anthropic", modelId: "claude" },
      );
    } finally {
      if (originalAnthropicApiKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = originalAnthropicApiKey;
    }

    expect(registerProvider).toHaveBeenCalledWith(
      "anthropic",
      expect.objectContaining({ baseUrl: "http://127.0.0.1:8787" }),
    );
    expect(runtime.getState().lastError).toBeNull();
  });

  it("registers the model_change compatibility handler", () => {
    const handlers = new Map<string, unknown[]>();
    registerHeadroomExtension({
      registerTool: vi.fn(),
      on: (event: string, handler: unknown) => handlers.set(event, [...(handlers.get(event) ?? []), handler]),
    });

    expect(handlers.get("model_change")).toHaveLength(1);
  });

  it("waits for a forced child-process exit before teardown completes", async () => {
    const child = new EventEmitter() as any;
    child.exitCode = null;
    child.signalCode = null;
    child.kill = vi.fn((signal: string) => {
      if (signal === "SIGKILL") {
        setTimeout(() => {
          child.signalCode = "SIGKILL";
          child.emit("exit", null, "SIGKILL");
        }, 10);
      }
      return true;
    });
    let completed = false;
    const stopping = stopProcess(child, 1).then(() => {
      completed = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(completed).toBe(false);
    await stopping;

    expect(child.kill).toHaveBeenNthCalledWith(1, "SIGTERM");
    expect(child.kill).toHaveBeenNthCalledWith(2, "SIGKILL");
    expect(completed).toBe(true);
  });

  it("forwards MCP tool calls only while the lifecycle bridge is available", async () => {
    const runtime = new HeadroomRuntime();
    const bridge = { callTool: vi.fn().mockResolvedValue({ saved: 12 }) };
    (runtime as any).state.mcp = bridge;

    await expect(runtime.callMcpTool("headroom_stats", { scope: "session" })).resolves.toEqual({ saved: 12 });
    expect(bridge.callTool).toHaveBeenCalledWith("headroom_stats", { scope: "session" });

    (runtime as any).state.mcp = null;
    await expect(runtime.callMcpTool("headroom_stats", {})).rejects.toThrow("headroom MCP bridge is not running");
  });
});
