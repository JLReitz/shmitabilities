import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ensureRouter, loadLlamaConfig, targetsRouter, validateProviderUrl } from "../index.js";

interface SelectedModel
{
    provider: string;
    id: string;
    baseUrl: string;
}

interface LegacyModelChangeEvent
{
    modelId?: string;
    provider?: string;
}

/**
 * Connect a qualifying native Pi model to the shared router.
 *
 * @param pi - Pi extension API that receives the lifecycle hooks.
 */
export function registerPi(pi: ExtensionAPI): void
{
    async function connect(model: SelectedModel | undefined): Promise<void>
    {
        if (!model)
        {
            return;
        }

        const config = await loadLlamaConfig();
        if (!targetsRouter(model.baseUrl, config))
        {
            return;
        }

        if (typeof model.id !== "string" || model.id.length === 0)
        {
            throw new Error(`Pi router connection requires a nonempty model ID for provider ${model.provider}.`);
        }

        validateProviderUrl(model.baseUrl, config);
        await ensureRouter(model.id, config);
    }

    pi.on("session_start", async (_event, ctx) =>
    {
        await connect(ctx.model);
    });

    pi.on("model_select", async (event) =>
    {
        await connect(event.model);
    });

    // Older Pi hosts report only the selected ID; resolve its native metadata.
    const onLegacyEvent = pi.on as unknown as (
        event: "model_change",
        handler: (event: LegacyModelChangeEvent, ctx: ExtensionContext) => Promise<void>,
    ) => void;
    onLegacyEvent.call(pi, "model_change", async (event, ctx) =>
    {
        if (!event.modelId)
        {
            return;
        }

        if (
            ctx.model?.id === event.modelId
            && (!event.provider || ctx.model.provider === event.provider)
        )
        {
            await connect(ctx.model);
            return;
        }

        if (event.provider)
        {
            const model = ctx.modelRegistry.find(event.provider, event.modelId);
            if (model)
            {
                await connect(model);
            }
            return;
        }

        const config = await loadLlamaConfig();
        const matches = ctx.modelRegistry.getAll().filter(model =>
            model.id === event.modelId && targetsRouter(model.baseUrl, config)
        );
        if (matches.length > 1)
        {
            throw new Error(`Pi router connection requires a provider for ambiguous model ${event.modelId}.`);
        }

        if (matches[0])
        {
            await connect(matches[0]);
        }
    });
}
