import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ensureRouter, loadLlamaConfig, validateProviderUrl } from "../src/index.js";
import activatePi from "../src/pi-llamas-and-shmit/index.js";

vi.mock("../src/index.js", () => ({
    loadLlamaConfig: vi.fn(),
    targetsRouter: (url: string, config: { port: number }) => url.includes(`127.0.0.1:${config.port}/`),
    validateProviderUrl: vi.fn(),
    ensureRouter: vi.fn(),
}));

const config = {
    agentRoot: "/agent",
    command: "llama-server",
    modelIni: "/agent/models.ini",
    port: 8080,
};

const localModel = {
    provider: "llama-cpp",
    id: "exact-model-id",
    name: "A display name",
    baseUrl: "http://127.0.0.1:8080/v1",
};

function createHost(model: unknown = localModel)
{
    const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => Promise<void>>();
    const find = vi.fn().mockReturnValue(localModel);
    const getAll = vi.fn().mockReturnValue([localModel]);
    const pi = {
        on(event: string, handler: (event: unknown, ctx: ExtensionContext) => Promise<void>)
        {
            handlers.set(event, handler);
        },
    } as unknown as ExtensionAPI;
    const ctx = { model, modelRegistry: { find, getAll } } as unknown as ExtensionContext;

    activatePi(pi);

    return {
        find,
        async emit(event: string, value: unknown = {})
        {
            const handler = handlers.get(event);
            expect(handler).toBeDefined();
            await handler!(value, ctx);
        },
    };
}

beforeEach(() =>
{
    vi.resetAllMocks();
    vi.mocked(loadLlamaConfig).mockResolvedValue(config);
    vi.mocked(ensureRouter).mockResolvedValue(undefined);
});

describe("connectsSelectedModel", () =>
{
    it.each(["session_start", "model_select", "model_change"])("%s", async (event) =>
    {
        const host = createHost();

        await host.emit(event, { model: localModel, modelId: localModel.id });

        expect(loadLlamaConfig).toHaveBeenCalledWith();
        expect(validateProviderUrl).toHaveBeenCalledWith(localModel.baseUrl, config);
        expect(ensureRouter).toHaveBeenCalledWith(localModel.id, config);
        expect(vi.mocked(validateProviderUrl).mock.invocationCallOrder[0]).toBeLessThan(
            vi.mocked(ensureRouter).mock.invocationCallOrder[0],
        );
    });
});

it("connectsEventModelWhenContextContainsPreviousModel", async () =>
{
    const host = createHost({ ...localModel, id: "previous", provider: "remote" });

    await host.emit("model_select", { model: localModel });

    expect(ensureRouter).toHaveBeenCalledWith(localModel.id, config);
});

describe("skipsUnrelatedProvider", () =>
{
    it.each(["session_start", "model_select", "model_change"])("%s", async (event) =>
    {
        const model = { ...localModel, provider: "remote", baseUrl: "https://example.com/v1" };
        const host = createHost(model);

        await host.emit(event, { model, modelId: model.id, provider: "remote" });

        expect(validateProviderUrl).not.toHaveBeenCalled();
        expect(ensureRouter).not.toHaveBeenCalled();
    });
});

it("skipsConnectionWhenStartupHasNoModel", async () =>
{
    const host = createHost(null);

    await host.emit("session_start");

    expect(loadLlamaConfig).not.toHaveBeenCalled();
    expect(ensureRouter).not.toHaveBeenCalled();
});

it("connectsCustomProviderFromNativeModelConfiguration", async () =>
{
    const host = createHost({ ...localModel, provider: "local-custom" });

    await host.emit("session_start");

    expect(ensureRouter).toHaveBeenCalledWith(localModel.id, config);
});

it("resolvesLegacyModelFromRegistryWhenContextContainsPreviousSelection", async () =>
{
    const host = createHost({ ...localModel, id: "previous" });

    await host.emit("model_change", { modelId: localModel.id });

    expect(host.find).not.toHaveBeenCalled();
    expect(ensureRouter).toHaveBeenCalledWith(localModel.id, config);
});

it("skipsLegacyModelMissingFromRegistry", async () =>
{
    const host = createHost(null);
    host.find.mockReturnValue(undefined);

    await host.emit("model_change", { modelId: "missing" });

    expect(ensureRouter).not.toHaveBeenCalled();
});

it("rejectsEmptyModelIdBeforeRouterConnection", async () =>
{
    const host = createHost({ ...localModel, id: "" });

    await expect(host.emit("session_start")).rejects.toThrow("nonempty model ID");

    expect(ensureRouter).not.toHaveBeenCalled();
});

it("rejectsProviderUrlBeforeRouterConnection", async () =>
{
    vi.mocked(validateProviderUrl).mockImplementation(() =>
    {
        throw new Error("URL mismatch");
    });
    const host = createHost();

    await expect(host.emit("session_start")).rejects.toThrow("URL mismatch");

    expect(ensureRouter).not.toHaveBeenCalled();
});

it("reportsRouterFailureToPi", async () =>
{
    vi.mocked(ensureRouter).mockRejectedValue(new Error("model unavailable"));
    const host = createHost();

    await expect(host.emit("session_start")).rejects.toThrow("model unavailable");
});
