import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureRouter, type LlamaConfig, loadLlamaConfig, targetsRouter, validateProviderUrl } from "../src/index.js";

const settings = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("@jlreitz/shmit-core", () => ({
    locateSharedSettingsRoot: () => "/test/.config/shmit",
    readSharedSettings: async () => settings.value,
}));

const servers: Server[] = [];
const directories: string[] = [];
const launchedPids: number[] = [];
afterEach(async () =>
{
    settings.value = {};
    for (const pid of launchedPids.splice(0))
    {
        process.kill(pid, "SIGTERM");
    }
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function config(port: number): LlamaConfig
{
    return { command: "llama-server", modelIni: "/missing/models.ini", port };
}

async function serveInventory(inventory: unknown, status = 200): Promise<number>
{
    const server = createServer((_request, response) =>
    {
        response.writeHead(status, { "content-type": "application/json" });
        response.end(JSON.stringify(inventory));
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    servers.push(server);

    const address = server.address();
    if (address === null || typeof address === "string")
    {
        throw new Error("Expected TCP address");
    }

    return address.port;
}

describe("loadLlamaConfig", () =>
{
    it("usesDefaultsWhenSettingsAreAbsent", async () =>
    {
        const result = await loadLlamaConfig();

        expect(result).toEqual({ command: "llama-server", modelIni: "/test/.config/shmit/models.ini", port: 8080 });
    });

    it("usesSharedRouterSettingsWhenPresent", async () =>
    {
        settings.value = {
            shmit: { llamacpp: { command: "/usr/bin/llama-server", model_ini: "/models/models.ini", port: 8999 } },
        };

        const result = await loadLlamaConfig();

        expect(result).toMatchObject({ command: "/usr/bin/llama-server", modelIni: "/models/models.ini", port: 8999 });
    });

    it.each([
        [{ shmit: { llamacpp: { port: 0 } } }, "shmit.llamacpp.port"],
        [{ shmit: { llamacpp: { port: 1.5 } } }, "shmit.llamacpp.port"],
        [{ shmit: { llamacpp: { command: "./server" } } }, "shmit.llamacpp.command"],
        [{ shmit: { llamacpp: { model_ini: "models.ini" } } }, "shmit.llamacpp.model_ini"],
    ])("rejectsInvalidSettingsWhenConfigured", async (value, key) =>
    {
        settings.value = value;

        await expect(loadLlamaConfig()).rejects.toThrow(key);
    });
});

describe("validateProviderUrl", () =>
{
    it("acceptsNativeV1PathOnConfiguredRouter", () =>
    {
        expect(() => validateProviderUrl("http://127.0.0.1:8899/v1", config(8899))).not.toThrow();
    });

    it.each([
        "http://localhost:8899/v1",
        "http://127.0.0.1:8898/v1",
        "https://127.0.0.1:8899/v1",
        "http://user:pass@127.0.0.1:8899/v1",
    ])("rejectsOtherProviderEndpointWhenConfigured", (url) =>
    {
        expect(() => validateProviderUrl(url, config(8899))).toThrow("Provider URL must address");
    });
});

describe("targetsRouter", () =>
{
    it("acceptsNativeProviderOnConfiguredPort", () =>
    {
        expect(targetsRouter("http://127.0.0.1:8899/v1", config(8899))).toBe(true);
    });

    it.each(["https://example.com/v1", "http://127.0.0.1:8898/v1", "invalid"])(
        "skipsOtherNativeEndpointWhenConfigured",
        url =>
        {
            expect(targetsRouter(url, config(8899))).toBe(false);
        },
    );
});

describe("ensureRouter", () =>
{
    it("connectsWhenSelectedModelIsInActiveInventory", async () =>
    {
        const port = await serveInventory({ data: [{ id: "model-a", status: { value: "unloaded" } }] });

        await ensureRouter("model-a", config(port));
    });

    it("rejectsMissingModelWithoutLaunchingWhenPortIsOccupied", async () =>
    {
        const port = await serveInventory({ data: [{ id: "model-b" }] });

        await expect(ensureRouter("model-a", config(port))).rejects.toThrow(
            `Model model-a is unavailable on router port ${port}`,
        );
    });

    it("rejectsOccupiedPortWithoutValidInventory", async () =>
    {
        const port = await serveInventory({ error: "other service" });

        await expect(ensureRouter("model-a", config(port))).rejects.toThrow(
            "does not serve a valid llama.cpp /models response",
        );
    });

    it("requiresIniBeforeLaunchingOnInactivePort", async () =>
    {
        const port = await unusedPort();

        await expect(ensureRouter("model-a", config(port))).rejects.toMatchObject({ code: "ENOENT" });
    });

    it("launchesFromIniDirectoryAndLeavesRouterRunning", async () =>
    {
        const directory = await mkdtemp(join(tmpdir(), "llamas-and-shmit-"));
        directories.push(directory);

        const port = await unusedPort();
        const ini = join(directory, "models.ini");
        const command = join(directory, "fake-server");
        const receipt = join(directory, "receipt.json");

        await writeFile(ini, "[model-a]\n");
        await writeFile(
            command,
            `#!/usr/bin/env node
const http = require('node:http');
const fs = require('node:fs');
const args = process.argv.slice(2);
const port = Number(args[args.indexOf('--port') + 1]);
fs.writeFileSync(${JSON.stringify(receipt)}, JSON.stringify({cwd: process.cwd(), args, pid: process.pid}));
http.createServer((_request, response) => {
  response.writeHead(200, {'content-type': 'application/json'});
  response.end(JSON.stringify({data: [{id: 'model-a'}]}));
}).listen(port, '127.0.0.1');
`,
            { mode: 0o755 },
        );

        await ensureRouter("model-a", { ...config(port), command, modelIni: ini });

        const result = JSON.parse(await readFile(receipt, "utf8")) as {
            cwd: string;
            args: string[];
            pid: number;
        };
        launchedPids.push(result.pid);

        expect(result.cwd).toBe(directory);
        expect(result.args).toEqual(["--host", "127.0.0.1", "--port", String(port), "--models-preset", ini]);

        await ensureRouter("model-a", { ...config(port), command, modelIni: ini });
    });
});

async function unusedPort(): Promise<number>
{
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

    const address = server.address();
    if (address === null || typeof address === "string")
    {
        throw new Error("Expected TCP address");
    }

    await new Promise<void>((resolve) => server.close(() => resolve()));
    return address.port;
}
