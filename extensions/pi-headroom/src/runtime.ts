import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildManagedProxyArgs,
  buildMcpArgs,
  buildStateEnv,
  deriveUpstreamProfile,
  hasErrors,
  mergeConfigLayers,
  mergeHarnessMetadata,
  resolveProxyUrl,
  validateConfig,
  verifyCredential,
  type ConfigIssue,
  type DerivedUpstreamProfile,
  type HarnessMetadata,
  type HeadroomConfig,
} from "./config.ts";

const CONFIG_FILENAME = "headroom.json";
const JSON_RPC_VERSION = "2.0";

export interface LoadedConfig {
  config: HeadroomConfig;
  issues: ConfigIssue[];
  paths: {
    user: string;
    project: string;
  };
}

export interface HealthResult {
  ok: boolean;
  status?: number;
  message: string;
}

export interface RuntimeState {
  config: HeadroomConfig | null;
  proxyUrl: string | null;
  profile: DerivedUpstreamProfile | null;
  metadata: HarnessMetadata | null;
  proxyProcess: ChildProcessWithoutNullStreams | null;
  mcp: McpStdioClient | null;
  registeredProvider: string | null;
  lastError: string | null;
}

export function resolveConfigPath(scope: "user" | "project", cwd: string): string {
  if (scope === "user") {
    return join(process.env.HOME || "/", ".pi", "agent", CONFIG_FILENAME);
  }
  return join(cwd, ".pi", CONFIG_FILENAME);
}

export function readJsonIfPresent(path: string): unknown {
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, "utf8"));
}

export function loadHeadroomConfig(cwd: string): LoadedConfig {
  const paths = {
    user: resolveConfigPath("user", cwd),
    project: resolveConfigPath("project", cwd),
  };
  const parsedUser = readConfigLayer(paths.user, "user");
  const parsedProject = readConfigLayer(paths.project, "project");
  const user = parsedUser.value;
  const project = parsedProject.value;
  const config = mergeConfigLayers(user, project);
  return {
    config,
    issues: [...parsedUser.issues, ...parsedProject.issues, ...validateConfig(config, [user, project])],
    paths,
  };
}

function readConfigLayer(path: string, scope: "user" | "project"): { value: unknown; issues: ConfigIssue[] } {
  try {
    return { value: readJsonIfPresent(path), issues: [] };
  } catch (error) {
    return {
      value: {},
      issues: [{ severity: "error", field: `config.${scope}`, message: `invalid JSON: ${shortError(error)}` }],
    };
  }
}

export function resolveHeadroomBinary(command: string): { ok: true; version: string } | { ok: false; message: string } {
  const result = spawnSync(command, ["--version"], { encoding: "utf8" });
  if (result.error) {
    return { ok: false, message: `headroom: command not found: ${command}` };
  }
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || `exit ${result.status ?? "unknown"}`).trim();
    return { ok: false, message: `headroom: version check failed: ${detail}` };
  }
  return { ok: true, version: (result.stdout || result.stderr || "").trim() };
}

export async function checkHeadroomHealth(proxyUrl: string, healthPath: string, timeoutMs = 1500): Promise<HealthResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(new URL(healthPath, proxyUrl), { signal: controller.signal });
    const text = await response.text().catch(() => "");
    const server = response.headers.get("server") ?? "";
    const contentType = response.headers.get("content-type") ?? "";
    const headroomSpecific = /headroom/i.test(`${server}\n${contentType}\n${text}`);
    if (response.ok && headroomSpecific) {
      return { ok: true, status: response.status, message: "headroom: proxy healthy" };
    }
    return {
      ok: false,
      status: response.status,
      message: response.ok ? "headroom: health endpoint did not identify Headroom" : `headroom: health HTTP ${response.status}`,
    };
  } catch (error) {
    return { ok: false, message: `headroom: health check failed: ${shortError(error)}` };
  } finally {
    clearTimeout(timer);
  }
}

