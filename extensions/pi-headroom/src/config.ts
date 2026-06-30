export type ProxyMode = "managed" | "external" | "disabled";
export type McpMode = "stdio";
export type IssueSeverity = "error" | "warning";

export interface ConfigIssue {
  severity: IssueSeverity;
  field: string;
  message: string;
}

export interface UpstreamOverride {
  backend?: string;
  baseUrl?: string;
  apiKeyEnv?: string;
}

export interface HeadroomConfig {
  enabled: boolean;
  headroomCommand: string;
  proxy: {
    mode: ProxyMode;
    url?: string;
    host: string;
    port: number;
    modeArg: "cache";
    env: Record<string, string>;
    healthPath: string;
    startupTimeoutMs: number;
    shutdownTimeoutMs: number;
  };
  mcp: {
    enabled: boolean;
    mode: McpMode;
    serverName: string;
    startupTimeoutMs: number;
  };
  routing: {
    autoDetect: boolean;
    defaultUpstream: string;
    upstreamOverrides: Record<string, UpstreamOverride>;
    sessionHeader: boolean;
    upstreamHeader: string;
  };
  state: {
    configDir: string;
    workspaceDir: string;
    stateless: boolean;
  };
  ui: {
    statusKey: string;
    showSavings: boolean;
    showProxyHealth: boolean;
  };
}

export interface HarnessMetadata {
  providerName?: string | null;
  providerFamily?: string | null;
  providerBaseUrl?: string | null;
  modelId?: string | null;
  modelName?: string | null;
  contextWindow?: number | null;
  maxTokens?: number | null;
  thinkingLevel?: string | null;
  sessionId?: string | null;
  sessionName?: string | null;
  cwd?: string | null;
}

export interface DerivedUpstreamProfile {
  name: string;
  piProvider: string;
  model: string;
  backend: string;
  baseUrl: string | null;
  apiKeyEnv: string | null;
}

export interface CredentialCheck {
  ok: boolean;
  apiKeyEnv: string | null;
  message?: string;
}

export const DEFAULT_CONFIG: HeadroomConfig = {
  enabled: true,
  headroomCommand: "headroom",
  proxy: {
    mode: "managed",
    host: "127.0.0.1",
    port: 8787,
    modeArg: "cache",
    env: {},
    healthPath: "/health",
    startupTimeoutMs: 10000,
    shutdownTimeoutMs: 3000,
  },
  mcp: {
    enabled: true,
    mode: "stdio",
    serverName: "headroom",
    startupTimeoutMs: 10000,
  },
  routing: {
    autoDetect: true,
    defaultUpstream: "",
    upstreamOverrides: {},
    sessionHeader: true,
    upstreamHeader: "x-headroom-base-url",
  },
  state: {
    configDir: "",
    workspaceDir: "",
    stateless: false,
  },
  ui: {
    statusKey: "headroom",
    showSavings: true,
    showProxyHealth: true,
  },
};

const TOP_LEVEL_KEYS = new Set(["enabled", "headroomCommand", "proxy", "mcp", "routing", "state", "ui"]);
const NESTED_KEYS: Record<string, Set<string>> = {
  proxy: new Set([
    "mode",
    "url",
    "host",
    "port",
    "modeArg",
    "env",
    "healthPath",
    "startupTimeoutMs",
    "shutdownTimeoutMs",
  ]),
  mcp: new Set(["enabled", "mode", "serverName", "startupTimeoutMs"]),
  routing: new Set(["autoDetect", "defaultUpstream", "upstreamOverrides", "sessionHeader", "upstreamHeader"]),
  state: new Set(["configDir", "workspaceDir", "stateless"]),
  ui: new Set(["statusKey", "showSavings", "showProxyHealth"]),
};

export function mergeConfigLayers(user: unknown, project: unknown): HeadroomConfig {
  return mergePartial(mergePartial(DEFAULT_CONFIG, asRecord(user)), asRecord(project)) as HeadroomConfig;
}

