import { describe, expect, vi } from "vitest";

import { runCodexContextHook } from "../src/codex/context-hook.js";
import { test } from "./fixtures/filesystem.js";

function createIo()
{
    return {
        stderr: vi.fn<(value: string) => void>(),
        stdout: vi.fn<(value: string) => void>(),
    };
}

describe("runCodexContextHook", () =>
{
    test("emitsAtStartupAndAfterCompactionAndDirectoryChange", async ({ filesystem }) =>
    {
        const pluginData = await filesystem.createDirectory("plugin-data");
        const firstDirectory = await filesystem.createDirectory("one");
        const secondDirectory = await filesystem.createDirectory("two");
        const inspect = vi.fn(async (cwd: string) => `context:${cwd}`);
        const startupIo = createIo();
        const unchangedIo = createIo();
        const changedIo = createIo();
        const compactIo = createIo();

        await runCodexContextHook(
            { hookEventName: "SessionStart", sessionId: "session-a", cwd: firstDirectory, source: "startup" },
            { pluginData, inspect, io: startupIo },
        );
        await runCodexContextHook(
            { hookEventName: "UserPromptSubmit", sessionId: "session-a", cwd: firstDirectory },
            { pluginData, inspect, io: unchangedIo },
        );
        await runCodexContextHook(
            { hookEventName: "UserPromptSubmit", sessionId: "session-a", cwd: secondDirectory },
            { pluginData, inspect, io: changedIo },
        );
        await runCodexContextHook(
            { hookEventName: "SessionStart", sessionId: "session-a", cwd: secondDirectory, source: "compact" },
            { pluginData, inspect, io: compactIo },
        );

        expect(startupIo.stdout).toHaveBeenCalledWith(`context:${firstDirectory}`);
        expect(unchangedIo.stdout).not.toHaveBeenCalled();
        expect(changedIo.stdout).toHaveBeenCalledWith(`context:${secondDirectory}`);
        expect(compactIo.stdout).toHaveBeenCalledWith(`context:${secondDirectory}`);
    });

    test("keepsWorkingDirectoryStateSeparateWhenSessionsRunConcurrently", async ({ filesystem }) =>
    {
        const pluginData = await filesystem.createDirectory("plugin-data");
        const firstDirectory = await filesystem.createDirectory("one");
        const secondDirectory = await filesystem.createDirectory("two");
        const inspect = vi.fn(async (cwd: string) => `context:${cwd}`);
        await Promise.all([
            runCodexContextHook(
                { hookEventName: "SessionStart", sessionId: "session-a", cwd: firstDirectory, source: "startup" },
                { pluginData, inspect, io: createIo() },
            ),
            runCodexContextHook(
                { hookEventName: "SessionStart", sessionId: "session-b", cwd: secondDirectory, source: "startup" },
                { pluginData, inspect, io: createIo() },
            ),
        ]);
        const firstIo = createIo();
        const secondIo = createIo();

        await runCodexContextHook(
            { hookEventName: "UserPromptSubmit", sessionId: "session-a", cwd: firstDirectory },
            { pluginData, inspect, io: firstIo },
        );
        await runCodexContextHook(
            { hookEventName: "UserPromptSubmit", sessionId: "session-b", cwd: secondDirectory },
            { pluginData, inspect, io: secondIo },
        );

        expect(firstIo.stdout).not.toHaveBeenCalled();
        expect(secondIo.stdout).not.toHaveBeenCalled();
    });

    test("returnsSuccessWithOnlyStandardErrorWhenInspectionFails", async ({ filesystem }) =>
    {
        const pluginData = await filesystem.createDirectory("plugin-data");
        const cwd = await filesystem.createDirectory("one");
        const io = createIo();
        const inspect = vi.fn(async () => Promise.reject(new Error("registry unreadable")));

        const status = await runCodexContextHook(
            { hookEventName: "SessionStart", sessionId: "session-a", cwd, source: "startup" },
            { pluginData, inspect, io },
        );

        expect(status).toBe(0);
        expect(io.stderr).toHaveBeenCalledOnce();
        expect(io.stdout).not.toHaveBeenCalled();
    });
});
