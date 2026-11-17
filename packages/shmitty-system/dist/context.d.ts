/** A registered workspace that contains the inspected working directory. */
export interface WorkspaceContext {
    root: string;
    tasksRoot: string;
}
/** A Git project that contains the inspected working directory. */
export interface ProjectContext {
    root: string;
    checkout: "main" | "worktree";
}
/** The Shmitty filesystem context for one working directory. */
export interface ShmittyContext {
    workspaces: WorkspaceContext[];
    project?: ProjectContext;
}
/**
 * Inspect the registered workspace and Git project for an absolute working directory.
 *
 * @param cwd - Absolute working directory to inspect.
 * @param home - Absolute home directory that contains the workspace registry.
 * @returns The independently identified workspace and project results.
 */
export declare function inspectShmittyContext(cwd: string, home: string): Promise<ShmittyContext>;
/**
 * Format Shmitty filesystem context as model guidance.
 *
 * @param context - Identified workspace and project results.
 * @returns Guidance blocks separated by one blank line, or an empty string when no result exists.
 */
export declare function formatShmittyContext(context: ShmittyContext): string;
/** Inspect and format Shmitty filesystem context for one working directory. */
export declare function getShmittyContext(cwd: string, home: string): Promise<string>;