export function metadataFromContext(ctx: any): HarnessMetadata {
  const model = ctx?.model ?? {};
  const sessionManager = ctx?.sessionManager ?? {};
  return {
    providerName: model.provider,
    providerFamily: model.api ?? model.compat?.api,
    providerBaseUrl: model.baseUrl,
    modelId: model.id,
    modelName: model.name,
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    thinkingLevel: ctx?.thinkingLevel ?? ctx?.getThinkingLevel?.(),
    sessionId: sessionManager.getSessionId?.() ?? sessionManager.sessionId,
    sessionName: sessionManager.getSessionName?.() ?? sessionManager.name,
    cwd: ctx?.cwd,
  };
}

export function metadataFromModelEvent(model: any): HarnessMetadata {
  return {
    providerName: model?.provider,
    providerFamily: model?.api ?? model?.compat?.api,
    providerBaseUrl: model?.baseUrl,
    modelId: model?.id,
    modelName: model?.name,
    contextWindow: model?.contextWindow,
    maxTokens: model?.maxTokens,
  };
}

export function proxyEnvironment(config: HeadroomConfig): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...buildStateEnv(config),
    ...config.proxy.env,
  };
}

export class HeadroomRuntime {
  private state: RuntimeState = {
    config: null,
    proxyUrl: null,
    profile: null,
    metadata: null,
    proxyProcess: null,
    mcp: null,
    registeredProvider: null,
    lastError: null,
  };

  getState(): Readonly<RuntimeState> {
    return this.state;
  }

  async start(ctx: any, pi: any): Promise<void> {
    // session_start also fires for reload/resume; never replace owned children or a route in place.
    await this.stop(pi);
    const loaded = loadHeadroomConfig(ctx.cwd ?? process.cwd());
    this.state.config = loaded.config;
    this.setStatus(ctx, loaded.config, loaded.config.enabled ? "starting" : "disabled");

    const errors = loaded.issues.filter((issue) => issue.severity === "error");
    if (errors.length > 0) {
      this.fail(ctx, loaded.config, `${errors[0].field}: ${errors[0].message}`);
      return;
    }
    for (const warning of loaded.issues.filter((issue) => issue.severity === "warning")) {
      ctx.ui?.notify?.(`headroom config warning: ${warning.field}: ${warning.message}`, "warning");
    }
    if (!loaded.config.enabled) {
      await this.stop(pi);
      this.setStatus(ctx, loaded.config, "disabled");
      return;
    }

    const binary = resolveHeadroomBinary(loaded.config.headroomCommand);
    if (!binary.ok) {
      this.fail(ctx, loaded.config, binary.message);
      return;
    }

    const nextMetadata = mergeHarnessMetadata(this.state.metadata, metadataFromContext(ctx));
    this.state.metadata = nextMetadata;
    const profile = deriveUpstreamProfile(loaded.config, nextMetadata);
    const credential = verifyCredential(profile, process.env);
    if (!credential.ok) {
      this.fail(ctx, loaded.config, credential.message ?? "credential unavailable");
      return;
    }

    const proxyUrl = resolveProxyUrl(loaded.config);
    this.state.profile = profile;
    this.state.proxyUrl = proxyUrl;

    if (proxyUrl && loaded.config.proxy.mode === "managed") {
      this.setStatus(ctx, loaded.config, "proxy starting");
      const existing = await checkHeadroomHealth(proxyUrl, loaded.config.proxy.healthPath);
      if (!existing.ok) {
        const proxyProcess = spawn(loaded.config.headroomCommand, buildManagedProxyArgs(loaded.config, profile), {
          env: proxyEnvironment(loaded.config),
          stdio: "pipe",
        });
        // The proxy is not an RPC child; drain its output so verbose logs cannot block it.
        proxyProcess.stdout.on("data", () => undefined);
        proxyProcess.stderr.on("data", () => undefined);
        this.state.proxyProcess = proxyProcess;
        proxyProcess.once("exit", (code, signal) => {
          if (this.state.proxyProcess !== proxyProcess) return;
          this.state.proxyProcess = null;
          this.clearProviderRoute(pi);
          this.fail(ctx, loaded.config, `proxy exited ${signal ?? code ?? "unknown"}`);
        });
        const health = await waitForHealth(proxyUrl, loaded.config.proxy.healthPath, loaded.config.proxy.startupTimeoutMs);
        if (!health.ok) {
          await this.stop(pi);
          this.fail(ctx, loaded.config, health.message);
          return;
        }
      }
    } else if (proxyUrl && loaded.config.proxy.mode === "external") {
      const health = await checkHeadroomHealth(proxyUrl, loaded.config.proxy.healthPath);
      if (!health.ok) {
        this.fail(ctx, loaded.config, health.message);
        return;
      }
    }

    this.applyProviderRoute(pi, loaded.config, profile, proxyUrl);

    if (proxyUrl && loaded.config.mcp.enabled) {
      let bridgeReady = false;
      const mcp = new McpStdioClient(
        loaded.config.headroomCommand,
        buildMcpArgs(proxyUrl),
        proxyEnvironment(loaded.config),
        () => {
          if (this.state.mcp !== mcp) return;
          this.state.mcp = null;
          if (bridgeReady) this.fail(ctx, loaded.config, "MCP bridge exited");
        },
      );
      this.state.mcp = mcp;
      try {
        await mcp.start(loaded.config.mcp.startupTimeoutMs);
        bridgeReady = true;
      } catch (error) {
        if (this.state.mcp === mcp) {
          await mcp.stop();
          this.state.mcp = null;
        }
        this.fail(ctx, loaded.config, `MCP startup failed: ${shortError(error)}`);
        return;
      }
      this.setStatus(ctx, loaded.config, "proxy ok, mcp ok");
    } else {
      this.setStatus(ctx, loaded.config, proxyUrl ? "proxy ok" : "proxy disabled");
    }
    this.state.lastError = null;
  }

