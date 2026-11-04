import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

const childProcess = vi.hoisted(() => ({
  spawn: vi.fn(),
  spawnSync: vi.fn(),
}));

vi.mock("node:child_process", () => childProcess);

import {
  checkHeadroomHealth,
  metadataFromContext,
  resolveHeadroomBinary,
  stopProcess,
  waitForHealth,
} from "../src/runtime.ts";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("pi-headroom runtime helper failures", () => {
  it("reports missing, failed, and successful Headroom version checks", () => {
    childProcess.spawnSync.mockReturnValueOnce({ error: new Error("ENOENT") });
    expect(resolveHeadroomBinary("missing-headroom")).toEqual({ ok: false, message: "headroom: command not found: missing-headroom" });

    childProcess.spawnSync.mockReturnValueOnce({ status: 2, stderr: "bad option", stdout: "" });
    expect(resolveHeadroomBinary("headroom")).toEqual({ ok: false, message: "headroom: version check failed: bad option" });

    childProcess.spawnSync.mockReturnValueOnce({ status: 0, stdout: "headroom 1.2.3\n", stderr: "" });
    expect(resolveHeadroomBinary("headroom")).toEqual({ ok: true, version: "headroom 1.2.3" });
  });

  it("reports failed health probes and accepts a Headroom response header", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 503 })));
    await expect(checkHeadroomHealth("http://127.0.0.1:8787", "/health")).resolves.toEqual({
      ok: false,
      status: 503,
      message: "headroom: health HTTP 503",
    });

    vi.stubGlobal("fetch", vi.fn(async () => new Response("ok", { status: 200, headers: { server: "Headroom" } })));
    await expect(checkHeadroomHealth("http://127.0.0.1:8787", "/health")).resolves.toMatchObject({ ok: true, status: 200 });

    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("connection refused"); }));
    await expect(checkHeadroomHealth("http://127.0.0.1:8787", "/health")).resolves.toEqual({
      ok: false,
      message: "headroom: health check failed: connection refused",
    });
  });

  it("aborts a health probe when its timeout elapses", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: URL, options: RequestInit) => new Promise((_resolve, reject) => {
        options.signal?.addEventListener("abort", () => reject(new Error("health timeout")));
      })),
    );

    const checking = checkHeadroomHealth("http://127.0.0.1:8787", "/health", 1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(checking).resolves.toEqual({ ok: false, message: "headroom: health check failed: health timeout" });
  });

  it("retries health probes until a Headroom response succeeds", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      calls += 1;
      return calls === 1 ? new Response("down", { status: 503 }) : new Response("headroom", { status: 200 });
    }));

    await expect(waitForHealth("http://127.0.0.1:8787", "/health", 500)).resolves.toMatchObject({ ok: true });
    expect(calls).toBe(2);
  });

  it("returns the final failed health result when polling expires", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 503 })));

    await expect(waitForHealth("http://127.0.0.1:8787", "/health", 1)).resolves.toEqual({
      ok: false,
      status: 503,
      message: "headroom: health HTTP 503",
    });
  });

  it("reads optional model and session-manager metadata shapes", () => {
    expect(metadataFromContext({
      model: { provider: "anthropic", compat: { api: "anthropic-messages" }, id: "claude" },
      getThinkingLevel: () => "high",
      sessionManager: { getSessionId: () => "session-1", getSessionName: () => "named" },
      cwd: "/workspace",
    })).toMatchObject({
      providerName: "anthropic",
      providerFamily: "anthropic-messages",
      thinkingLevel: "high",
      sessionId: "session-1",
      sessionName: "named",
      cwd: "/workspace",
    });
  });

  it("does nothing for an absent or exited child and finishes after SIGTERM", async () => {
    await expect(stopProcess(null, 1)).resolves.toBeUndefined();
    const exited = new EventEmitter() as any;
    exited.exitCode = 0;
    exited.signalCode = null;
    exited.kill = vi.fn();
    await stopProcess(exited, 1);
    expect(exited.kill).not.toHaveBeenCalled();

    const child = new EventEmitter() as any;
    child.exitCode = null;
    child.signalCode = null;
    child.kill = vi.fn(() => {
      child.exitCode = 0;
      child.emit("exit", 0, null);
      return true;
    });
    await stopProcess(child, 1);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("bounds shutdown when a child ignores SIGTERM and SIGKILL", async () => {
    vi.useFakeTimers();
    const child = new EventEmitter() as any;
    child.exitCode = null;
    child.signalCode = null;
    child.kill = vi.fn(() => true);

    const stopping = stopProcess(child, 1);
    await vi.advanceTimersByTimeAsync(1);
    expect(child.kill).toHaveBeenNthCalledWith(1, "SIGTERM");
    expect(child.kill).toHaveBeenNthCalledWith(2, "SIGKILL");
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(stopping).resolves.toBeUndefined();
  });
});
