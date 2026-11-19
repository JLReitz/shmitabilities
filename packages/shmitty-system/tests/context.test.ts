import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect } from "vitest";

import { formatShmittyContext, inspectShmittyContext } from "../src/context.js";
import { test } from "./fixtures/filesystem.js";

interface WorkspaceRegistryEntry
{
    kind: "directory" | "symlink";
    name: string;
    target?: string[];
    relative?: boolean;
}

interface WorkspaceContextCase
{
    name: string;
    cwd: string[];
    registry: WorkspaceRegistryEntry[] | null;
    expected: string[] | null;
}

const workspaceContextCases = JSON.parse(readFileSync(
    new URL("./fixtures/workspace-context-cases.json", import.meta.url),
    "utf8",
)) as WorkspaceContextCase[];

describe("inspectShmittyContext", () =>
{
    test("matchesSharedWorkspaceResolutionCases", async ({ filesystem }) =>
    {
        for (const [index, contextCase] of workspaceContextCases.entries())
        {
            const prefix = `shared-case-${index}`;
            const home = await filesystem.createDirectory(prefix, "home");
            const cwd = await filesystem.createDirectory(prefix, ...contextCase.cwd);
            if (contextCase.registry !== null)
            {
                const registry = await filesystem.createDirectory(
                    prefix,
                    "home",
                    ".agents",
                    "workspaces",
                );
                for (const entry of contextCase.registry)
                {
                    if (entry.kind === "directory")
                    {
                        await filesystem.createDirectory(
                            prefix,
                            "home",
                            ".agents",
                            "workspaces",
                            entry.name,
                        );
                        continue;
                    }

                    const targetSegments = entry.target ?? [];
                    const target = await filesystem.createDirectory(prefix, ...targetSegments);
                    await filesystem.createSymlink(
                        entry.relative ? path.relative(registry, target) : target,
                        prefix,
                        "home",
                        ".agents",
                        "workspaces",
                        entry.name,
                    );
                }
            }

            const result = await inspectShmittyContext(cwd, home);
            const expected = contextCase.expected === null
                ? []
                : [{
                    root: filesystem.resolve(prefix, ...contextCase.expected),
                    tasksRoot: filesystem.resolve(prefix, ...contextCase.expected, ".agents", "tasks"),
                }];

            expect(result.workspaces, contextCase.name).toEqual(expected);
        }
    });

    test("returnsInnermostWorkspaceWhenNestedLinksAndAliasesMatch", async ({ filesystem }) =>
    {
        const home = filesystem.resolve("home");
        const outer = filesystem.resolve("workspace");
        const inner = path.join(outer, "nested");
        const cwd = path.join(inner, "project");
        await filesystem.createDirectory("home", ".agents", "workspaces");
        await filesystem.createDirectory("workspace", "nested", "project");
        await filesystem.createSymlink(outer, "home", ".agents", "workspaces", "outer");
        await filesystem.createSymlink(inner, "home", ".agents", "workspaces", "inner");
        await filesystem.createSymlink(inner, "home", ".agents", "workspaces", "inner-alias");

        const result = await inspectShmittyContext(cwd, home);

        expect(result.workspaces).toEqual([{
            root: inner,
            tasksRoot: path.join(inner, ".agents", "tasks"),
        }]);
    });

    test("ignoresOrdinaryRegistryEntriesAndReportsRegisteredWorktreeOnce", async ({ filesystem }) =>
    {
        const home = filesystem.resolve("home");
        const workspace = filesystem.resolve("workspace");
        const repository = filesystem.createRepository("workspace", "repository");
        const worktree = filesystem.createWorktree(repository, "workspace", "linked-worktree");
        await filesystem.createDirectory("home", ".agents", "workspaces");
        await filesystem.createDirectory("home", ".agents", "workspaces", "ordinary-entry");
        await filesystem.createSymlink(workspace, "home", ".agents", "workspaces", "absolute-workspace");
        await filesystem.createSymlink("../../../workspace", "home", ".agents", "workspaces", "relative-alias");

        const result = await inspectShmittyContext(worktree, home);

        expect(result).toEqual({
            workspaces: [{
                root: workspace,
                tasksRoot: path.join(workspace, ".agents", "tasks"),
            }],
            project: { root: worktree, checkout: "worktree" },
        });
        expect(formatShmittyContext(result)).toBe([
            `Workspace root: ${workspace}`,
            `Find workspace task documents at ${workspace}/.agents/tasks.`,
            "",
            `Project root: ${worktree}`,
            "This is a linked worktree.",
            "Use the `shmitty-version-control` skill for work in this project.",
        ].join("\n"));
    });

    test("classifiesProjectWhenMainAndLinkedCheckoutsAreInspected", async ({ filesystem }) =>
    {
        const home = filesystem.resolve("home");
        await filesystem.createDirectory("home", ".agents", "workspaces");
        const repository = filesystem.createRepository("repository");
        const worktree = filesystem.createWorktree(repository, "linked-worktree");

        const mainResult = await inspectShmittyContext(repository, home);
        const worktreeResult = await inspectShmittyContext(worktree, home);

        expect(mainResult.project).toEqual({ root: repository, checkout: "main" });
        expect(worktreeResult.project).toEqual({ root: worktree, checkout: "worktree" });
    });

    test("returnsEmptyContextWhenNoWorkspaceOrProjectMatches", async ({ filesystem }) =>
    {
        const home = filesystem.resolve("home");
        const cwd = await filesystem.createDirectory("unregistered");

        const result = await inspectShmittyContext(cwd, home);

        expect(result).toEqual({ workspaces: [] });
        expect(formatShmittyContext(result)).toBe("");
    });

    test("formatsWorkspaceAndWorktreeGuidanceWhenBothAreIdentified", () =>
    {
        const workspace = "/workspace";
        const project = "/workspace/project-worktree";

        const output = formatShmittyContext({
            workspaces: [{
                root: workspace,
                tasksRoot: `${workspace}/.agents/tasks`,
            }],
            project: { root: project, checkout: "worktree" },
        });

        expect(output).toBe([
            `Workspace root: ${workspace}`,
            `Find workspace task documents at ${workspace}/.agents/tasks.`,
            "",
            `Project root: ${project}`,
            "This is a linked worktree.",
            "Use the `shmitty-version-control` skill for work in this project.",
        ].join("\n"));
    });
});
