import path from "node:path";

interface PiContext
{
    cwd: string;
}

/** Pi event registration used by the context adapter. */
export interface PiContextApi
{
    on(event: string, handler: (event: unknown, context: PiContext) => Promise<void>): void;
}

/** Dependencies used by the Pi context adapter. */
export interface PiContextDependencies
{
    emit(context: string): Promise<void> | void;
    inspect(cwd: string): Promise<string>;
    stderr(value: string): void;
}

function errorText(error: unknown): string
{
    return error instanceof Error ? error.message : String(error);
}

/**
 * Register Pi context lifecycle handlers.
 *
 * @param pi - Pi event interface that receives the lifecycle handlers.
 * @param dependencies - Context inspection and output operations.
 */
export function registerPiContextHooks(pi: PiContextApi, dependencies: PiContextDependencies): void
{
    let lastCwd: string | undefined;

    const inspectAndEmit = async (context: PiContext, forceEmission: boolean): Promise<void> =>
    {
        try
        {
            const cwd = path.resolve(context.cwd);
            if ((!forceEmission) && (cwd === lastCwd))
            {
                return;
            }

            const shmittyContext = await dependencies.inspect(cwd);
            lastCwd = cwd;
            if (shmittyContext !== "")
            {
                await dependencies.emit(shmittyContext);
            }
        }
        catch (error)
        {
            dependencies.stderr(errorText(error));
        }
    };

    pi.on("session_start", async (_event, context) => inspectAndEmit(context, true));
    pi.on("session_compact", async (_event, context) => inspectAndEmit(context, true));
    pi.on("before_agent_start", async (_event, context) => inspectAndEmit(context, false));
}
