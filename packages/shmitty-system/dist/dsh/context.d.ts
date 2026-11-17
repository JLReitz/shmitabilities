import type { Context } from "@deepseek-ai/cordis";
/** Dependencies used by the DSH context adapter. */
export interface DshContextDependencies {
    inspect(cwd: string): Promise<string>;
    stderr(value: string): void;
}
/**
 * Register DSH session events and dynamic system-prompt context.
 *
 * @param ctx - DSH services that receive lifecycle handlers and the context provider.
 * @param dependencies - Context inspection and diagnostic operations.
 */
export declare function registerDshContextHooks(ctx: Context, dependencies: DshContextDependencies): void;
