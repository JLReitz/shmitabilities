import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse } from "smol-toml";

/** Parsed shared settings before a capability applies its own schema. */
export type SharedSettings = Record<string, unknown>;

/**
 * Locate the managed agent root for the current account.
 *
 * @returns The account's `.agents` directory.
 */
export function locateManagedAgentRoot(): string
{
    return join(homedir(), ".agents");
}

/**
 * Locate the shared settings root under the user config directory.
 *
 * @returns The account's `.config/shmit` directory.
 */
export function locateSharedSettingsRoot(): string
{
    return join(homedir(), ".config", "shmit");
}

/**
 * Read shared settings from a settings root.
 *
 * @param settingsRoot - Directory containing `settings.toml`; defaults to the shared settings root.
 * @returns Parsed settings, or an empty object when the file or its directory is absent.
 * @throws The file read error when reading fails for a reason other than absence.
 * @throws The TOML parse error when the file contains invalid TOML.
 */
export async function readSharedSettings(
    settingsRoot: string = locateSharedSettingsRoot(),
): Promise<SharedSettings>
{
    const settingsPath = join(settingsRoot, "settings.toml");
    let contents: string;

    try
    {
        contents = await readFile(settingsPath, "utf8");
    }
    catch (error)
    {
        if (isMissingFile(error))
        {
            return {};
        }
        throw error;
    }

    return parse(contents);
}

function isMissingFile(error: unknown): boolean
{
    return error instanceof Error && "code" in error && error.code === "ENOENT";
}
