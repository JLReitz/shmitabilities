import type { Context } from "@deepseek-ai/cordis";
import { describe, expect, vi } from "vitest";

import { registerDshContextHooks } from "../src/dsh/context.js";
import { test } from "./fixtures/filesystem.js";

interface Session
{
    id: string;
}

interface PromptContext
{
    agent?: { session: Session };
}

interface PromptContextProvider
{
    text(context: PromptContext): string;
}

function createDshContext(): {
    contextProvider: { current?: PromptContextProvider };
    ctx: Context;
    handlers: Map<string, (...payload: unknown[]) => Promise<unknown>>;
    setWorkingDirectory(session: Session, cwd: string): void;
}
{
    const handlers = new Map<string, (...payload: unknown[]) => Promise<unknown>>();
    const contextProvider: { current?: PromptContextProvider } = {};
    const workingDirectories = new WeakMap<Session, string>();
    const ctx = {
        on(event: string, handler: (...payload: unknown[]) => Promise<unknown>): void
        {
            handlers.set(event, handler);
        },
        systemPrompt: {
            context(provider: PromptContextProvider): void
            {
                contextProvider.current = provider;
            },
            getContextOrder(): number
            {
                return 100;
            },
        },
        workingDirectory: {
            get(session: Session): string
            {
                const cwd = workingDirectories.get(session);
                if (cwd === undefined)
                {
                    throw new Error("test session has no working directory");
                }
                return cwd;
            },
        },
    } as unknown as Context;

    return {
        contextProvider,
        ctx,
        handlers,
        setWorkingDirectory(session, cwd): void
        {
            workingDirectories.set(session, cwd);
        },
    };
}

describe("registerDshContextHooks", () =>
{
    test("refreshesContextForSessionCompactionAndDirectoryChangeEvents", async ({ filesystem }) =>
    {
        const firstDirectory = await filesystem.createDirectory("one");
        const secondDirectory = await filesystem.createDirectory("two");
        const session = { id: "session-a" };
        const { contextProvider, ctx, handlers, setWorkingDirectory } = createDshContext();
        const inspect = vi.fn(async (cwd: string) => `context:${cwd}`);
        setWorkingDirectory(session, firstDirectory);
        registerDshContextHooks(ctx, { inspect, stderr: vi.fn() });

        await handlers.get("session/created")?.(session);
        await handlers.get("session/event")?.(session, { type: "compaction/end" });
        setWorkingDirectory(session, secondDirectory);
        await handlers.get("session/event")?.(session, { type: "working-directory/change" });
        const output = contextProvider.current?.text({ agent: { session } });

        expect(output).toBe(`context:${secondDirectory}`);
        expect(inspect).toHaveBeenCalled();
    });

    test("suppliesEmptyContextWhenInspectionFails", async ({ filesystem }) =>
    {
        const cwd = await filesystem.createDirectory("one");
        const session = { id: "session-a" };
        const { contextProvider, ctx, handlers, setWorkingDirectory } = createDshContext();
        const stderr = vi.fn();
        const inspect = vi.fn(async () => Promise.reject(new Error("registry unreadable")));
        setWorkingDirectory(session, cwd);
        registerDshContextHooks(ctx, { inspect, stderr });

        await handlers.get("session/created")?.(session);
        const output = contextProvider.current?.text({ agent: { session } });

        expect(output).toBe("");
        expect(stderr).toHaveBeenCalledOnce();
    });
});
