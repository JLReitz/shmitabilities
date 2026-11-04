import type { Context } from "@deepseek-ai/cordis";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apply, inject, name } from "../src/dsh-llamas-and-shmit/index.js";
import { registerDsh } from "../src/dsh-llamas-and-shmit/register.js";
import { ensureRouter, loadLlamaConfig, validateProviderUrl } from "../src/index.js";

vi.mock("../src/index.js", () => ({
    ensureRouter: vi.fn(),
    loadLlamaConfig: vi.fn(),
    targetsRouter: (url: string, config: { port: number }) => url.includes(`127.0.0.1:${config.port}/`),
    validateProviderUrl: vi.fn(),
}));

type Listener = (...args: any[]) => any;

function harness(baseURL: unknown = "http://127.0.0.1:8080/v1", provider = "llama-cpp")
{
    const listeners = new Map<string, Listener>();
    const profile = { baseURL };
    const ctx = {
        on: (event: string, listener: Listener) => listeners.set(event, listener),
        llm: {
            listConfigurableProviders: () => [{
                provider,
                settingsNs: "native-llm",
                settingsPath: ["providers", provider],
            }],
        },
        loader: {
            entries: () => [{
                options: { id: "native-llm" },
                fiber: {
                    config: {
                        providers: { get: () => ({ [provider]: profile }) },
                    },
                },
            }],
        },
        logger: { error: vi.fn() },
    } as unknown as Context;

    return { ctx, profile, listeners };
}

beforeEach(() =>
{
    vi.resetAllMocks();
    vi.mocked(loadLlamaConfig).mockResolvedValue({
        agentRoot: "/agent",
        command: "llama-server",
        modelIni: "/agent/models.ini",
        port: 8080,
    });
    vi.mocked(ensureRouter).mockResolvedValue();
});

describe("DSH router interface", () =>
{
    it("registersNamedPluginWithRequiredServices", () =>
    {
        const { ctx, listeners } = harness();

        apply(ctx);

        expect(name).toBe("llamas-and-shmit");
        expect(inject).toEqual(["agents", "llm", "loader"]);
        expect([...listeners.keys()]).toEqual(["agent/created", "session/event", "llm/stream"]);
    });

    it.each(["startup", "resume"])("connectsAtAgentCreationWith%s", async source =>
    {
        const { ctx, listeners } = harness();
        registerDsh(ctx);
        const created = listeners.get("agent/created");
        expect(created).toBeDefined();

        await created!({ source, agent: { options: { provider: "llama-cpp", model: "local" } } });

        expect(loadLlamaConfig).toHaveBeenCalledWith();
        expect(validateProviderUrl).toHaveBeenCalledWith("http://127.0.0.1:8080/v1", expect.any(Object));
        expect(ensureRouter).toHaveBeenCalledWith("local", expect.any(Object));
    });

    it("connectsOnOrdinaryDurableModelSelection", async () =>
    {
        const { ctx, listeners } = harness();
        registerDsh(ctx);
        const observed = listeners.get("session/event");
        expect(observed).toBeDefined();

        observed!({}, { type: "model/selection", data: { provider: "llama-cpp", model: "selected" } });

        await vi.waitFor(() => expect(ensureRouter).toHaveBeenCalledWith("selected", expect.any(Object)));
    });

    it("connectsCustomProviderFromNativeProfileConfiguration", async () =>
    {
        const { ctx, listeners } = harness("http://127.0.0.1:8080/v1", "local-custom");
        registerDsh(ctx);
        const created = listeners.get("agent/created");
        expect(created).toBeDefined();

        await created!({ agent: { options: { provider: "local-custom", model: "local" } } });

        expect(ensureRouter).toHaveBeenCalledWith("local", expect.any(Object));
    });

    it("connectsBeforeNextAcpRequestAndPreservesStream", async () =>
    {
        const { ctx, listeners, profile } = harness();
        registerDsh(ctx);
        const stream = listeners.get("llm/stream");
        expect(stream).toBeDefined();
        profile.baseURL = "http://127.0.0.1:8080/custom";
        const next = vi.fn(async function*()
        {
            yield { type: "text-delta", text: "hello" };
        });

        const result = [];
        for await (const chunk of stream!({ provider: "llama-cpp", model: "acp-selected" }, next))
        {
            result.push(chunk);
        }

        expect(validateProviderUrl).toHaveBeenCalledWith(profile.baseURL, expect.any(Object));
        expect(ensureRouter).toHaveBeenCalledWith("acp-selected", expect.any(Object));
        expect(vi.mocked(ensureRouter).mock.invocationCallOrder[0]).toBeLessThan(next.mock.invocationCallOrder[0]);
        expect(result).toEqual([{ type: "text-delta", text: "hello" }]);
    });

    it.each(["other", undefined])("ignoresUnselectedProviderWith%s", async provider =>
    {
        const { ctx, listeners } = harness();
        registerDsh(ctx);
        const created = listeners.get("agent/created");
        expect(created).toBeDefined();

        await created!({ agent: { options: { provider, model: "cloud" } } });

        expect(validateProviderUrl).not.toHaveBeenCalled();
        expect(ensureRouter).not.toHaveBeenCalled();
    });

    it.each(["url", "router"])("preventsRequestAfter%sFailure", async failure =>
    {
        const { ctx, listeners } = harness();
        registerDsh(ctx);
        const stream = listeners.get("llm/stream");
        expect(stream).toBeDefined();
        const error = new Error("connection failed");
        if (failure === "url")
        {
            vi.mocked(validateProviderUrl).mockImplementation(() =>
            {
                throw error;
            });
        }
        else
        {
            vi.mocked(ensureRouter).mockRejectedValue(error);
        }
        const next = vi.fn(async function*()
        {
            yield "unexpected";
        });

        await expect(stream!({ provider: "llama-cpp", model: "local" }, next).next()).rejects.toThrow(error);

        expect(next).not.toHaveBeenCalled();
        if (failure === "url")
        {
            expect(ensureRouter).not.toHaveBeenCalled();
        }
    });

    it("skipsStartupWithoutNativeEndpoint", async () =>
    {
        const { ctx, listeners } = harness(null);
        registerDsh(ctx);
        const created = listeners.get("agent/created");
        expect(created).toBeDefined();

        await created!({ agent: { options: { provider: "llama-cpp", model: "local" } } });

        expect(ensureRouter).not.toHaveBeenCalled();
    });
});