  async refreshRoute(ctx: any, pi: any, metadata: HarnessMetadata): Promise<void> {
    if (!this.state.config?.enabled) return;
    this.state.metadata = mergeHarnessMetadata(this.state.metadata, metadata);
    const profile = deriveUpstreamProfile(this.state.config, this.state.metadata);
    const credential = verifyCredential(profile, process.env);
    if (!credential.ok) {
      this.clearProviderRoute(pi);
      this.fail(ctx, this.state.config, credential.message ?? "credential unavailable");
      return;
    }
    this.state.profile = profile;
    this.applyProviderRoute(pi, this.state.config, profile, this.state.proxyUrl);
    this.state.lastError = null;
  }

  async stop(pi?: any): Promise<void> {
    this.clearProviderRoute(pi);
    await this.state.mcp?.stop();
    this.state.mcp = null;
    await stopProcess(this.state.proxyProcess, this.state.config?.proxy.shutdownTimeoutMs ?? 3000);
    this.state.proxyProcess = null;
  }

  async callMcpTool(name: string, args: unknown): Promise<unknown> {
    if (!this.state.mcp) {
      throw new Error("headroom MCP bridge is not running");
    }
    return this.state.mcp.callTool(name, args);
  }

  private applyProviderRoute(pi: any, config: HeadroomConfig, profile: DerivedUpstreamProfile, proxyUrl: string | null): void {
    if (!proxyUrl || config.proxy.mode === "disabled" || !profile.piProvider || !pi?.registerProvider) return;
    if (this.state.registeredProvider && this.state.registeredProvider !== profile.piProvider && pi?.unregisterProvider) {
      pi.unregisterProvider(this.state.registeredProvider);
    }
    const headers: Record<string, string> = {};
    if (config.routing.sessionHeader && this.state.metadata?.sessionId) {
      headers["x-headroom-session-id"] = this.state.metadata.sessionId;
    }
    if (profile.baseUrl) {
      headers[config.routing.upstreamHeader] = profile.baseUrl;
    }
    pi.registerProvider(profile.piProvider, {
      baseUrl: proxyUrl,
      headers,
    });
    this.state.registeredProvider = profile.piProvider;
  }

  private clearProviderRoute(pi?: any): void {
    if (this.state.registeredProvider && pi?.unregisterProvider) {
      pi.unregisterProvider(this.state.registeredProvider);
    }
    this.state.registeredProvider = null;
  }

