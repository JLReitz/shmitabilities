import { execFile } from "node:child_process";
import { readdir, readlink } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** A registered workspace that contains the inspected working directory. */
export interface WorkspaceContext
{
    root: string;
    tasksRoot: string;
}

/** A Git project that contains the inspected working directory. */
export interface ProjectContext
{
    root: string;
    checkout: "main" | "worktree";
}

/** The Shmitty filesystem context for one working directory. */
export interface ShmittyContext
{
    workspaces: WorkspaceContext[];
    project?: ProjectContext;
}

function containsPath(root: string, candidate: string): boolean
{
    const relative = path.relative(root, candidate);
    return (relative === "") || ((!relative.startsWith(`..${path.sep}`)) && (relative !== "..")
        && (!path.isAbsolute(relative)));
}

function pathDepth(value: string): number
{
    return path.normalize(value).split(path.sep).filter(Boolean).length;
}

async function inspectWorkspace(cwd: string, home: string): Promise<WorkspaceContext[]>
{
    const registry = path.join(home, ".agents", "workspaces");
    let entries;
    try
    {
        entries = await readdir(registry, { withFileTypes: true });
    }
    catch (error)
    {
        if ((error as NodeJS.ErrnoException).code === "ENOENT")
        {
            return [];
        }
        throw error;
    }

    const matchingRoots = new Set<string>();
    for (const entry of entries)
    {
        if (!entry.isSymbolicLink())
        {
            continue;
        }

        const link = path.join(registry, entry.name);
        const target = await readlink(link);
        const root = path.resolve(registry, target);
        if (containsPath(root, cwd))
        {
            matchingRoots.add(root);
        }
    }

    const innermostRoot = [...matchingRoots].sort((left, right) => pathDepth(right) - pathDepth(left))[0];
    if (innermostRoot === undefined)
    {
        return [];
    }

    return [{
        root: innermostRoot,
        tasksRoot: path.join(innermostRoot, ".agents", "tasks"),
    }];
}

async function inspectProject(cwd: string): Promise<ProjectContext | undefined>
{
    try
    {
        const { stdout } = await execFileAsync(
            "git",
            ["-C", cwd, "rev-parse", "--path-format=absolute", "--show-toplevel", "--git-dir", "--git-common-dir"],
            { encoding: "utf8", env: { ...process.env, LC_ALL: "C" } },
        );
        const [root, gitDirectory, commonDirectory] = stdout.trimEnd().split("\n");
        if ((root === undefined) || (gitDirectory === undefined) || (commonDirectory === undefined))
        {
            throw new Error("project inspection failed: git rev-parse returned an incomplete result");
        }

        return {
            root,
            checkout: gitDirectory === commonDirectory ? "main" : "worktree",
        };
    }
    catch (error)
    {
        const gitError = error as { code?: number | string; stderr?: string };
        if ((gitError.code === 128) && (gitError.stderr?.includes("not a git repository") === true))
        {
            return undefined;
        }
        throw error;
    }
}

/**
 * Inspect the registered workspace and Git project for an absolute working directory.
 *
 * @param cwd - Absolute working directory to inspect.
 * @param home - Absolute home directory that contains the workspace registry.
 * @returns The independently identified workspace and project results.
 */
export async function inspectShmittyContext(cwd: string, home: string): Promise<ShmittyContext>
{
    if ((!path.isAbsolute(cwd)) || (!path.isAbsolute(home)))
    {
        throw new Error("context inspection failed: cwd and home must be absolute paths");
    }

    const normalizedCwd = path.normalize(cwd);
    const normalizedHome = path.normalize(home);
    const [workspaces, project] = await Promise.all([
        inspectWorkspace(normalizedCwd, normalizedHome),
        inspectProject(normalizedCwd),
    ]);

    return project === undefined ? { workspaces } : { workspaces, project };
}

/**
 * Format Shmitty filesystem context as model guidance.
 *
 * @param context - Identified workspace and project results.
 * @returns Guidance blocks separated by one blank line, or an empty string when no result exists.
 */
export function formatShmittyContext(context: ShmittyContext): string
{
    const blocks: string[] = [];
    const workspace = context.workspaces[0];
    if (workspace !== undefined)
    {
        blocks.push([
            `Workspace root: ${workspace.root}`,
            `Find workspace task documents at ${workspace.tasksRoot}.`,
        ].join("\n"));
    }

    if (context.project !== undefined)
    {
        const projectLines = [
            `Project root: ${context.project.root}`,
            context.project.checkout === "worktree" ? "This is a linked worktree." : "This is the main checkout.",
        ];
        if (context.project.checkout === "worktree")
        {
            projectLines.push("Use the `shmitty-version-control` skill for work in this project.");
        }
        blocks.push(projectLines.join("\n"));
    }

    return blocks.join("\n\n");
}

/** Inspect and format Shmitty filesystem context for one working directory. */
export async function getShmittyContext(cwd: string, home: string): Promise<string>
{
    return formatShmittyContext(await inspectShmittyContext(cwd, home));
}
