import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { locateManagedAgentRoot, locateSharedSettingsRoot, readSharedSettings } from "../src/index.js";

let agentRoot: string;

beforeEach(async () =>
{
    agentRoot = await mkdtemp(join(tmpdir(), "shmit-core-"));
});

afterEach(async () =>
{
    await rm(agentRoot, { recursive: true, force: true });
});

describe("locateManagedAgentRoot", () =>
{
    it("returns the managed directory under HOME", () =>
    {
        const previousHome = process.env.HOME;
        process.env.HOME = agentRoot;

        try
        {
            const root = locateManagedAgentRoot();

            expect(root).toBe(join(agentRoot, ".agents"));
        }
        finally
        {
            if (previousHome === undefined)
            {
                delete process.env.HOME;
            }
            else
            {
                process.env.HOME = previousHome;
            }
        }
    });
});

describe("locateSharedSettingsRoot", () =>
{
    it("returns the shared settings directory under HOME/.config", () =>
    {
        const previousHome = process.env.HOME;
        process.env.HOME = agentRoot;

        try
        {
            const root = locateSharedSettingsRoot();

            expect(root).toBe(join(agentRoot, ".config", "shmit"));
        }
        finally
        {
            if (previousHome === undefined)
            {
                delete process.env.HOME;
            }
            else
            {
                process.env.HOME = previousHome;
            }
        }
    });
});

describe("readSharedSettings", () =>
{
    it.each([
        ["settings directory is absent", false],
        ["settings file is absent", true],
    ])("returns an empty object when %s", async (_condition, createDirectory) =>
    {
        if (createDirectory)
        {
            await mkdir(agentRoot, { recursive: true });
        }

        const settings = await readSharedSettings(agentRoot);

        expect(settings).toEqual({});
    });

    it("returns raw nested values when settings exist", async () =>
    {
        await mkdir(agentRoot, { recursive: true });
        await writeFile(
            join(agentRoot, "settings.toml"),
            "[shmit.llamacpp]\nport = 8080\n",
        );

        const settings = await readSharedSettings(agentRoot);

        expect(settings).toEqual({ shmit: { llamacpp: { port: 8080 } } });
        expect((settings.shmit as Record<string, unknown>).headroom).toBeUndefined();
    });

    it("reports invalid TOML when settings cannot be parsed", async () =>
    {
        await mkdir(agentRoot, { recursive: true });
        await writeFile(join(agentRoot, "settings.toml"), "port = [");

        const reading = readSharedSettings(agentRoot);

        await expect(reading).rejects.toThrow();
    });
});
