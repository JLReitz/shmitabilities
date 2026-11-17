import { describe, expect, vi } from "vitest";

import { registerPiContextHooks } from "../src/pi-shmitty-system/context.js";
import { test } from "./fixtures/filesystem.js";

interface PiContext
{
    cwd: string;
}

function createPi(): {
    handlers: Map<string, (event: unknown, context: PiContext) => Promise<void>>;
    pi: { on: (event: string, handler: (event: unknown, context: PiContext) => Promise<void>) => void };
}
{
    const handlers = new Map<string, (event: unknown, context: PiContext) => Promise<void>>();
    return {
        handlers,
        pi: {
            on(event, handler): void
            {
                handlers.set(event, handler);
            },
        },
    };
}

describe("registerPiContextHooks", () =>
{
    test("emitsAtStartupAndAfterCompactionAndDirectoryChange", async ({ filesystem }) =>
    {
        const firstDirectory = await filesystem.createDirectory("one");
        const secondDirectory = await filesystem.createDirectory("two");
        const { handlers, pi } = createPi();
        const emit = vi.fn();
        const inspect = vi.fn(async (cwd: string) => `context:${cwd}`);
        registerPiContextHooks(pi, { inspect, emit, stderr: vi.fn() });

        await handlers.get("session_start")?.({}, { cwd: firstDirectory });
        await handlers.get("before_agent_start")?.({}, { cwd: firstDirectory });
        await handlers.get("before_agent_start")?.({}, { cwd: secondDirectory });
        await handlers.get("session_compact")?.({}, { cwd: secondDirectory });

        expect(emit.mock.calls).toEqual([
            [`context:${firstDirectory}`],
            [`context:${secondDirectory}`],
            [`context:${secondDirectory}`],
        ]);
    });

    test("emitsNoContextWhenInspectionFails", async ({ filesystem }) =>
    {
        const cwd = await filesystem.createDirectory("one");
        const { handlers, pi } = createPi();
        const emit = vi.fn();
        const stderr = vi.fn();
        const inspect = vi.fn(async () => Promise.reject(new Error("git failed")));
        registerPiContextHooks(pi, { inspect, emit, stderr });

        await handlers.get("session_start")?.({}, { cwd });

        expect(stderr).toHaveBeenCalledOnce();
        expect(emit).not.toHaveBeenCalled();
    });
});