  private setStatus(ctx: any, config: HeadroomConfig, text: string): void {
    ctx.ui?.setStatus?.(config.ui.statusKey, `headroom: ${text}`);
  }

  private fail(ctx: any, config: HeadroomConfig, reason: string): void {
    this.state.lastError = reason;
    this.setStatus(ctx, config, `error: ${truncate(reason, 80)}`);
    ctx.ui?.notify?.(`headroom: ${reason}`, "error");
  }
}

export class McpStdioClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private buffer = "";
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();

  constructor(
    private readonly command: string,
    private readonly args: string[],
    private readonly env: NodeJS.ProcessEnv,
    private readonly onUnexpectedExit?: () => void,
  ) {}

  async start(timeoutMs: number): Promise<void> {
    this.child = spawn(this.command, this.args, { env: this.env, stdio: "pipe" });
    this.child.stdout.on("data", (chunk) => this.onData(String(chunk)));
    this.child.stderr.on("data", () => undefined);
    this.child.once("exit", () => {
      this.rejectAll(new Error("headroom MCP bridge exited"));
      if (this.child) this.onUnexpectedExit?.();
    });
    await withTimeout(this.request("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "pi-headroom", version: "0.0.0" } }), timeoutMs);
    this.notify("notifications/initialized", {});
  }

  async callTool(name: string, args: unknown): Promise<unknown> {
    return this.request("tools/call", { name, arguments: args ?? {} });
  }

  async stop(): Promise<void> {
    const child = this.child;
    this.child = null;
    this.rejectAll(new Error("headroom MCP bridge stopped"));
    await stopProcess(child, 1000);
  }

  private request(method: string, params: unknown): Promise<unknown> {
    if (!this.child) throw new Error("MCP bridge is not running");
    const id = this.nextId++;
    const message = { jsonrpc: JSON_RPC_VERSION, id, method, params };
    const promise = new Promise<unknown>((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
    return promise;
  }

  private notify(method: string, params: unknown): void {
    this.child?.stdin.write(`${JSON.stringify({ jsonrpc: JSON_RPC_VERSION, method, params })}\n`);
  }

  private onData(data: string): void {
    this.buffer += data;
    for (;;) {
      const newline = this.buffer.indexOf("\n");
      if (newline < 0) break;
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      let message: any;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      if (typeof message.id !== "number") continue;
      const pending = this.pending.get(message.id);
      if (!pending) continue;
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(message.error.message ?? "MCP request failed"));
      } else {
        pending.resolve(message.result);
      }
    }
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}

export async function waitForHealth(proxyUrl: string, healthPath: string, timeoutMs: number): Promise<HealthResult> {
  const deadline = Date.now() + timeoutMs;
  let last: HealthResult = { ok: false, message: "headroom: health check did not run" };
  while (Date.now() < deadline) {
    last = await checkHeadroomHealth(proxyUrl, healthPath);
    if (last.ok) return last;
    await delay(150);
  }
  return last;
}

export async function stopProcess(child: ChildProcessWithoutNullStreams | null, timeoutMs: number): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    let finished = false;
    let escalationTimer: NodeJS.Timeout | undefined;
    let fallbackTimer: NodeJS.Timeout | undefined;
    const finish = () => {
      if (finished) return;
      finished = true;
      if (escalationTimer) clearTimeout(escalationTimer);
      if (fallbackTimer) clearTimeout(fallbackTimer);
      child.removeListener("exit", finish);
      resolve();
    };

    child.once("exit", finish);
    child.kill("SIGTERM");
    escalationTimer = setTimeout(() => {
      if (child.exitCode !== null || child.signalCode !== null) {
        finish();
        return;
      }
      child.kill("SIGKILL");
      // A broken child process should not block Pi shutdown forever.
      fallbackTimer = setTimeout(finish, Math.min(Math.max(timeoutMs, 1_000), 5_000));
    }, timeoutMs);
  });
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out")), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}...`;
}

function shortError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