export function validateConfig(config: HeadroomConfig, rawLayers: unknown[] = []): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  const root = asRecord(config);
  const proxy = sectionOrDefault<HeadroomConfig["proxy"]>(root, "proxy", DEFAULT_CONFIG.proxy, issues);
  const mcp = sectionOrDefault<HeadroomConfig["mcp"]>(root, "mcp", DEFAULT_CONFIG.mcp, issues);
  const routing = sectionOrDefault<HeadroomConfig["routing"]>(root, "routing", DEFAULT_CONFIG.routing, issues);
  const state = sectionOrDefault<HeadroomConfig["state"]>(root, "state", DEFAULT_CONFIG.state, issues);

  for (const raw of [config, ...rawLayers]) {
    collectUnknownKeyIssues(raw, issues);
    collectDeferredFieldIssues(raw, issues);
  }

  if (![true, false].includes(root.enabled as boolean)) {
    issues.push(error("enabled", "must be boolean"));
  }
  if (typeof root.headroomCommand !== "string" || root.headroomCommand.trim() === "") {
    issues.push(error("headroomCommand", "must not be empty"));
  }

  if (!["managed", "external", "disabled"].includes(proxy.mode)) {
    issues.push(error("proxy.mode", "must be managed, external, or disabled"));
  }
  if (proxy.mode === "managed") {
    if (proxy.url !== undefined) {
      issues.push(error("proxy.url", "must not be configured in managed mode; it is derived from proxy.host and proxy.port"));
    }
    if (typeof proxy.host !== "string" || !isLoopbackBindHost(proxy.host)) {
      issues.push(error("proxy.host", "managed proxy host must be loopback"));
    }
  }
  if (proxy.mode === "external" && (typeof proxy.url !== "string" || proxy.url.trim() === "")) {
    issues.push(error("proxy.url", "is required in external mode"));
  }
  if (proxy.mode === "external" && typeof proxy.url === "string" && proxy.url !== proxy.url.trim()) {
    issues.push(error("proxy.url", "must not contain leading or trailing whitespace"));
  }
  if (proxy.mode === "external" && typeof proxy.url === "string" && proxy.url.trim() !== "" && !isHttpUrl(proxy.url)) {
    issues.push(error("proxy.url", "must be an http(s) URL"));
  }
  if (proxy.mode === "external" && typeof proxy.url === "string" && isHttpUrl(proxy.url) && !isLoopbackUrl(proxy.url)) {
    issues.push(error("proxy.url", "external proxy URL must be loopback in v1"));
  }
  if (proxy.mode === "external" && typeof proxy.url === "string" && isForbiddenDirectUpstreamUrl(proxy.url)) {
    issues.push(error("proxy.url", "must point to a Headroom proxy, not a direct upstream provider"));
  }
  if (proxy.mode === "managed" && (!Number.isInteger(proxy.port) || proxy.port < 1 || proxy.port > 65535)) {
    issues.push(error("proxy.port", "must be an integer between 1 and 65535"));
  }
  if (proxy.mode === "managed" && proxy.modeArg !== "cache") {
    issues.push(error("proxy.modeArg", "only cache is supported in v1"));
  }
  if (!isRelativeHealthPath(proxy.healthPath)) {
    issues.push(error("proxy.healthPath", "must be a single-slash relative path string"));
  }
  if (!isPositiveInteger(proxy.startupTimeoutMs)) {
    issues.push(error("proxy.startupTimeoutMs", "must be a positive integer"));
  }
  if (!isPositiveInteger(proxy.shutdownTimeoutMs)) {
    issues.push(error("proxy.shutdownTimeoutMs", "must be a positive integer"));
  }
  if (!isPlainObject(proxy.env)) {
    issues.push(error("proxy.env", "must be an object of non-secret environment values"));
  }
  for (const [key, value] of Object.entries(asRecord(proxy.env))) {
    if (typeof value !== "string") {
      issues.push(error(`proxy.env.${key}`, "environment values must be strings"));
    }
    if (looksSecretEnvName(key)) {
      issues.push(error(`proxy.env.${key}`, "provider credentials must come from runtime environment, not headroom.json"));
    }
    if (typeof value === "string" && looksSecretValue(value)) {
      issues.push(error(`proxy.env.${key}`, "provider credential values must not be stored in headroom.json"));
    }
  }
  if (mcp.mode !== "stdio") {
    issues.push(error("mcp.mode", "only stdio is supported in v1"));
  }
  if (typeof mcp.enabled !== "boolean") {
    issues.push(error("mcp.enabled", "must be boolean"));
  }
  if (!isNonEmptyString(mcp.serverName)) {
    issues.push(error("mcp.serverName", "must be a non-empty string"));
  }
  if (!isPositiveInteger(mcp.startupTimeoutMs)) {
    issues.push(error("mcp.startupTimeoutMs", "must be a positive integer"));
  }

  if (typeof routing.autoDetect !== "boolean") {
    issues.push(error("routing.autoDetect", "must be boolean"));
  }
  if (typeof routing.defaultUpstream !== "string") {
    issues.push(error("routing.defaultUpstream", "must be a string"));
  }
  if (typeof routing.sessionHeader !== "boolean") {
    issues.push(error("routing.sessionHeader", "must be boolean"));
  }
  if (!isNonEmptyString(routing.upstreamHeader)) {
    issues.push(error("routing.upstreamHeader", "must be a non-empty string"));
  }
  const upstreamOverrides = asRecord(routing.upstreamOverrides);
  if (!isPlainObject(routing.upstreamOverrides)) {
    issues.push(error("routing.upstreamOverrides", "must be an object"));
  }
  if (typeof routing.defaultUpstream === "string" && routing.defaultUpstream && routing.defaultUpstream !== "openrouter") {
    const override = upstreamOverrides[routing.defaultUpstream] as UpstreamOverride | undefined;
    if (!isCompleteOverride(override)) {
      issues.push(error("routing.defaultUpstream", "custom selectors require backend, baseUrl, and apiKeyEnv override fields"));
    }
  }
  for (const [selector, value] of Object.entries(upstreamOverrides)) {
    if (!isPlainObject(value)) {
      issues.push(error(`routing.upstreamOverrides.${selector}`, "must be an object"));
      continue;
    }
    const override = asRecord(value) as UpstreamOverride;
    for (const key of Object.keys(override)) {
      if (!["backend", "baseUrl", "apiKeyEnv"].includes(key)) {
        issues.push(error(`routing.upstreamOverrides.${selector}.${key}`, "unknown upstream override key"));
      }
    }
    if (override.backend !== undefined && !isNonEmptyString(override.backend)) {
      issues.push(error(`routing.upstreamOverrides.${selector}.backend`, "must be a non-empty string"));
    }
    if (override.baseUrl !== undefined && !isHttpUrl(override.baseUrl)) {
      issues.push(error(`routing.upstreamOverrides.${selector}.baseUrl`, "must be an http(s) URL"));
    }
    if (override.apiKeyEnv !== undefined && !isValidEnvName(override.apiKeyEnv)) {
      issues.push(error(`routing.upstreamOverrides.${selector}.apiKeyEnv`, "must be an environment variable name, not a secret value"));
    }
  }
  if (typeof state.configDir !== "string") {
    issues.push(error("state.configDir", "must be a string"));
  }
  if (typeof state.workspaceDir !== "string") {
    issues.push(error("state.workspaceDir", "must be a string"));
  }
  if (typeof state.stateless !== "boolean") {
    issues.push(error("state.stateless", "must be boolean"));
  }
  const ui = sectionOrDefault<HeadroomConfig["ui"]>(root, "ui", DEFAULT_CONFIG.ui, issues);
  if (!isNonEmptyString(ui.statusKey)) {
    issues.push(error("ui.statusKey", "must be a non-empty string"));
  }
  if (typeof ui.showSavings !== "boolean") {
    issues.push(error("ui.showSavings", "must be boolean"));
  }
  if (typeof ui.showProxyHealth !== "boolean") {
    issues.push(error("ui.showProxyHealth", "must be boolean"));
  }

  return dedupeIssues(issues);
}

