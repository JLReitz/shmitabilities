import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-agent";
import type { Session } from "@deepseek-ai/dsh-session";
import type {} from "@deepseek-ai/dsh-system-prompt";
import type {} from "@deepseek-ai/dsh-working-directory";

/** Dependencies used by the DSH context adapter. */
export interface DshContextDependencies
{
    inspect(cwd: string): Promise<string>;
    stderr(value: string): void;
}

function errorText(error: unknown): string
{
    return error instanceof Error ? error.message : String(error);
}

/**
 * Register DSH session events and dynamic system-prompt context.
 *
 * @param ctx - DSH services that receive lifecycle handlers and the context provider.
 * @param dependencies - Context inspection and diagnostic operations.
 */
export function registerDshContextHooks(ctx: Context, dependencies: DshContextDependencies): void
{
    const sessionContexts = new WeakMap<Session, string>();

    const refresh = async (session: Session): Promise<void> =>
    {
        try
        {
            const cwd = ctx.workingDirectory.get(session);
            sessionContexts.set(session, await dependencies.inspect(cwd));
        }
        catch (error)
        {
            sessionContexts.set(session, "");
            dependencies.stderr(errorText(error));
        }
    };

    ctx.systemPrompt.context({
        name: "shmitty-filesystem",
        order: ctx.systemPrompt.getContextOrder("WORKING_DIRECTORY") + 1,
        required: true,
        interpolate: false,
        text: context => context.agent === undefined ? "" : sessionContexts.get(context.agent.session) ?? "",
    });

    ctx.on("session/created", async (session) => refresh(session));
    ctx.on("session/event", async (session, event) =>
    {
        const type = String(event.type);
        if ((type === "compaction/end") || (type === "working-directory/change"))
        {
            await refresh(session);
        }
    });
    ctx.on("system-prompt/assemble", async (assembly, context, next) =>
    {
        if (context.agent !== undefined)
        {
            await refresh(context.agent.session);
        }
        return next();
    }, { prepend: true });
}
