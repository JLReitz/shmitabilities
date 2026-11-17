import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test as base } from "vitest";

interface TemporaryFilesystem
{
    createDirectory(...segments: string[]): Promise<string>;
    createRepository(...segments: string[]): string;
    createSymlink(target: string, ...segments: string[]): Promise<string>;
    createWorktree(repository: string, ...segments: string[]): string;
    resolve(...segments: string[]): string;
}

export const test = base.extend<{ filesystem: TemporaryFilesystem }>({
    filesystem: async ({}, use) =>
    {
        const root = await mkdtemp(path.join(tmpdir(), "shmitty-system-test-"));
        const resolve = (...segments: string[]): string => path.join(root, ...segments);
        const filesystem: TemporaryFilesystem = {
            async createDirectory(...segments): Promise<string>
            {
                const directory = resolve(...segments);
                await mkdir(directory, { recursive: true });
                return directory;
            },
            createRepository(...segments): string
            {
                const repository = resolve(...segments);
                execFileSync("git", ["init", "--quiet", repository]);
                execFileSync("git", [
                    "-C",
                    repository,
                    "-c",
                    "user.name=Shmitty Test",
                    "-c",
                    "user.email=shmitty@example.invalid",
                    "commit",
                    "--allow-empty",
                    "--quiet",
                    "-m",
                    "fixture",
                ]);
                return repository;
            },
            async createSymlink(target, ...segments): Promise<string>
            {
                const link = resolve(...segments);
                await symlink(target, link);
                return link;
            },
            createWorktree(repository, ...segments): string
            {
                const worktree = resolve(...segments);
                execFileSync("git", [
                    "-C",
                    repository,
                    "worktree",
                    "add",
                    "--quiet",
                    "--detach",
                    worktree,
                ]);
                return worktree;
            },
            resolve,
        };

        try
        {
            await use(filesystem);
        }
        finally
        {
            await rm(root, { recursive: true, force: true });
        }
    },
});