export function hasErrors(issues: ConfigIssue[]): boolean {
  return issues.some((issue) => issue.severity === "error");
}

export function resolveProxyUrl(config: HeadroomConfig): string | null {
  if (config.proxy.mode === "disabled") return null;
  if (config.proxy.mode === "external") return config.proxy.url ?? null;
  return `http://${formatUrlHost(config.proxy.host)}:${config.proxy.port}`;
}

export function deriveUpstreamProfile(config: HeadroomConfig, metadata: HarnessMetadata): DerivedUpstreamProfile {
  const routeMetadata = config.routing.autoDetect ? metadata : { modelId: metadata.modelId, modelName: metadata.modelName };
  const selector = config.routing.defaultUpstream || normalizedProvider(routeMetadata.providerName) || "openrouter";
  const selectorOverride = config.routing.upstreamOverrides[selector];
  const base =
    builtInProfile(selector, routeMetadata) ??
    (isCompleteOverride(selectorOverride) ? profileFromOverride(selector, selectorOverride, routeMetadata) : openRouterProfile(routeMetadata));
  const override = config.routing.upstreamOverrides[selector] ?? config.routing.upstreamOverrides[base.piProvider];
  return applyOverride(base, override);
}

export function verifyCredential(profile: DerivedUpstreamProfile, env: Record<string, string | undefined>): CredentialCheck {
  if (!profile.apiKeyEnv) {
    return { ok: true, apiKeyEnv: null };
  }
  if (!isValidEnvName(profile.apiKeyEnv)) {
    return {
      ok: false,
      apiKeyEnv: null,
      message: "headroom: invalid credential environment variable name",
    };
  }
  if (env[profile.apiKeyEnv]) {
    return { ok: true, apiKeyEnv: profile.apiKeyEnv };
  }
  return {
    ok: false,
    apiKeyEnv: profile.apiKeyEnv,
    message: `headroom: missing ${profile.apiKeyEnv}`,
  };
}

