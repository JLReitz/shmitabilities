import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/cordis-plugin-loader";
import type {} from "@deepseek-ai/dsh-agent";
import type {} from "@deepseek-ai/dsh-llm";
import type {} from "@deepseek-ai/dsh-session";
import { ensureRouter, loadLlamaConfig, targetsRouter, validateProviderUrl } from "../index.js";

interface SelectedModel
{
    provider: string;
    model: string;
}

function record(value: unknown): value is Record<string, unknown>
{
    return typeof value === "object" && value !== null;
}

/** Read a native config field, including a Cordis volatile reference. */
function configValue(value: unknown): unknown
{
    if (record(value) && typeof value.get === "function")
    {
        return value.get();
    }
    return value;
}

/** Resolve the endpoint from the adapter's directory and live native config. */
function providerUrl(ctx: Context, provider: string): string | undefined
{
    const registration = ctx.llm.listConfigurableProviders().find(
        entry => entry.provider === provider,
    );
    if (!registration)
    {
        return undefined;
    }

    const entry = [...ctx.loader.entries()].find(
        candidate => candidate.options.id === registration.settingsNs,
    );
    let profile: unknown = entry?.fiber?.config;
    for (const key of registration.settingsPath)
    {
        profile = configValue(profile);
        profile = record(profile) ? profile[key] : undefined;
    }

    profile = configValue(profile);
    const configured = record(profile) ? configValue(profile.baseURL) : undefined;
    const baseUrl = configured ?? registration.defaultBaseURL;
    return typeof baseUrl === "string" ? baseUrl : undefined;
}

/**
 * Register startup, ordinary selection, and request-time ACP connection.
 *
 * @param ctx - DSH context that receives the lifecycle hooks.
 */
export function registerDsh(ctx: Context): void
{
    async function connect(selected: { provider?: string; model?: string }): Promise<void>
    {
        if (!selected.provider)
        {
            return;
        }

        const config = await loadLlamaConfig();
        const baseUrl = providerUrl(ctx, selected.provider);
        if (baseUrl === undefined || !targetsRouter(baseUrl, config))
        {
            return;
        }

        if (typeof selected.model !== "string" || selected.model.length === 0)
        {
            throw new Error(`DSH router connection requires a nonempty model ID for provider ${selected.provider}.`);
        }

        validateProviderUrl(baseUrl, config);
        await ensureRouter(selected.model, config);
    }

    ctx.on("agent/created", async ({ agent }) =>
    {
        await connect(agent.options);
    });

    // model/selection is a durable Session event, observed after its commit.
    // Session observers cannot veto selection; the awaited stream hook below
    // repeats validation before any provider request and propagates failures.
    ctx.on("session/event", (_session, event) =>
    {
        if (String(event.type) !== "model/selection")
        {
            return;
        }

        const selected: unknown = event.data;
        if (
            !record(selected) || typeof selected.provider !== "string"
            || typeof selected.model !== "string"
        )
        {
            return;
        }

        const model: SelectedModel = { provider: selected.provider, model: selected.model };
        void connect(model).catch((error: unknown) =>
        {
            ctx.logger.error(error);
        });
    });

    ctx.on("llm/stream", async function*(options, next)
    {
        await connect(options);
        yield* next();
    });
}
