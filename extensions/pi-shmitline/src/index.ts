import { existsSync, readFileSync, writeFileSync, statSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { platform } from "node:os";
import { DEFAULT_SHORTCUTS, resolveShortcutConfig, matchAnyShortcut } from "./components/shortcuts.ts";
import { renderFixedEditorCluster } from "./components/cluster.ts";
import { TerminalSplitCompositor } from "./components/terminal-split.ts";
import type { ShortcutConfig } from "./components/shortcuts.ts";
import type { FixedEditorClusterInput } from "./components/cluster.ts";

// ============================================================================
// Config
// ============================================================================

export interface ShmitlineConfig {
  statusScript: string;
  mouseScroll: boolean;
  shortcuts: ShortcutConfig;
}

export const DEFAULT_CONFIG: ShmitlineConfig = {
  statusScript: "",
  mouseScroll: true,
  shortcuts: { ...DEFAULT_SHORTCUTS },
};

const CONFIG_FILENAME = "shmitline.json";

function resolveConfigPath(scope: "global" | "project", cwd: string): string {
  if (scope === "global") {
    return join(process.env.HOME || "/", ".pi", CONFIG_FILENAME);
  }
  return join(cwd, ".pi", CONFIG_FILENAME);
}

function readJsonFile(path: string): unknown {
  try {
    const content = readFileSync(path, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function writeJsonFile(path: string, data: unknown): void {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

function installDefaultsIfAbsent(scope: "global" | "project", cwd: string): void {
  const path = resolveConfigPath(scope, cwd);
  if (!existsSync(path)) {
    writeJsonFile(path, DEFAULT_CONFIG);
  }
}

function loadConfig(scope: "global" | "project", cwd: string): Partial<ShmitlineConfig> & { _rawShortcuts?: Record<string, string | string[]>; _configPath: string } {
  const path = resolveConfigPath(scope, cwd);
  const raw = readJsonFile(path);
  if (!raw || typeof raw !== "object") {
    return { _configPath: path };
  }

  const obj = raw as Record<string, unknown>;
  const result: Partial<ShmitlineConfig> & { _rawShortcuts?: Record<string, string | string[]>; _configPath: string } = { _configPath: path };

  if (typeof obj.statusScript === "string") {
    result.statusScript = obj.statusScript;
  }
  if (obj.mouseScroll !== undefined) {
    result.mouseScroll = obj.mouseScroll as boolean;
  }
  if (obj.shortcuts) {
    result._rawShortcuts = obj.shortcuts as Record<string, string | string[]>;
  }

  return result;
}

export interface ConfigLayer extends Partial<ShmitlineConfig> {
  _rawShortcuts?: Record<string, string | string[]>;
  _configPath?: string;
}

export function mergeConfigLayers(globalConfig: ConfigLayer, projectConfig: ConfigLayer): ShmitlineConfig {
  const mergedShortcuts: Record<string, string | string[]> = {};
  if (globalConfig._rawShortcuts) Object.assign(mergedShortcuts, globalConfig._rawShortcuts);
  if (projectConfig._rawShortcuts) Object.assign(mergedShortcuts, projectConfig._rawShortcuts);

  const merged = {
    ...DEFAULT_CONFIG,
    ...globalConfig,
    ...projectConfig,
    shortcuts: resolveShortcutConfig({ shortcuts: mergedShortcuts }),
  } as ShmitlineConfig & { _rawShortcuts?: unknown; _configPath?: unknown };
  delete merged._rawShortcuts;
  delete merged._configPath;
  return merged;
}

// ============================================================================
// Validation
// ============================================================================

export interface ConfigError {
  field: string;
  message: string;
}

export function validateConfig(config: ShmitlineConfig, configPath?: string): ConfigError[] {
  const errors: ConfigError[] = [];

  // Validate shortcuts
  const shortcutKeys = Object.keys(config.shortcuts) as Array<keyof ShortcutConfig>;
  for (const key of shortcutKeys) {
    const value = config.shortcuts[key];
    if (value !== undefined) {
      const isValid = typeof value === "string" || (Array.isArray(value) && value.every((v) => typeof v === "string"));
      if (!isValid) {
        errors.push({ field: `shortcuts.${key}`, message: `shortcuts.${key} must be string or string[]` });
      }
    }
  }

  // Validate statusScript path if non-empty
  if (config.statusScript) {
    const resolved = resolveStatusScriptPath(config.statusScript, configPath);
    if (!existsSync(resolved)) {
      errors.push({ field: "statusScript", message: `statusScript not found: ${resolved}` });
    } else if (!existsSync(resolved) || (process.platform !== "win32" && (resolvedStat(resolved).mode & 0o111) === 0)) {
      errors.push({ field: "statusScript", message: `statusScript not executable: ${resolved}` });
    }
  }

  return errors;
}

let configDirForScript: string = process.cwd();

function resolveStatusScriptPath(script: string, configPath?: string): string {
  if (script.startsWith("~")) {
    return join(process.env.HOME || "/", script.slice(1));
  }
  if (!script.startsWith("/") && !script.startsWith("~")) {
    // Relative to config file location
    const dir = configPath ? dirname(configPath) : configDirForScript;
    return join(dir, script);
  }
  return script;
}

function resolvedStat(path: string): { mode?: number } {
  try {
    return statSync(path);
  } catch {
    return {};
  }
}

// ============================================================================
// Data extraction
// ============================================================================

export interface StatusScriptInput {
  version: 1;
  terminal: { width: number };
  context: {
    tokens: number | null;
    contextWindow: number;
    percent: number | null;
  };
  usage: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    totalTokens: number;
    cacheHitPercent: number;
    cost: number;
  };
  model: {
    id: string;
    name: string;
    provider: string;
    reasoning: boolean;
    contextWindow: number;
    maxTokens: number;
  } | null;
  thinkingLevel: string | null;
  session: {
    id: string;
    name: string | null;
    cwd: string;
  };
  git: {
    branch: string | null;
    status: string;
  };
  extensionStatuses: Array<{ key: string; text: string }>;
  time: string;
}

interface FooterStatusData {
  getGitBranch?(): string | null;
  getExtensionStatuses?(): ReadonlyMap<string, string>;
  onBranchChange?(callback: () => void): () => void;
}

export function extractStatusData(
  ctx: any,
  events: any[],
  previous?: StatusScriptInput | null,
  refreshGit: boolean = true,
  footerData?: FooterStatusData | null,
  thinkingLevel?: string | null,
): StatusScriptInput {
  const prior = previous ?? {
    version: 1 as const,
    terminal: { width: 80 },
    context: { tokens: null, contextWindow: 0, percent: null },
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cacheHitPercent: 0, cost: 0 },
    model: null,
    thinkingLevel: null,
    session: { id: "", name: null, cwd: ctx?.cwd || process.cwd() },
    git: { branch: null, status: "" },
    extensionStatuses: [],
    time: "",
  };

  let branch = footerData?.getGitBranch?.() ?? prior.git.branch;
  let status = prior.git.status;
  if (refreshGit) {
    branch = footerData?.getGitBranch?.() ?? (execSyncSafe("git", ["rev-parse", "--abbrev-ref", "HEAD"], ctx) || null);
    status = "";
    const porcelain = execSyncSafe("git", ["status", "--porcelain"], ctx);
    if (porcelain) {
      const lines = porcelain.trim().split("\n").filter(Boolean);
      const staged = lines.filter((line: string) => /^[AMD]|^R|^C/.test(line)).length;
      const unstaged = lines.filter((line: string) => /^ [MD]/.test(line)).length;
      const untracked = lines.filter((line: string) => line.startsWith("??")).length;
      if (staged > 0 || unstaged > 0 || untracked > 0) {
        status = `${staged > 0 ? `↑${staged}` : ""} ${unstaged > 0 ? `↓${unstaged}` : ""} ${untracked > 0 ? `?${untracked}` : ""}`.trim();
      }
    }
  }

  let contextTokens = prior.context.tokens;
  let contextPercent = prior.context.percent;
  let contextWindow = ctx?.model?.contextWindow ?? prior.context.contextWindow;
  let lastTurnCost = 0;
  let selectedThinkingLevel = thinkingLevel ?? ctx?.thinkingLevel ?? prior.thinkingLevel;
  let selectedModel = ctx?.model ?? prior.model;

  const contextUsage = ctx?.getContextUsage?.();
  if (contextUsage && typeof contextUsage === "object") {
    if (typeof contextUsage.contextWindow === "number" && Number.isFinite(contextUsage.contextWindow)) {
      contextWindow = contextUsage.contextWindow;
    }
    contextTokens = typeof contextUsage.tokens === "number" && Number.isFinite(contextUsage.tokens) ? contextUsage.tokens : null;
    contextPercent = typeof contextUsage.percent === "number" && Number.isFinite(contextUsage.percent) ? contextUsage.percent : null;
  }

  for (const event of events) {
    if (event?.type === "turn_end" && event?.message?.usage) {
      const usage = event.message.usage;
      const total = usage.input + (usage.output ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
      if (!contextUsage && contextWindow > 0) {
        contextTokens = total;
        contextPercent = (total / contextWindow) * 100;
      }
      if (usage.cost?.total !== undefined) {
        lastTurnCost = usage.cost.total;
      }
    }

    if (event?.type === "thinking_level_change" && event?.thinkingLevel) {
      selectedThinkingLevel = event.thinkingLevel;
    } else if (event?.type === "thinking_level_select" && event?.level) {
      selectedThinkingLevel = event.level;
    }
    if (event?.type === "model_select" && event.model) {
      selectedModel = event.model;
    } else if (event?.type === "model_change" && event.modelId) {
      selectedModel = { ...(selectedModel ?? {}), id: event.modelId, name: event.modelId };
    }
  }

  const time = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
  const width = ctx?.terminal?.columns || 80;

  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  let cost = 0;
  const sessionEntries = ctx?.sessionManager?.getEntries?.() ?? ctx?.sessionManager?.getBranch?.() ?? [];
  for (const entry of sessionEntries) {
    const message = entry?.type === "message" ? entry.message : undefined;
    if (message?.role !== "assistant" || !message.usage) continue;
    if (message.stopReason === "error" || message.stopReason === "aborted") continue;
    inputTokens += Number(message.usage.input) || 0;
    outputTokens += Number(message.usage.output) || 0;
    cacheReadTokens += Number(message.usage.cacheRead) || 0;
    cacheWriteTokens += Number(message.usage.cacheWrite) || 0;
    cost += Number(message.usage.cost?.total) || 0;
  }
  if (cost === 0) cost = lastTurnCost;
  const totalTokens = inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens;
  const cacheEligibleTokens = inputTokens + cacheReadTokens + cacheWriteTokens;
  const cacheHitPct = cacheEligibleTokens > 0 ? Math.round((cacheReadTokens / cacheEligibleTokens) * 100) : 0;

  const extensionStatuses = Array.from(footerData?.getExtensionStatuses?.() ?? new Map<string, string>())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, text]) => ({ key, text }));
  const model = selectedModel;

  return {
    version: 1,
    terminal: { width },
    context: { tokens: contextTokens, contextWindow, percent: contextPercent },
    usage: {
      input: inputTokens,
      output: outputTokens,
      cacheRead: cacheReadTokens,
      cacheWrite: cacheWriteTokens,
      totalTokens,
      cacheHitPercent: cacheHitPct,
      cost,
    },
    model: model ? {
      id: model.id ?? "",
      name: model.name ?? model.id ?? "",
      provider: model.provider ?? "",
      reasoning: Boolean(model.reasoning),
      contextWindow: Number(model.contextWindow) || 0,
      maxTokens: Number(model.maxTokens) || 0,
    } : prior.model,
    thinkingLevel: selectedThinkingLevel ?? null,
    session: {
      id: ctx?.sessionManager?.getSessionId?.() ?? prior.session.id,
      name: ctx?.sessionManager?.getSessionName?.() ?? prior.session.name,
      cwd: ctx?.cwd || prior.session.cwd,
    },
    git: { branch, status },
    extensionStatuses,
    time,
  };
}

function shouldRefreshGitState(event: any): boolean {
  return event?.type === "turn_end" || event?.type === "session_start";
}

function execSyncSafe(command: string, args: string[], ctx: any): string {
  try {
    const result = spawnSync(command, args, {
      cwd: ctx?.cwd || process.cwd(),
      encoding: "utf-8",
      timeout: 1000,
    });
    return result.stdout?.trim() ?? "";
  } catch {
    // ignore
  }
  return "";
}

const MAX_OSC52_ENCODED_LENGTH = 100_000;

function runClipboardCommand(command: string, args: string[], text: string): boolean {
  const result = spawnSync(command, args, {
    input: text,
    timeout: 5000,
    stdio: ["pipe", "ignore", "ignore"],
  });
  return !result.error && result.status === 0;
}

function emitOsc52(text: string): boolean {
  const encoded = Buffer.from(text).toString("base64");
  if (encoded.length > MAX_OSC52_ENCODED_LENGTH) return false;
  process.stdout.write(`\x1b]52;c;${encoded}\x07`);
  return true;
}

function copyToSystemClipboard(text: string): boolean {
  const currentPlatform = platform();
  const remote = Boolean(process.env.SSH_CONNECTION || process.env.SSH_CLIENT || process.env.MOSH_CONNECTION);
  let copied = false;

  if (currentPlatform === "darwin") {
    copied = runClipboardCommand("pbcopy", [], text);
  } else if (currentPlatform === "win32") {
    copied = runClipboardCommand("clip", [], text);
  } else if (currentPlatform === "linux") {
    if (process.env.TERMUX_VERSION) {
      copied = runClipboardCommand("termux-clipboard-set", [], text);
    }

    if (!copied && process.env.WAYLAND_DISPLAY) {
      const available = spawnSync("which", ["wl-copy"], { stdio: "ignore" });
      if (!available.error && available.status === 0) {
        const child = spawn("wl-copy", [], { stdio: ["pipe", "ignore", "ignore"] });
        child.on("error", () => {});
        child.stdin?.on("error", () => {});
        child.stdin?.end(text);
        child.unref();
        copied = true;
      }
    }

    if (!copied && process.env.DISPLAY) {
      copied = runClipboardCommand("xclip", ["-selection", "clipboard"], text)
        || runClipboardCommand("xsel", ["--clipboard", "--input"], text);
    }
  }

  if (remote || !copied) {
    copied = emitOsc52(text) || copied;
  }
  return copied;
}

export function copyTextToClipboard(ctx: any, text: string): void {
  try {
    if (!copyToSystemClipboard(text)) {
      throw new Error("no supported clipboard transport is available");
    }
    ctx?.ui?.notify?.("Copied selection to clipboard", "info");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx?.ui?.notify?.(`Failed to copy selection: ${message}`, "error");
  }
}

function splitOutputLines(text: string): string[] {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

function trimLeadingBlankLines(lines: string[]): string[] {
  let start = 0;
  while (start < lines.length && lines[start].trim() === "") {
    start += 1;
  }
  return lines.slice(start);
}

function trimTrailingBlankLines(lines: string[]): string[] {
  let end = lines.length;
  while (end > 0 && lines[end - 1].trim() === "") {
    end -= 1;
  }
  return lines.slice(0, end);
}

function renderHiddenGroup(compositor: TerminalSplitCompositor | null, renderables: any[], width: number): string[] {
  if (!compositor || renderables.length === 0) return [];
  return renderables.flatMap((renderable) => {
    if (!renderable?.render) return [];
    return compositor.renderHidden(renderable, width);
  });
}

function formatBracketedBlock(lines: string[]): string[] {
  const content = lines.length > 0 ? lines : [""];
  return content.map((line, index) => {
    const prefix = index === 0 ? "「" : "";
    const suffix = index === content.length - 1 ? "」" : "";
    return `${prefix}${line}${suffix}`;
  });
}

function formatConfigErrors(errors: ConfigError[]): string[] {
  return formatBracketedBlock(errors.map((error) => error.message));
}

// ============================================================================
// Script executor
// ============================================================================

export interface StatusScriptError {
  summary: string;
  path?: string;
  details?: string[];
}

export interface ScriptResult {
  output: string;
  error: StatusScriptError | null;
}

function formatStatusScriptError(error: StatusScriptError): string[] {
  const lines = [error.summary];
  if (error.path) {
    lines.push("");
    lines.push(error.path);
  }
  if (error.details && error.details.length > 0) {
    lines.push("");
    lines.push(...error.details);
  }
  return formatBracketedBlock(lines);
}

export function spawnStatusScript(scriptPath: string, input: StatusScriptInput, cwd: string, abortSignal?: AbortSignal, configPath?: string): Promise<ScriptResult> {
  return new Promise((resolve) => {
    const resolvedPath = resolveStatusScriptPath(scriptPath, configPath);

    if (!existsSync(resolvedPath)) {
      resolve({ output: "", error: { summary: "statusScript not found", path: resolvedPath } });
      return;
    }

    const proc = spawn(resolvedPath, [], {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 200,
      signal: abortSignal,
    });

    proc.stdin?.on("error", () => {});
    proc.stdin?.end(`${JSON.stringify(input)}\n`);

    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on("error", (err: Error) => {
      resolve({
        output: "",
        error: {
          summary: "statusScript failed to start",
          path: resolvedPath,
          details: [err.message],
        },
      });
    });

    proc.on("close", (code) => {
      const details = trimTrailingBlankLines(splitOutputLines(stderr || stdout));
      if (code === 0) {
        resolve({ output: stdout, error: null });
      } else if (code === null || code === undefined) {
        resolve({
          output: "",
          error: {
            summary: "statusScript timed out",
            path: resolvedPath,
            details,
          },
        });
      } else {
        resolve({
          output: "",
          error: {
            summary: `statusScript exited with code ${code}`,
            path: resolvedPath,
            details,
          },
        });
      }
    });
  });
}

function isPlainBlank(line: string): boolean {
  return !/\S/.test(line);
}

function stripPlainBlankEdges(lines: readonly string[]): readonly string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && isPlainBlank(lines[start]!)) start += 1;
  while (end > start && isPlainBlank(lines[end - 1]!)) end -= 1;
  return start === 0 && end === lines.length ? lines : lines.slice(start, end);
}