export function buildManagedProxyArgs(config: HeadroomConfig, profile: DerivedUpstreamProfile): string[] {
  if (config.proxy.mode !== "managed") {
    return [];
  }
  const args = [
    "proxy",
    "--host",
    config.proxy.host,
    "--port",
    String(config.proxy.port),
    "--backend",
    profile.backend,
    "--mode",
    config.proxy.modeArg,
  ];
  if (config.state.stateless) {
    args.push("--stateless");
  }
  return args;
}

export function buildMcpArgs(proxyUrl: string): string[] {
  return ["mcp", "serve", "--proxy-url", proxyUrl];
}

export function buildStateEnv(config: HeadroomConfig): Record<string, string> {
  const env: Record<string, string> = {};
  if (config.state.configDir) env.HEADROOM_CONFIG_DIR = config.state.configDir;
  if (config.state.workspaceDir) env.HEADROOM_WORKSPACE_DIR = config.state.workspaceDir;
  return env;
}

export function mergeHarnessMetadata(previous: HarnessMetadata | null, next: HarnessMetadata): HarnessMetadata {
  return {
    ...(previous ?? {}),
    ...Object.fromEntries(Object.entries(next).filter(([, value]) => value !== undefined && value !== null && value !== "")),
  };
}

function mergePartial(base: unknown, override: Record<string, unknown>): unknown {
  if (!isPlainObject(base)) return clone(override);
  const result: Record<string, unknown> = clone(base) as Record<string, unknown>;
  for (const [key, value] of Object.entries(override)) {
    if (isPlainObject(value) && isPlainObject(result[key])) {
      result[key] = mergePartial(result[key], value as Record<string, unknown>);
    } else {
      result[key] = clone(value);
    }
  }
  return result;
}

function collectUnknownKeyIssues(raw: unknown, issues: ConfigIssue[], prefix = ""): void {
  const obj = asRecord(raw);
  const allowed = prefix ? NESTED_KEYS[prefix] : TOP_LEVEL_KEYS;
  for (const [key, value] of Object.entries(obj)) {
    const field = prefix ? `${prefix}.${key}` : key;
    if (!allowed?.has(key)) {
      issues.push(warning(field, "unknown config key"));
      continue;
    }
    if (!prefix && isPlainObject(value) && NESTED_KEYS[key]) {
      collectUnknownKeyIssues(value, issues, key);
    }
  }
}

function collectDeferredFieldIssues(raw: unknown, issues: ConfigIssue[]): void {
  const obj = asRecord(raw);
  const proxy = asRecord(obj.proxy);
  const mcp = asRecord(obj.mcp);
  const state = asRecord(obj.state);
  if ("args" in proxy) {
    issues.push(error("proxy.args", "arbitrary proxy argument passthroughs are deferred"));
  }
  if ("args" in mcp) {
    issues.push(error("mcp.args", "arbitrary MCP argument passthroughs are deferred"));
  }
  if ("memoryDbPath" in state) {
    issues.push(error("state.memoryDbPath", "memory DB selection is deferred"));
  }
}

