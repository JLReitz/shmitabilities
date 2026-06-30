import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const childProcess = vi.hoisted(() => ({
  spawn: vi.fn(),
  spawnSync: vi.fn(),
}));

vi.mock("node:child_process", () => childProcess);

import { HeadroomRuntime, resolveConfigPath } from "../src/runtime.ts";
import { createFakeChild } from "./helpers/fake-child.ts";
import { createMcpStdioHarness } from "./harness/mcp-stdio.ts";

const temps: string[] = [];
const originalOpenRouterKey = process.env.OPENROUTER_API_KEY;

function projectConfig(value: unknown): string {
  const cwd = mkdtempSync(join(tmpdir(), "pi-headroom-lifecycle-"));
  temps.push(cwd);
  mkdirSync(join(cwd, ".pi"), { recursive: true });
  writeFileSync(resolveConfigPath("project", cwd), JSON.stringify(value));
  return cwd;
}

function headroomResponse(): Response {
  return new Response('{"service":"headroom"}', { status: 200 });
}

function context(cwd: string, ui: Record<string, unknown> = {}): any {
  return {
    cwd,
    model: { provider: "OpenRouter", api: "openai-compatible", id: "anthropic/claude-sonnet-4" },
    sessionManager: { getSessionId: () => "session-1" },
    ui,
  };
}