function findChatContainer(tui: any): { container: any; rootChild: any } | null {
  const visit = (component: any, rootChild: any): { container: any; rootChild: any } | null => {
    const className = component?.constructor?.name || "";
    if (className.includes("chat") || className.includes("Chat")) {
      return { container: component, rootChild };
    }

    const children = Array.isArray(component?.children) ? component.children : [];
    for (const child of children) {
      const match = visit(child, rootChild);
      if (match) return match;
    }
    return null;
  };

  const children = Array.isArray(tui?.children) ? tui.children : [];
  for (const child of children) {
    const match = visit(child, child);
    if (match) return match;
  }
  return null;
}

interface FixedLayoutMatch {
  conversationEndIndexExclusive: number;
  statusContainers: any[];
  aboveWidgetContainers: any[];
  editorContainer: any;
  footerContainer: any | null;
  editor: any;
}

export function scanChatTargets(
  tui: any,
  compositor?: Pick<TerminalSplitCompositor, "getRootChildLineOffset"> | null,
): { userLines: number[], assistantLines: number[] } {
  const chatMatch = findChatContainer(tui);
  if (!chatMatch || !chatMatch.container?.children) {
    return { userLines: [], assistantLines: [] };
  }

  const { container: chatContainer, rootChild } = chatMatch;
  const userLines: number[] = [];
  const assistantLines: number[] = [];
  const width = Math.max(1, tui?.terminal?.columns || 80);
  let lineOffset = compositor?.getRootChildLineOffset(rootChild) ?? 0;
  let hasVisiblePriorBlock = false;

  for (const child of chatContainer.children) {
    if (!child?.render) continue;
    const lines = stripPlainBlankEdges(child.render(width));
    if (lines.length === 0) continue;

    if (hasVisiblePriorBlock) {
      lineOffset += 1;
    }

    const className = child.constructor?.name || "";
    if (className.includes("UserMessage")) {
      userLines.push(lineOffset);
    } else if (className.includes("AssistantMessage") || className.includes("LlmMessage")) {
      assistantLines.push(lineOffset);
    }

    lineOffset += lines.length;
    hasVisiblePriorBlock = true;
  }

  return { userLines, assistantLines };
}