function builtInProfile(selector: string, metadata: HarnessMetadata): DerivedUpstreamProfile | null {
  if (selector === "openrouter") {
    return openRouterProfile(metadata);
  }
  if (selector.includes("anthropic")) {
    return {
      name: selector,
      piProvider: metadata.providerFamily ?? "anthropic",
      model: metadata.modelId ?? metadata.modelName ?? "",
      backend: "anthropic",
      baseUrl: metadata.providerBaseUrl ?? null,
      apiKeyEnv: "ANTHROPIC_API_KEY",
    };
  }
  return null;
}

function openRouterProfile(metadata: HarnessMetadata): DerivedUpstreamProfile {
  return {
    name: "openrouter",
    piProvider: metadata.providerFamily ?? "openai-compatible",
    model: metadata.modelId ?? metadata.modelName ?? "",
    backend: "openrouter",
    baseUrl: "https://openrouter.ai/api/v1",
    apiKeyEnv: "OPENROUTER_API_KEY",
  };
}

function applyOverride(profile: DerivedUpstreamProfile, override: UpstreamOverride | undefined): DerivedUpstreamProfile {
  if (!override) return profile;
  return {
    ...profile,
    backend: override.backend ?? profile.backend,
    baseUrl: override.baseUrl ?? profile.baseUrl,
    apiKeyEnv: override.apiKeyEnv ?? profile.apiKeyEnv,
  };
}

function profileFromOverride(
  selector: string,
  override: UpstreamOverride,
  metadata: HarnessMetadata,
): DerivedUpstreamProfile {
  return {
    name: selector,
    piProvider: metadata.providerFamily ?? "openai-compatible",
    model: metadata.modelId ?? metadata.modelName ?? "",
    backend: override.backend ?? selector,
    baseUrl: override.baseUrl ?? null,
    apiKeyEnv: override.apiKeyEnv ?? null,
  };
}

function normalizedProvider(provider: string | null | undefined): string | null {
  if (!provider) return null;
  const normalized = provider.trim().toLowerCase();
  if (!normalized || normalized === "unknown") return null;
  if (normalized.includes("openrouter")) return "openrouter";
  if (normalized.includes("anthropic")) return "anthropic";
  return normalized;
}

function isCompleteOverride(override: UpstreamOverride | undefined): boolean {
  return (
    typeof override?.backend === "string" &&
    override.backend !== "" &&
    isHttpUrl(override.baseUrl) &&
    typeof override.apiKeyEnv === "string" &&
    isValidEnvName(override.apiKeyEnv)
  );
}

function sectionOrDefault<T>(
  root: Record<string, unknown>,
  key: string,
  fallback: T,
  issues: ConfigIssue[],
): T {
  if (isPlainObject(root[key])) {
    return root[key] as T;
  }
  if (root[key] !== undefined) {
    issues.push(error(key, "must be an object"));
  }
  return fallback;
}

function isLoopbackBindHost(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

function formatUrlHost(host: string): string {
  return host === "::1" ? "[::1]" : host;
}

function isForbiddenDirectUpstreamUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return (
      host === "openrouter.ai" ||
      host.endsWith(".openrouter.ai") ||
      host === "api.openai.com" ||
      host === "api.anthropic.com"
    );
  } catch {
    return false;
  }
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.trim() === "") return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isRelativeHealthPath(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") && !/[\\\r\n]/.test(value);
}

function isLoopbackUrl(value: string): boolean {
  try {
    const host = new URL(value).hostname.replace(/^\[(.*)\]$/, "$1");
    return isLoopbackBindHost(host);
  } catch {
    return false;
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0;
}

function looksSecretEnvName(name: string): boolean {
  return /(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(name);
}

function looksSecretValue(value: string): boolean {
  return /^sk[-_][A-Za-z0-9_-]+/i.test(value) || /BEGIN (?:OPENSSH |RSA |EC |)PRIVATE KEY/.test(value);
}

function isValidEnvName(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !/^sk[-_]/i.test(name);
}

function asRecord(value: unknown): Record<string, unknown> {
  return isPlainObject(value) ? value : {};
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clone<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => clone(item)) as T;
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)])) as T;
  }
  return value;
}

function error(field: string, message: string): ConfigIssue {
  return { severity: "error", field, message };
}

function warning(field: string, message: string): ConfigIssue {
  return { severity: "warning", field, message };
}

function dedupeIssues(issues: ConfigIssue[]): ConfigIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.severity}\0${issue.field}\0${issue.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
