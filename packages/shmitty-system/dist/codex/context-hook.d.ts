/** Codex lifecycle input used by the context hook. */
export interface CodexContextHookInput {
    hookEventName: "SessionStart" | "UserPromptSubmit";
    sessionId: string;
    cwd: string;
    source?: string;
}
/** Output operations used by the Codex context hook. */
export interface CodexContextHookIo {
    stderr(value: string): void;
    stdout(value: string): void;
}
/** Dependencies used by the Codex context hook. */
export interface CodexContextHookDependencies {
    pluginData: string;
    inspect(cwd: string): Promise<string>;
    io: CodexContextHookIo;
}
/**
 * Run one Codex lifecycle invocation.
 *
 * @param input - Codex lifecycle event and session filesystem state.
 * @param dependencies - Context inspection, plugin state, and output operations.
 * @returns Status zero for every outcome so context inspection cannot stop the client session.
 */
export declare function runCodexContextHook(input: CodexContextHookInput, dependencies: CodexContextHookDependencies): Promise<0>;
