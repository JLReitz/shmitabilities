import { locateSharedSettingsRoot, readSharedSettings } from "@jlreitz/shmit-core";
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { connect } from "node:net";
import { dirname, isAbsolute, join } from "node:path";

/** Resolved settings used by the router and client adapters. */
export interface LlamaConfig
{
    command: string;
    modelIni: string;
    port: number;
}

const HOST = "127.0.0.1";
const START_TIMEOUT_MS = 30_000;
const POLL_MS = 200;

/**
 * Read shared settings and apply the llama.cpp capability schema.
 *
 * @returns The router command, model preset path, and port after defaults are applied.
 * @throws A settings read or TOML parse error when shared settings cannot be read.
 * @throws An error when configured router settings have invalid values.
 */
export async function loadLlamaConfig(): Promise<LlamaConfig>
{
    const settingsRoot = locateSharedSettingsRoot();
    const settings = await readSharedSettings(settingsRoot);
    const shmit = optionalTable(settings.shmit, "shmit");
    const llamacpp = optionalTable(shmit.llamacpp, "shmit.llamacpp");
    const command = optionalString(llamacpp.command, "shmit.llamacpp.command") ?? "llama-server";
    const modelIni = optionalString(llamacpp.model_ini, "shmit.llamacpp.model_ini")
        ?? join(settingsRoot, "models.ini");
    const port = llamacpp.port === undefined ? 8080 : llamacpp.port;

    if (!isAbsolute(command) && (command.includes("/") || command.includes("\\")))
    {
        throw new Error("shmit.llamacpp.command must be an executable name on PATH or an absolute path");
    }

    if (!isAbsolute(modelIni))
    {
        throw new Error("shmit.llamacpp.model_ini must be an absolute path");
    }

    if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535)
    {
        throw new Error("shmit.llamacpp.port must be an integer from 1 through 65535");
    }

    return { command, modelIni, port };
}

/**
 * Identify a native provider endpoint that targets this router.
 *
 * @param baseUrl - Native provider endpoint to inspect.
 * @param config - Router settings that supply the port.
 * @returns Whether the endpoint addresses the router's loopback host and port.
 */
export function targetsRouter(baseUrl: string, config: LlamaConfig): boolean
{
    try
    {
        const url = new URL(baseUrl);
        return url.hostname === HOST && Number(url.port || (url.protocol === "https:" ? 443 : 80)) === config.port;
    }
    catch
    {
        return false;
    }
}

/**
 * Require the native provider endpoint to use the configured router.
 *
 * @param baseUrl - Native provider endpoint to validate.
 * @param config - Router settings that supply the port.
 * @throws An error when the URL is invalid or does not use HTTP on the configured loopback port.
 */
export function validateProviderUrl(baseUrl: string, config: LlamaConfig): void
{
    let url: URL;
    try
    {
        url = new URL(baseUrl);
    }
    catch
    {
        throw new Error(`Provider URL is invalid: ${baseUrl}`);
    }

    if (
        url.protocol !== "http:" || url.hostname !== HOST || Number(url.port || 80) !== config.port
        || url.username !== "" || url.password !== ""
    )
    {
        throw new Error(`Provider URL must address http://${HOST}:${config.port}`);
    }
}

/**
 * Connect to an existing router or start one and verify its model inventory.
 *
 * @remarks
 * A started router remains active after this call and after the client exits.
 *
 * @param modelId - Exact model ID required in the router inventory.
 * @param config - Router command, model preset path, and port.
 * @returns When the router inventory contains the selected model.
 * @throws An error when the model ID is empty, the router is incompatible, or startup fails.
 */
export async function ensureRouter(modelId: string, config: LlamaConfig): Promise<void>
{
    if (modelId.trim() === "")
    {
        throw new Error("Selected model ID is empty");
    }

    if (await portOpen(config.port))
    {
        await requireModel(modelId, config.port);
        return;
    }

    // An absent port is the only reason to use the local INI catalog.
    try
    {
        await access(config.modelIni, constants.R_OK);
    }
    catch (error)
    {
        if (await portOpen(config.port))
        {
            await requireModel(modelId, config.port);
            return;
        }
        throw error;
    }

    const child = spawn(config.command, [
        "--host",
        HOST,
        "--port",
        String(config.port),
        "--models-preset",
        config.modelIni,
    ], { cwd: dirname(config.modelIni), detached: true, stdio: "ignore", shell: false });
    const launchError = new Promise<Error>((resolve) => child.once("error", resolve));
    child.unref();

    const deadline = Date.now() + START_TIMEOUT_MS;
    while (Date.now() < deadline)
    {
        const outcome = await Promise.race([
            launchError.then((error) => ({ error })),
            probeModels(modelId, config.port),
        ]);
        if (typeof outcome === "object")
        {
            // Another launcher can win the port even if this process cannot start.
            if (await portOpen(config.port))
            {
                await requireModel(modelId, config.port);
                return;
            }
            throw new Error(`Starting ${config.command} failed: ${outcome.error.message}`);
        }

        if (outcome === "found")
        {
            return;
        }

        if (outcome === "missing")
        {
            throw new Error(`Model ${modelId} is unavailable on router port ${config.port}`);
        }

        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }

    throw new Error(`Router on port ${config.port} did not become ready within ${START_TIMEOUT_MS} ms`);
}

function optionalTable(value: unknown, key: string): Record<string, unknown>
{
    if (value === undefined)
    {
        return {};
    }

    if (typeof value !== "object" || value === null || Array.isArray(value))
    {
        throw new Error(`${key} must be a TOML table`);
    }

    return value as Record<string, unknown>;
}

function optionalString(value: unknown, key: string): string | undefined
{
    if (value === undefined)
    {
        return undefined;
    }

    if (typeof value !== "string" || value.trim() === "")
    {
        throw new Error(`${key} must be a nonempty string`);
    }

    return value;
}

function portOpen(port: number): Promise<boolean>
{
    return new Promise((resolve, reject) =>
    {
        const socket = connect({ host: HOST, port });
        socket.once("connect", () =>
        {
            socket.destroy();
            resolve(true);
        });
        socket.once("error", (error: NodeJS.ErrnoException) =>
        {
            socket.destroy();
            if (error.code === "ECONNREFUSED")
            {
                resolve(false);
            }
            else
            {
                reject(error);
            }
        });
    });
}

async function requireModel(modelId: string, port: number): Promise<void>
{
    const result = await probeModels(modelId, port);
    if (result === "found")
    {
        return;
    }
    if (result === "missing")
    {
        throw new Error(`Model ${modelId} is unavailable on router port ${port}`);
    }
    throw new Error(`Port ${port} does not serve a valid llama.cpp /models response`);
}

async function probeModels(modelId: string, port: number): Promise<"found" | "missing" | "unready">
{
    let response: Response;
    try
    {
        response = await fetch(`http://${HOST}:${port}/models`, { signal: AbortSignal.timeout(1500) });
    }
    catch
    {
        return "unready";
    }
    if (!response.ok)
    {
        return "unready";
    }
    let inventory: unknown;
    try
    {
        inventory = await response.json();
    }
    catch
    {
        return "unready";
    }
    if (
        typeof inventory !== "object" || inventory === null
        || !("data" in inventory) || !Array.isArray(inventory.data)
    )
    {
        return "unready";
    }
    const models = inventory.data as unknown[];
    if (
        !models.every((model) =>
            typeof model === "object" && model !== null
            && "id" in model && typeof model.id === "string"
        )
    )
    {
        return "unready";
    }
    return models.some((model) => (model as { id: string }).id === modelId) ? "found" : "missing";
}
