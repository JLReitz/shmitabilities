import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
function statePath(pluginData, sessionId) {
    return path.join(pluginData, encodeURIComponent(sessionId));
}
async function readStoredCwd(file) {
    try {
        return await readFile(file, "utf8");
    }
    catch (error) {
        if (error.code === "ENOENT") {
            return undefined;
        }
        throw error;
    }
}
async function replaceStoredCwd(file, cwd) {
    await mkdir(path.dirname(file), { recursive: true });
    const temporaryFile = `${file}.${randomUUID()}.tmp`;
    try {
        await writeFile(temporaryFile, cwd, { encoding: "utf8", mode: 0o600 });
        await rename(temporaryFile, file);
    }
    finally {
        await unlink(temporaryFile).catch(() => undefined);
    }
}
function errorText(error) {
    return error instanceof Error ? error.message : String(error);
}
/**
 * Run one Codex lifecycle invocation.
 *
 * @param input - Codex lifecycle event and session filesystem state.
 * @param dependencies - Context inspection, plugin state, and output operations.
 * @returns Status zero for every outcome so context inspection cannot stop the client session.
 */
export async function runCodexContextHook(input, dependencies) {
    try {
        const cwd = path.resolve(input.cwd);
        const file = statePath(dependencies.pluginData, input.sessionId);
        const forceEmission = input.hookEventName === "SessionStart";
        if (!forceEmission) {
            const storedCwd = await readStoredCwd(file);
            if (storedCwd === cwd) {
                return 0;
            }
        }
        const context = await dependencies.inspect(cwd);
        await replaceStoredCwd(file, cwd);
        if (context !== "") {
            dependencies.io.stdout(context);
        }
    }
    catch (error) {
        dependencies.io.stderr(errorText(error));
    }
    return 0;
}