afterEach(() => {
  if (originalOpenRouterKey === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = originalOpenRouterKey;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const path of temps.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("pi-headroom runtime lifecycle", () => {
  it("disables a session after clearing its prior route and owned MCP bridge", async () => {
    const runtime = new HeadroomRuntime();
    const state = (runtime as any).state;
    const mcp = { stop: vi.fn() };
    state.mcp = mcp;
    state.registeredProvider = "openai-compatible";
    const unregisterProvider = vi.fn();
    const setStatus = vi.fn();

    await runtime.start(context(projectConfig({ enabled: false }), { setStatus }), { unregisterProvider });

    expect(unregisterProvider).toHaveBeenCalledWith("openai-compatible");
    expect(mcp.stop).toHaveBeenCalledOnce();
    expect(childProcess.spawnSync).not.toHaveBeenCalled();
    expect(childProcess.spawn).not.toHaveBeenCalled();
    expect(setStatus).toHaveBeenLastCalledWith("headroom", "headroom: disabled");
  });

  it("adopts a healthy managed proxy and registers only its local route", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    childProcess.spawnSync.mockReturnValue({ status: 0, stdout: "headroom 1", stderr: "" });
    vi.stubGlobal("fetch", vi.fn(async () => headroomResponse()));
    const registerProvider = vi.fn();

    await new HeadroomRuntime().start(context(projectConfig({ mcp: { enabled: false } })), { registerProvider });

    expect(childProcess.spawn).not.toHaveBeenCalled();
    expect(registerProvider).toHaveBeenCalledWith("openai-compatible", {
      baseUrl: "http://127.0.0.1:8787",
      headers: {
        "x-headroom-session-id": "session-1",
        "x-headroom-base-url": "https://openrouter.ai/api/v1",
      },
    });
  });

  it("starts and owns an unhealthy managed proxy after it becomes healthy", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    childProcess.spawnSync.mockReturnValue({ status: 0, stdout: "headroom 1", stderr: "" });
    const child = createFakeChild();
    childProcess.spawn.mockReturnValue(child);
    let probes = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      probes += 1;
      return probes === 1 ? new Response("other service", { status: 200 }) : headroomResponse();
    }));
    const runtime = new HeadroomRuntime();
    const unregisterProvider = vi.fn();
    const setStatus = vi.fn();
    const notify = vi.fn();

    await runtime.start(
      context(projectConfig({ mcp: { enabled: false }, state: { stateless: true } }), { setStatus, notify }),
      { registerProvider: vi.fn(), unregisterProvider },
    );

    expect(childProcess.spawn).toHaveBeenCalledWith(
      "headroom",
      ["proxy", "--host", "127.0.0.1", "--port", "8787", "--backend", "openrouter", "--mode", "cache", "--stateless"],
      expect.objectContaining({ stdio: "pipe", env: expect.objectContaining({ OPENROUTER_API_KEY: "test-key" }) }),
    );
    expect(runtime.getState().proxyProcess).toBe(child);
    child.emit("exit", 1, null);
    expect(runtime.getState().lastError).toBe("proxy exited 1");
    expect(unregisterProvider).toHaveBeenCalledWith("openai-compatible");
    expect(setStatus).toHaveBeenLastCalledWith("headroom", "headroom: error: proxy exited 1");
    expect(notify).toHaveBeenCalledWith("headroom: proxy exited 1", "error");
  });

  it("tears down an owned proxy when managed startup health never succeeds", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    childProcess.spawnSync.mockReturnValue({ status: 0, stdout: "headroom 1", stderr: "" });
    const child = createFakeChild();
    childProcess.spawn.mockReturnValue(child);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("other service", { status: 200 })));
    const runtime = new HeadroomRuntime();

    await runtime.start(
      context(projectConfig({ proxy: { startupTimeoutMs: 1, shutdownTimeoutMs: 1 }, mcp: { enabled: false } })),
      { registerProvider: vi.fn() },
    );

    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(runtime.getState()).toMatchObject({ proxyProcess: null, registeredProvider: null });
    expect(runtime.getState().lastError).toBe("headroom: health endpoint did not identify Headroom");
  });

  it("fails closed for missing binaries and credentials before registering or spawning", async () => {
    const registerProvider = vi.fn();
    const setStatus = vi.fn();
    const notify = vi.fn();
    childProcess.spawnSync.mockReturnValueOnce({ error: new Error("ENOENT") });

    await new HeadroomRuntime().start(context(projectConfig({ mcp: { enabled: false } }), { setStatus, notify }), { registerProvider });

    expect(registerProvider).not.toHaveBeenCalled();
    expect(childProcess.spawn).not.toHaveBeenCalled();
    expect(setStatus).toHaveBeenLastCalledWith("headroom", "headroom: error: headroom: command not found: headroom");
    expect(notify).toHaveBeenCalledWith("headroom: headroom: command not found: headroom", "error");

    delete process.env.OPENROUTER_API_KEY;
    childProcess.spawnSync.mockReturnValueOnce({ status: 0, stdout: "headroom 1", stderr: "" });
    await new HeadroomRuntime().start(context(projectConfig({ mcp: { enabled: false } }), { notify }), { registerProvider });
    expect(registerProvider).not.toHaveBeenCalled();
    expect(childProcess.spawn).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith("headroom: headroom: missing OPENROUTER_API_KEY", "error");
  });

  it("notifies config warnings and validates external proxies without owning them", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    childProcess.spawnSync.mockReturnValue({ status: 0, stdout: "headroom 1", stderr: "" });
    const notify = vi.fn();
    const registerProvider = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => headroomResponse()));

    await new HeadroomRuntime().start(
      context(projectConfig({ ignored: true, proxy: { mode: "external", url: "http://127.0.0.1:9898" }, mcp: { enabled: false } }), { notify }),
      { registerProvider },
    );

    expect(notify).toHaveBeenCalledWith(expect.stringContaining("ignored"), "warning");
    expect(childProcess.spawn).not.toHaveBeenCalled();
    expect(registerProvider).toHaveBeenCalledWith("openai-compatible", expect.objectContaining({ baseUrl: "http://127.0.0.1:9898" }));
  });

  it("starts the MCP bridge after routing and reports a healthy bridge", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    childProcess.spawnSync.mockReturnValue({ status: 0, stdout: "headroom 1", stderr: "" });
    const mcp = createMcpStdioHarness({ initialize: "respond" });
    const child = mcp.child;
    childProcess.spawn.mockReturnValue(child);
    vi.stubGlobal("fetch", vi.fn(async () => headroomResponse()));
    const setStatus = vi.fn();
    const notify = vi.fn();
    const runtime = new HeadroomRuntime();
    const registerProvider = vi.fn();
    const unregisterProvider = vi.fn();

    await runtime.start(
      context(projectConfig({ proxy: { mode: "external", url: "http://127.0.0.1:9898" } }), { setStatus, notify }),
      { registerProvider, unregisterProvider },
    );

    expect(childProcess.spawn).toHaveBeenCalledWith(
      "headroom",
      ["mcp", "serve", "--proxy-url", "http://127.0.0.1:9898"],
      expect.objectContaining({ stdio: "pipe" }),
    );
    expect(runtime.getState().mcp).not.toBeNull();
    expect(setStatus).toHaveBeenLastCalledWith("headroom", "headroom: proxy ok, mcp ok");
    child.emit("exit", 1, null);
    expect(runtime.getState()).toMatchObject({ mcp: null, registeredProvider: "openai-compatible", lastError: "MCP bridge exited" });
    expect(unregisterProvider).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith("headroom: MCP bridge exited", "error");
  });

  it("cleans up only the failed MCP bridge when lifecycle startup fails", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    childProcess.spawnSync.mockReturnValue({ status: 0, stdout: "headroom 1", stderr: "" });
    const mcp = createMcpStdioHarness({ initialize: "exit" });
    const child = mcp.child;
    childProcess.spawn.mockReturnValue(child);
    vi.stubGlobal("fetch", vi.fn(async () => headroomResponse()));
    const registerProvider = vi.fn();
    const unregisterProvider = vi.fn();
    const setStatus = vi.fn();
    const runtime = new HeadroomRuntime();

    await runtime.start(
      context(projectConfig({ proxy: { mode: "external", url: "http://127.0.0.1:9898" } }), { setStatus }),
      { registerProvider, unregisterProvider },
    );

    expect(registerProvider).toHaveBeenCalledWith("openai-compatible", expect.any(Object));
    expect(unregisterProvider).not.toHaveBeenCalled();
    expect(child.kill).not.toHaveBeenCalled();
    expect(runtime.getState()).toMatchObject({ mcp: null, registeredProvider: "openai-compatible" });
    expect(setStatus).toHaveBeenLastCalledWith("headroom", "headroom: error: MCP startup failed: headroom MCP bridge exited");
  });

  it("fails unhealthy external proxies without spawning or registering", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    childProcess.spawnSync.mockReturnValue({ status: 0, stdout: "headroom 1", stderr: "" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 503 })));
    const registerProvider = vi.fn();

    await new HeadroomRuntime().start(
      context(projectConfig({ proxy: { mode: "external", url: "http://127.0.0.1:9898" }, mcp: { enabled: false } })),
      { registerProvider },
    );

    expect(childProcess.spawn).not.toHaveBeenCalled();
    expect(registerProvider).not.toHaveBeenCalled();
  });

  it("does not register or launch processes when proxy mode is disabled", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    childProcess.spawnSync.mockReturnValue({ status: 0, stdout: "headroom 1", stderr: "" });
    const setStatus = vi.fn();
    const registerProvider = vi.fn();

    await new HeadroomRuntime().start(context(projectConfig({ proxy: { mode: "disabled" }, mcp: { enabled: false } }), { setStatus }), { registerProvider });

    expect(childProcess.spawn).not.toHaveBeenCalled();
    expect(registerProvider).not.toHaveBeenCalled();
    expect(setStatus).toHaveBeenLastCalledWith("headroom", "headroom: proxy disabled");
  });

  it("refreshes a same-provider route with session and upstream headers, and tolerates missing Pi routing APIs", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    const runtime = new HeadroomRuntime();
    const state = (runtime as any).state;
    state.config = {
      enabled: true,
      proxy: { mode: "managed" },
      routing: { autoDetect: true, defaultUpstream: "", upstreamOverrides: {}, sessionHeader: true, upstreamHeader: "x-upstream" },
    };
    state.proxyUrl = "http://127.0.0.1:8787";
    state.metadata = { providerName: "OpenRouter", providerFamily: "openai-compatible", sessionId: "session-1" };
    state.registeredProvider = "openai-compatible";
    const registerProvider = vi.fn();
    const unregisterProvider = vi.fn();

    await runtime.refreshRoute({}, { registerProvider, unregisterProvider }, { modelId: "model-2" });

    expect(unregisterProvider).not.toHaveBeenCalled();
    expect(registerProvider).toHaveBeenCalledWith("openai-compatible", {
      baseUrl: "http://127.0.0.1:8787",
      headers: { "x-headroom-session-id": "session-1", "x-upstream": "https://openrouter.ai/api/v1" },
    });
    await expect(runtime.refreshRoute({}, {}, { modelId: "model-3" })).resolves.toBeUndefined();
  });

  it("clears provider state and stops owned handles", async () => {
    const runtime = new HeadroomRuntime();
    const state = (runtime as any).state;
    const mcp = { stop: vi.fn() };
    const child = createFakeChild();
    state.config = { proxy: { shutdownTimeoutMs: 1 } };
    state.mcp = mcp;
    state.proxyProcess = child;
    state.registeredProvider = "openai-compatible";
    const unregisterProvider = vi.fn();

    await runtime.stop({ unregisterProvider });
    expect(unregisterProvider).toHaveBeenCalledWith("openai-compatible");
    expect(mcp.stop).toHaveBeenCalledOnce();
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(runtime.getState()).toMatchObject({ mcp: null, proxyProcess: null, registeredProvider: null });
  });
});
