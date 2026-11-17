import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

/** Codex lifecycle input used by the context hook. */
export interface CodexContextHookInput
{
    hookEventName: "SessionStart" | "UserPromptSubmit";
    sessionId: string;
    cwd: string;
    source?: string;
}

/** Output operations used by the Codex context hook. */
export interface CodexContextHookIo
{
    stderr(value: string): void;
    stdout(value: string): void;
}

/** Dependencies used by the Codex context hook. */
export interface CodexContextHookDependencies
{
    pluginData: string;
    inspect(cwd: string): Promise<string>;
    io: CodexContextHookIo;
}

function statePath(pluginData: string, sessionId: string): string
{
    return path.join(pluginData, encodeURIComponent(sessionId));
}

async function readStoredCwd(file: string): Promise<string | undefined>
{
    try
    {
        return await readFile(file, "utf8");
    }
    catch (error)
    {
        if ((error as NodeJS.ErrnoException).code === "ENOENT")
        {
            return undefined;
        }
        throw error;
    }
}

async function replaceStoredCwd(file: string, cwd: string): Promise<void>
{
    await mkdir(path.dirname(file), { recursive: true });
    const temporaryFile = `${file}.${randomUUID()}.tmp`;
    try
    {
        await writeFile(temporaryFile, cwd, { encoding: "utf8", mode: 0o600 });
        await rename(temporaryFile, file);
    }
    finally
    {
        await unlink(temporaryFile).catch(() => undefined);
    }
}

function errorText(error: unknown): string
{
    return error instanceof Error ? error.message : String(error);
}

/**
 * Run one Codex lifecycle invocation.
 *
 * @param input - Codex lifecycle event and session filesystem state.
 * @param dependencies - Context inspection, plugin state, and output operations.
 * @returns Status zero for every outcome so context inspection cannot stop the client session.
 */
export async function runCodexContextHook(
    input: CodexContextHookInput,
    dependencies: CodexContextHookDependencies,
): Promise<0>
{
    try
    {
        const cwd = path.resolve(input.cwd);
        const file = statePath(dependencies.pluginData, input.sessionId);
        const forceEmission = input.hookEventName === "SessionStart";
        if (!forceEmission)
        {
            const storedCwd = await readStoredCwd(file);
            if (storedCwd === cwd)
            {
                return 0;
            }
        }

        const context = await dependencies.inspect(cwd);
        await replaceStoredCwd(file, cwd);
        if (context !== "")
        {
            dependencies.io.stdout(context);
        }
    }
    catch (error)
    {
        dependencies.io.stderr(errorText(error));
    }

    return 0;
}