// ============================================================================
// Extension
// ============================================================================

export default function piShmitline(pi: any): void {
  const BRIDGE_WIDGET_KEY = "pi-shmitline.bridge";
  let currentCompositor: TerminalSplitCompositor | null = null;
  let currentConfig: ShmitlineConfig = { ...DEFAULT_CONFIG };
  let startupConfigErrors: ConfigError[] = [];
  let showStartupConfigErrors = true;
  let currentScriptError: StatusScriptError | null = null;
  let currentStatusData: StatusScriptInput | null = null;
  let currentFooterLines: string[] = [];
  let useDefaultFooter = true;
  let lastScriptInvocation = 0;
  let pendingScript: Promise<ScriptResult> | null = null;
  let scriptAbortController: AbortController | null = null;
  let currentInvocationId = 0;
  let configCwd = process.cwd();
  let statusScriptConfigPath: string = "";
  let uiRef: any = null;
  let tuiRef: any = null;
  let compositorTuiRef: any = null;
  let sessionUiActive = false;
  let statusContainers: any[] = [];
  let aboveWidgetContainers: any[] = [];
  let editorContainer: any = null;
  let footerContainer: any = null;
  let bridgeInstalled = false;
  let inputListenerDisposers: (() => void)[] = [];
  let activeCtx: any = null;
  let footerDataRef: FooterStatusData | null = null;
  let footerBridgeInstalled = false;
  let footerStatusSignature = "";
  let footerWidth = 80;
  let footerRefreshQueued = false;
  let branchChangeDisposer: (() => void) | null = null;

  function getThinkingLevel(): string | null {
    try {
      return pi.getThinkingLevel?.() ?? null;
    } catch {
      return null;
    }
  }

  function extensionStatusSignature(): string {
    return JSON.stringify(Array.from(footerDataRef?.getExtensionStatuses?.() ?? new Map<string, string>()).sort(([a], [b]) => a.localeCompare(b)));
  }

  function queueFooterDataRefresh(): void {
    if (footerRefreshQueued || !activeCtx || !currentConfig.statusScript) return;
    footerRefreshQueued = true;
    queueMicrotask(async () => {
      footerRefreshQueued = false;
      if (!activeCtx) return;
      currentStatusData = extractStatusData(activeCtx, [], currentStatusData, false, footerDataRef, getThinkingLevel());
      await spawnScriptIfNeeded(activeCtx, "footer_data");
    });
  }

  function observeExtensionStatuses(): void {
    const signature = extensionStatusSignature();
    if (signature === footerStatusSignature) return;
    footerStatusSignature = signature;
    queueFooterDataRefresh();
  }

  const statusFooterFactory = (footerTui: any, _theme: any, footerData: FooterStatusData) => {
    footerDataRef = footerData;
    footerWidth = footerTui?.terminal?.columns ?? footerWidth;
    footerStatusSignature = extensionStatusSignature();
    branchChangeDisposer?.();
    branchChangeDisposer = footerData.onBranchChange?.(() => {
      if (!activeCtx) return;
      currentStatusData = extractStatusData(activeCtx, [], currentStatusData, true, footerDataRef, getThinkingLevel());
      void spawnScriptIfNeeded(activeCtx, "footer_data");
    }) ?? null;
    return {
      render(width: number) {
        if (Number.isFinite(width) && width > 0 && width !== footerWidth) {
          footerWidth = width;
          queueFooterDataRefresh();
        }
        observeExtensionStatuses();
        return [];
      },
      invalidate() {},
    };
  };

  function setStatusFooterEnabled(enabled: boolean): void {
    if (!uiRef?.setFooter || footerBridgeInstalled === enabled) return;
    if (currentCompositor) {
      currentCompositor.dispose();
      currentCompositor = null;
      compositorTuiRef = null;
    }
    uiRef.setFooter(enabled ? statusFooterFactory : undefined);
    footerBridgeInstalled = enabled;
    maybeInstallCompositor(true);
  }

  const bridgeWidgetFactory = (tui: any) => {
    tuiRef = tui;
    maybeInstallCompositor();
    return {
      dispose() {
        if (currentCompositor && compositorTuiRef === tui) {
          currentCompositor.dispose();
          currentCompositor = null;
          compositorTuiRef = null;
          disposeShortcutListeners();
        }
        if (tuiRef === tui) {
          tuiRef = null;
        }
        bridgeInstalled = false;
      },
      invalidate() {
        tuiRef?.requestRender?.(true);
      },
      render() {
        return [];
      },
    };
  };

  function maybeInstallCompositor(force: boolean = false): void {
    if (!sessionUiActive || !tuiRef) return;
    if (!force && currentCompositor && compositorTuiRef === tuiRef) return;
    installCompositor(tuiRef);
  }

  function getActiveErrorLines(): string[] | undefined {
    if (showStartupConfigErrors && startupConfigErrors.length > 0) {
      return formatConfigErrors(startupConfigErrors);
    }
    if (currentScriptError) {
      return formatStatusScriptError(currentScriptError);
    }
    return undefined;
  }

  function clearStartupConfigErrors(): void {
    if (!showStartupConfigErrors) return;
    showStartupConfigErrors = false;
    tuiRef?.requestRender?.(true);
  }

  function ensureWidgetBridge(): void {
    if (bridgeInstalled || !uiRef?.setWidget) return;
    uiRef.setWidget(BRIDGE_WIDGET_KEY, bridgeWidgetFactory, { placement: "aboveEditor" });
    bridgeInstalled = true;
  }

  function clearWidgets(): void {
    if (!uiRef?.setWidget) return;
    if (bridgeInstalled) {
      uiRef.setWidget(BRIDGE_WIDGET_KEY, undefined);
      bridgeInstalled = false;
    }
  }

  function reloadConfig(cwd: string): void {
    installDefaultsIfAbsent("global", cwd);
    installDefaultsIfAbsent("project", cwd);

    const globalConfig = loadConfig("global", cwd);
    const projectConfig = loadConfig("project", cwd);
    currentConfig = mergeConfigLayers(globalConfig, projectConfig);
    statusScriptConfigPath = projectConfig.statusScript !== undefined ? projectConfig._configPath : (globalConfig._configPath || "");
    configDirForScript = cwd;
    startupConfigErrors = validateConfig(currentConfig, statusScriptConfigPath);
  }

  reloadConfig(configCwd);

  const defaultStatusData: StatusScriptInput = {
    version: 1,
    terminal: { width: 80 },
    context: { tokens: null, contextWindow: 0, percent: null },
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cacheHitPercent: 0, cost: 0 },
    model: null,
    thinkingLevel: null,
    session: { id: "", name: null, cwd: configCwd },
    git: { branch: null, status: "" },
    extensionStatuses: [],
    time: "",
  };

  const handleSessionBootstrap = async (event: any, ctx: any) => {
    if (!ctx?.hasUI) return;

    sessionUiActive = true;
    activeCtx = ctx;
    uiRef = ctx.ui ?? uiRef;
    configCwd = ctx.cwd || process.cwd();
    reloadConfig(configCwd);
    showStartupConfigErrors = startupConfigErrors.length > 0;
    currentScriptError = null;
    currentFooterLines = [];
    useDefaultFooter = true;
    const scriptConfigured = Boolean(currentConfig.statusScript)
      && !startupConfigErrors.some((error) => error.field === "statusScript");
    setStatusFooterEnabled(scriptConfigured);
    ensureWidgetBridge();

    currentStatusData = extractStatusData(ctx, [event], currentStatusData, true, footerDataRef, getThinkingLevel());
    footerStatusSignature = extensionStatusSignature();
    maybeInstallCompositor();

    await spawnScriptIfNeeded(ctx, event?.type);
  };

  const handleRuntimeUpdate = async (event: any, ctx: any) => {
    if (!ctx?.hasUI) return;

    activeCtx = ctx;
    uiRef = ctx.ui ?? uiRef;
    currentStatusData = extractStatusData(ctx, [event], currentStatusData, shouldRefreshGitState(event), footerDataRef, getThinkingLevel());
    footerStatusSignature = extensionStatusSignature();
    await spawnScriptIfNeeded(ctx, event?.type);
  };

  const handleBeforeAgentStart = (event: any, ctx: any) => {
    if (!ctx?.hasUI || !showStartupConfigErrors) return;
    const hasText = typeof event?.prompt === "string" && event.prompt.length > 0;
    const hasImages = Array.isArray(event?.images) && event.images.length > 0;
    if (!hasText && !hasImages) return;
    clearStartupConfigErrors();
  };

  pi.on("session_start", handleSessionBootstrap);
  pi.on("session", handleSessionBootstrap);
  pi.on("before_agent_start", handleBeforeAgentStart);
  pi.on("turn_end", handleRuntimeUpdate);
  pi.on("model_select", handleRuntimeUpdate);
  pi.on("thinking_level_select", handleRuntimeUpdate);
  // Compatibility with older Pi event names.
  pi.on("model_change", handleRuntimeUpdate);
  pi.on("thinking_level_change", handleRuntimeUpdate);

  pi.on("session_shutdown", async () => {
    if (currentCompositor) {
      currentCompositor.dispose();
      currentCompositor = null;
      compositorTuiRef = null;
    }
    disposeShortcutListeners();
    if (pendingScript) {
      scriptAbortController?.abort();
      pendingScript = null;
    }
    currentScriptError = null;
    currentFooterLines = [];
    useDefaultFooter = true;
    showStartupConfigErrors = false;
    sessionUiActive = false;
    clearWidgets();
    branchChangeDisposer?.();
    branchChangeDisposer = null;
    if (footerBridgeInstalled) {
      uiRef?.setFooter?.(undefined);
      footerBridgeInstalled = false;
    }
    footerDataRef = null;
    footerStatusSignature = "";
    activeCtx = null;
    uiRef = null;
  });

  function installCompositor(tui: any): void {
    if (currentCompositor) {
      currentCompositor.dispose();
      compositorTuiRef = null;
    }
    disposeShortcutListeners();

    if (!tui) {
      console.warn("[pi-shmitline] No TUI available");
      return;
    }

    const terminal = tui.terminal || tui;
    if (!terminal?.write) {
      console.warn("[pi-shmitline] No terminal.write available");
      return;
    }

    const match = resolveFixedLayout(tui);
    if (!match) {
      console.warn("[pi-shmitline] Editor container not found");
      return;
    }
    statusContainers = match.statusContainers;
    aboveWidgetContainers = match.aboveWidgetContainers;
    editorContainer = match.editorContainer;
    footerContainer = match.footerContainer;

    const renderCluster = (width: number, terminalRows: number) => {
      observeExtensionStatuses();
      const statusLines = trimLeadingBlankLines(renderHiddenGroup(currentCompositor, statusContainers, width));
      const errorLines = getActiveErrorLines();
      const aboveWidgetLines = trimLeadingBlankLines(renderHiddenGroup(currentCompositor, aboveWidgetContainers, width));
      const editorLines = currentCompositor && editorContainer
        ? currentCompositor.renderHidden(editorContainer, width)
        : [];
      const footerLines = useDefaultFooter
        && currentCompositor
        && footerContainer?.render
        ? trimTrailingBlankLines(currentCompositor.renderHidden(footerContainer, width))
        : currentFooterLines;

      const input: FixedEditorClusterInput = {
        width,
        terminalRows,
        statusLines,
        errorLines,
        aboveWidgetLines,
        editorLines,
        footerLines,
      };

      return renderFixedEditorCluster(input);
    };

    currentCompositor = new TerminalSplitCompositor({
      tui,
      terminal,
      renderCluster,
      mouseScroll: currentConfig.mouseScroll,
      onCopySelection: (text) => {
        copyTextToClipboard({ ui: uiRef }, text);
      },
    });

    for (const renderable of statusContainers) {
      if (renderable?.render) currentCompositor.hideRenderable(renderable);
    }
    for (const renderable of aboveWidgetContainers) {
      if (renderable?.render) currentCompositor.hideRenderable(renderable);
    }
    currentCompositor.hideRenderable(editorContainer);
    if (footerContainer?.render) {
      currentCompositor.hideRenderable(footerContainer);
    }
    currentCompositor.mountScrollableRoot(match.conversationEndIndexExclusive);
    currentCompositor.install();
    compositorTuiRef = tui;

    // Invalid shortcut config is a hard-disable for listener registration.
    if (!startupConfigErrors.some((error) => error.field.startsWith("shortcuts."))) {
      wireShortcuts(currentCompositor, currentConfig.shortcuts, tui);
    }
    tui.requestRender?.(true);
  }

  function resolveFixedLayout(tui: any): FixedLayoutMatch | null {
    const children = Array.isArray(tui?.children) ? tui.children : [];
    const isEditorLike = (component: any): boolean => {
      return typeof component?.render === "function"
        && typeof component?.getText === "function"
        && typeof component?.handleInput === "function";
    };
    if (children.length === 0) return null;

    const footerIndex = children.length - 1;
    const footerContainer = children[footerIndex] ?? null;
    const editorIndexLimit = footerIndex - 1;
    if (editorIndexLimit < 0) return null;

    let editorIndex = -1;
    let editor: any = null;

    for (let i = editorIndexLimit; i >= 0; i -= 1) {
      const child = children[i];
      const grandchildren = Array.isArray(child?.children) ? child.children : [];
      const match = grandchildren.find(isEditorLike);
      if (match) {
        editorIndex = i;
        editor = match;
        break;
      }
    }

    if (editorIndex === -1 || !editor) {
      return null;
    }

    const fixedStartIndex = Math.max(0, editorIndex - 2);
    const fixedBeforeEditor = children.slice(fixedStartIndex, editorIndex);
    const statusContainers = fixedBeforeEditor.length > 0 ? [fixedBeforeEditor[0]] : [];
    const aboveWidgetContainers = fixedBeforeEditor.slice(1);

    return {
      conversationEndIndexExclusive: fixedStartIndex,
      statusContainers,
      aboveWidgetContainers,
      editorContainer: children[editorIndex],
      footerContainer,
      editor,
    };
  }

  function wireShortcuts(compositor: TerminalSplitCompositor, shortcuts: ShortcutConfig, tui: any): void {
    // Clear old listeners
    disposeShortcutListeners();

    // Re-scan targets on each call to avoid stale snapshots
    const scanTargets = () => scanChatTargets(tui, compositor);

    if (shortcuts.jumpPreviousUserMessage) {
      const handler = () => compositor.jumpToPreviousRootTarget(scanTargets().userLines);
      const keys = Array.isArray(shortcuts.jumpPreviousUserMessage) ? shortcuts.jumpPreviousUserMessage : [shortcuts.jumpPreviousUserMessage];
      for (const key of keys) {
        const disposer = registerShortcutListener(tui, key, handler);
        if (disposer) inputListenerDisposers.push(disposer);
      }
    }

    if (shortcuts.jumpNextUserMessage) {
      const handler = () => compositor.jumpToNextRootTarget(scanTargets().userLines);
      const keys = Array.isArray(shortcuts.jumpNextUserMessage) ? shortcuts.jumpNextUserMessage : [shortcuts.jumpNextUserMessage];
      for (const key of keys) {
        const disposer = registerShortcutListener(tui, key, handler);
        if (disposer) inputListenerDisposers.push(disposer);
      }
    }

    if (shortcuts.jumpPreviousLlmMessage) {
      const handler = () => compositor.jumpToPreviousRootTarget(scanTargets().assistantLines);
      const keys = Array.isArray(shortcuts.jumpPreviousLlmMessage) ? shortcuts.jumpPreviousLlmMessage : [shortcuts.jumpPreviousLlmMessage];
      for (const key of keys) {
        const disposer = registerShortcutListener(tui, key, handler);
        if (disposer) inputListenerDisposers.push(disposer);
      }
    }

    if (shortcuts.jumpNextLlmMessage) {
      const handler = () => compositor.jumpToNextRootTarget(scanTargets().assistantLines);
      const keys = Array.isArray(shortcuts.jumpNextLlmMessage) ? shortcuts.jumpNextLlmMessage : [shortcuts.jumpNextLlmMessage];
      for (const key of keys) {
        const disposer = registerShortcutListener(tui, key, handler);
        if (disposer) inputListenerDisposers.push(disposer);
      }
    }

    if (shortcuts.jumpChatBottom) {
      const handler = () => compositor.jumpToRootBottom();
      const keys = Array.isArray(shortcuts.jumpChatBottom) ? shortcuts.jumpChatBottom : [shortcuts.jumpChatBottom];
      for (const key of keys) {
        const disposer = registerShortcutListener(tui, key, handler);
        if (disposer) inputListenerDisposers.push(disposer);
      }
    }
  }

  function registerShortcutListener(tui: any, key: string, handler: () => void): (() => void) | null {
    if (typeof tui.addInputListener !== "function") {
      return null;
    }

    const listener = (data: string) => {
      if (matchAnyShortcut(data, key)) {
        handler();
        return { consume: true };
      }
      return null;
    };

    try {
      const result = tui.addInputListener(listener);
      if (typeof result === "function") {
        return result;
      }
    } catch {
      // ignore
    }
    return null;
  }

  function disposeShortcutListeners(): void {
    for (const disposer of inputListenerDisposers) {
      try {
        disposer();
      } catch {
        // ignore
      }
    }
    inputListenerDisposers = [];
  }

  async function spawnScriptIfNeeded(ctx: any, triggerType?: string): Promise<void> {
    if (!currentConfig.statusScript) {
      currentScriptError = null;
      currentFooterLines = [];
      useDefaultFooter = true;
      setStatusFooterEnabled(false);
      if (currentCompositor && tuiRef) {
        tuiRef.requestRender(true);
      }
      return;
    }

    if (startupConfigErrors.some((error) => error.field === "statusScript")) {
      currentScriptError = null;
      currentFooterLines = [];
      useDefaultFooter = true;
      setStatusFooterEnabled(false);
      if (currentCompositor && tuiRef) {
        tuiRef.requestRender(true);
      }
      return;
    }

    const now = Date.now();
    if (triggerType === "turn_end" && lastScriptInvocation > 0 && now - lastScriptInvocation < 5000) {
      return;
    }

    // Abort previous script
    if (pendingScript) {
      scriptAbortController?.abort();
    }

    if (triggerType === "turn_end") {
      lastScriptInvocation = now;
    }
    scriptAbortController = new AbortController();
    const thisInvocationId = ++currentInvocationId;

    pendingScript = spawnStatusScript(
      currentConfig.statusScript,
      {
        ...(currentStatusData || defaultStatusData),
        terminal: {
          width: tuiRef?.terminal?.columns ?? footerWidth,
        },
      },
      configCwd,
      scriptAbortController?.signal,
      statusScriptConfigPath,
    );

    try {
      const result = await pendingScript;
      pendingScript = null;

      // Check if this is still the current invocation
      if (thisInvocationId !== currentInvocationId) {
        return; // Stale result, ignore
      }

      if (result.error) {
        currentScriptError = result.error;
        currentFooterLines = [];
        useDefaultFooter = true;
        setStatusFooterEnabled(false);
      } else {
        currentScriptError = null;
        currentFooterLines = trimTrailingBlankLines(splitOutputLines(result.output));
        useDefaultFooter = false;
        setStatusFooterEnabled(true);
      }

      if (currentCompositor && tuiRef) {
        tuiRef.requestRender(true);
      }
    } catch (err) {
      pendingScript = null;
      console.error("[pi-shmitline] Script execution error:", err);
    }
  }
}
