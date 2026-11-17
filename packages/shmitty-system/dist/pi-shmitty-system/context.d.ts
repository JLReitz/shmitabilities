interface PiContext {
    cwd: string;
}
/** Pi event registration used by the context adapter. */
export interface PiContextApi {
    on(event: string, handler: (event: unknown, context: PiContext) => Promise<void>): void;
}
/** Dependencies used by the Pi context adapter. */
export interface PiContextDependencies {
    emit(context: string): Promise<void> | void;
    inspect(cwd: string): Promise<string>;
    stderr(value: string): void;
}
/**
 * Register Pi context lifecycle handlers.
 *
 * @param pi - Pi event interface that receives the lifecycle handlers.
 * @param dependencies - Context inspection and output operations.
 */
export declare function registerPiContextHooks(pi: PiContextApi, dependencies: PiContextDependencies): void;
export {};
