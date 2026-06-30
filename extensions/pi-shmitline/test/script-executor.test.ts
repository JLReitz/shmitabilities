import { describe, it, expect, vi, beforeEach } from "vitest";
import { extractStatusData, spawnStatusScript, type StatusScriptInput } from "../index.ts";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    existsSync: vi.fn((path: string) => path === "/valid/script.mjs"),
  };
});

import { spawn } from "node:child_process";

const statusInput: StatusScriptInput = {
  version: 1,
  terminal: { width: 80 },
  context: { tokens: 100000, contextWindow: 200000, percent: 50 },
  usage: {
    input: 2000000,
    output: 176000,
    cacheRead: 1500000,
    cacheWrite: 100000,
    totalTokens: 3776000,
    cacheHitPercent: 42,
    cost: 1.25,
  },
  model: {
    id: "gpt-5.4-mini",
    name: "GPT 5.4 Mini",
    provider: "openai",
    reasoning: true,
    contextWindow: 200000,
    maxTokens: 32000,
  },
  thinkingLevel: "high",
  session: { id: "abc123", name: null, cwd: "/cwd" },
  git: { branch: "main", status: "M" },
  extensionStatuses: [{ key: "subagents", text: "2 agents" }],
  time: "12:00 PM",
};

function mockChild(stdoutText = "", exitCode: number | null = 0) {
  return {
    stdin: { on: vi.fn(), end: vi.fn() },
    stdout: {
      on: vi.fn((event: string, callback: (data: Buffer) => void) => {
        if (event === "data" && stdoutText) setTimeout(() => callback(Buffer.from(stdoutText)), 0);
      }),
    },
    stderr: { on: vi.fn() },
    on: vi.fn((event: string, callback: (value: any) => void) => {
      if (event === "close") setTimeout(() => callback(exitCode), 0);
    }),
  };
}

describe("script executor", () => {
  const mockSpawn = vi.mocked(spawn);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should derive structured status data from Pi interfaces", () => {
    const usage = {
      input: 500000,
      output: 176000,
      cacheRead: 1500000,
      cacheWrite: 0,
      cost: { total: 1.25 },
    };
    const ctx = {
      cwd: "/work/tree",
      terminal: { columns: 120 },
      model: {
        id: "test-model",
        name: "Test Model",
        provider: "test-provider",
        reasoning: true,
        contextWindow: 200000,
        maxTokens: 32000,
      },
      getContextUsage: () => ({ tokens: 100000, contextWindow: 200000, percent: 50 }),
      sessionManager: {
        getSessionId: () => "test-session",
        getSessionName: () => "Status test",
        getEntries: () => [
          { type: "message", message: { role: "assistant", stopReason: "stop", usage } },
          { type: "message", message: { role: "assistant", stopReason: "aborted", usage } },
        ],
      },
    };
    const footerData = {
      getGitBranch: () => "feature/json-stdin",
      getExtensionStatuses: () => new Map([
        ["z-last", "last"],
        ["a-first", "first"],
      ]),
    };

    const data = extractStatusData(
      ctx,
      [{ type: "turn_end", message: { usage } }],
      undefined,
      false,
      footerData,
      "high",
    );

    expect(data).toMatchObject({
      version: 1,
      terminal: { width: 120 },
      context: { tokens: 100000, contextWindow: 200000, percent: 50 },
      usage: {
        input: 500000,
        output: 176000,
        cacheRead: 1500000,
        cacheWrite: 0,
        totalTokens: 2176000,
        cacheHitPercent: 75,
        cost: 1.25,
      },
      model: { id: "test-model", name: "Test Model", provider: "test-provider", reasoning: true },
      thinkingLevel: "high",
      session: { id: "test-session", name: "Status test", cwd: "/work/tree" },
      git: { branch: "feature/json-stdin" },
      extensionStatuses: [
        { key: "a-first", text: "first" },
        { key: "z-last", text: "last" },
      ],
    });
  });

  it("should return an error when the script is missing", async () => {
    const result = await spawnStatusScript("/nonexistent/script.mjs", statusInput, "/cwd");

    expect(result.output).toBe("");
    expect(result.error?.summary).toContain("not found");
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("should write one JSON object to stdin without defining status environment variables", async () => {
    const child = mockChild("statusline content");
    mockSpawn.mockReturnValue(child as any);

    const result = await spawnStatusScript("/valid/script.mjs", statusInput, "/cwd");

    expect(result).toEqual({ output: "statusline content", error: null });
    expect(mockSpawn).toHaveBeenCalledWith(
      "/valid/script.mjs",
      [],
      expect.objectContaining({
        cwd: "/cwd",
        stdio: ["pipe", "pipe", "pipe"],
      }),
    );
    expect(mockSpawn.mock.calls[0][2]).not.toHaveProperty("env");
    expect(child.stdin.end).toHaveBeenCalledWith(`${JSON.stringify(statusInput)}\n`);
  });

  it("should return an error on a non-zero exit", async () => {
    mockSpawn.mockReturnValue(mockChild("failure details", 1) as any);

    const result = await spawnStatusScript("/valid/script.mjs", statusInput, "/cwd");

    expect(result.output).toBe("");
    expect(result.error?.summary).toContain("exited with code 1");
    expect(result.error?.details).toEqual(["failure details"]);
  });
});
