import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONFIG,
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
} from "../src/config.ts";

describe("pi-headroom v1 config", () => {
  it("merges project config over user config by explicit field path", () => {
    const config = mergeConfigLayers(
      {
        proxy: {
          env: {
            HEADROOM_SAVINGS_PROFILE: "coding",
            HEADROOM_TRACE: "0",
          },
          startupTimeoutMs: 5000,
        },
        routing: {
          upstreamOverrides: {
            openrouter: {
              apiKeyEnv: "OPENROUTER_API_KEY",
            },
            anthropic: {
              backend: "anthropic",
            },
          },
        },
      },
      {
        proxy: {
          env: {
            HEADROOM_TRACE: "1",
          },
        },
        routing: {
          upstreamOverrides: {
            anthropic: {
              apiKeyEnv: "ANTHROPIC_API_KEY",
            },
          },
        },
      },
    );

    expect(config.proxy.startupTimeoutMs).toBe(5000);
    expect(config.proxy.env).toEqual({
      HEADROOM_SAVINGS_PROFILE: "coding",
      HEADROOM_TRACE: "1",
    });
    expect(config.routing.upstreamOverrides).toEqual({
      openrouter: { apiKeyEnv: "OPENROUTER_API_KEY" },
      anthropic: { backend: "anthropic", apiKeyEnv: "ANTHROPIC_API_KEY" },
    });
  });

  it("warns on unknown config keys", () => {
    const raw = {
      enabled: true,
      proxy: {
        color: "blue",
      },
      unsupported: true,
    };

    const issues = validateConfig(mergeConfigLayers(raw, {}), [raw]);

    expect(issues).toEqual(
      expect.arrayContaining([
        { severity: "warning", field: "proxy.color", message: "unknown config key" },
        { severity: "warning", field: "unsupported", message: "unknown config key" },
      ]),
    );
  });

  it("warns on unknown config keys when raw layers are omitted", () => {
    const config = mergeConfigLayers({ proxy: { color: "blue" }, unsupported: true }, {});

    expect(validateConfig(config)).toEqual(
      expect.arrayContaining([
        { severity: "warning", field: "proxy.color", message: "unknown config key" },
        { severity: "warning", field: "unsupported", message: "unknown config key" },
      ]),
    );
  });

  it("reports malformed primitive fields without throwing", () => {
    const config = mergeConfigLayers(
      {
        headroomCommand: 42,
        proxy: {
          env: "OPENROUTER_API_KEY=sk-secret",
        },
      },
      {},
    );

    expect(() => validateConfig(config)).not.toThrow();
    expect(validateConfig(config)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ severity: "error", field: "headroomCommand" }),
        expect.objectContaining({ severity: "error", field: "proxy.env" }),
      ]),
    );
  });

  it("reports malformed section objects without throwing", () => {
    const config = mergeConfigLayers(
      {
        proxy: null,
        routing: null,
      },
      {},
    );

    expect(() => validateConfig(config)).not.toThrow();
    expect(validateConfig(config)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ severity: "error", field: "proxy", message: "must be an object" }),
        expect.objectContaining({ severity: "error", field: "routing", message: "must be an object" }),
      ]),
    );
  });

  it("reports malformed routing override fields without throwing", () => {
    const config = mergeConfigLayers(
      {
        routing: {
          defaultUpstream: 123,
          upstreamOverrides: null,
        },
      },
      {},
    );

    expect(() => validateConfig(config)).not.toThrow();
    expect(validateConfig(config)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ severity: "error", field: "routing.defaultUpstream" }),
        expect.objectContaining({ severity: "error", field: "routing.upstreamOverrides" }),
      ]),
    );
  });

  it("rejects deferred passthrough and memory fields", () => {
    const raw = {
      proxy: {
        args: ["--host", "0.0.0.0", "--memory"],
      },
      mcp: {
        args: ["--transport", "http"],
      },
      state: {
        memoryDbPath: "/tmp/headroom-memory.sqlite",
      },
    };

    const issues = validateConfig(mergeConfigLayers(raw, {}), [raw]);

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ severity: "error", field: "proxy.args" }),
        expect.objectContaining({ severity: "error", field: "mcp.args" }),
        expect.objectContaining({ severity: "error", field: "state.memoryDbPath" }),
      ]),
    );
    expect(hasErrors(issues)).toBe(true);
  });

  it("rejects deferred fields when raw layers are omitted", () => {
    const config = mergeConfigLayers({ proxy: { args: ["--memory"] }, mcp: { args: [] } }, {});

    expect(validateConfig(config)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ severity: "error", field: "proxy.args" }),
        expect.objectContaining({ severity: "error", field: "mcp.args" }),
      ]),
    );
  });

  it("derives managed proxy URL from host and port", () => {
    const config = mergeConfigLayers({ proxy: { host: "localhost", port: 8789 } }, {});

    expect(validateConfig(config)).toEqual([]);
    expect(resolveProxyUrl(config)).toBe("http://localhost:8789");
  });

  it("brackets managed IPv6 loopback when deriving proxy URL", () => {
    const config = mergeConfigLayers({ proxy: { host: "::1", port: 8789 } }, {});

    expect(validateConfig(config)).toEqual([]);
    expect(resolveProxyUrl(config)).toBe("http://[::1]:8789");
  });

  it("rejects bracket syntax in managed proxy host", () => {
    const config = mergeConfigLayers({ proxy: { host: "[::1]" } }, {});

    expect(validateConfig(config)).toEqual([
      expect.objectContaining({
        severity: "error",
        field: "proxy.host",
      }),
    ]);
  });

  it("rejects managed proxy URL overrides and non-loopback hosts", () => {
    const config = mergeConfigLayers({ proxy: { url: "http://127.0.0.1:9999", host: "0.0.0.0" } }, {});
    const issues = validateConfig(config);

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ severity: "error", field: "proxy.url" }),
        expect.objectContaining({ severity: "error", field: "proxy.host" }),
      ]),
    );
  });

  it("requires proxy.url in external mode and ignores host and port for routing", () => {
    const missing = mergeConfigLayers({ proxy: { mode: "external" } }, {});
    expect(validateConfig(missing)).toEqual([expect.objectContaining({ severity: "error", field: "proxy.url" })]);

    const config = mergeConfigLayers(
      {
        proxy: {
          mode: "external",
          url: "http://127.0.0.1:9876",
          host: "0.0.0.0",
          port: 1,
        },
      },
      {},
    );

    expect(validateConfig(config)).toEqual([]);
    expect(resolveProxyUrl(config)).toBe("http://127.0.0.1:9876");
  });

  it("ignores stale host and port fields in external mode", () => {
    const config = mergeConfigLayers(
      {
        proxy: {
          mode: "external",
          url: "http://127.0.0.1:9876",
          host: "not-loopback",
          port: -1,
          modeArg: "legacy",
        },
      },
      {},
    );

    expect(validateConfig(config)).toEqual([]);
    expect(resolveProxyUrl(config)).toBe("http://127.0.0.1:9876");
  });

  it("rejects direct upstream provider URLs in external mode", () => {
    const config = mergeConfigLayers(
      {
        proxy: {
          mode: "external",
          url: "https://openrouter.ai/api/v1",
        },
      },
      {},
    );

    expect(validateConfig(config)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "error",
          field: "proxy.url",
        }),
      ]),
    );
  });

  it("rejects non-loopback external proxy URLs even when they are not on the provider denylist", () => {
    const config = mergeConfigLayers(
      {
        proxy: {
          mode: "external",
          url: "https://api.groq.com/openai/v1",
        },
      },
      {},
    );

    expect(validateConfig(config)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "error",
          field: "proxy.url",
          message: "external proxy URL must be loopback in v1",
        }),
      ]),
    );
  });

  it("rejects non-string external proxy URLs", () => {
    const config = mergeConfigLayers({ proxy: { mode: "external", url: {} } }, {});

    expect(validateConfig(config)).toEqual([
      expect.objectContaining({
        severity: "error",
        field: "proxy.url",
      }),
    ]);
  });

  it("accepts bracketed IPv6 loopback external proxy URLs", () => {
    const config = mergeConfigLayers({ proxy: { mode: "external", url: "http://[::1]:8787" } }, {});

    expect(validateConfig(config)).toEqual([]);
    expect(resolveProxyUrl(config)).toBe("http://[::1]:8787");
  });

  it("rejects external proxy URLs with leading or trailing whitespace", () => {
    const config = mergeConfigLayers({ proxy: { mode: "external", url: " http://127.0.0.1:8787 " } }, {});

    expect(validateConfig(config)).toEqual([
      expect.objectContaining({
        severity: "error",
        field: "proxy.url",
        message: "must not contain leading or trailing whitespace",
      }),
    ]);
  });

  it("rejects unparsable external proxy URLs", () => {
    const config = mergeConfigLayers({ proxy: { mode: "external", url: "not-a-url" } }, {});

    expect(validateConfig(config)).toEqual([
      expect.objectContaining({
        severity: "error",
        field: "proxy.url",
        message: "must be an http(s) URL",
      }),
    ]);
  });

  it("rejects health paths that can change the proxy origin", () => {
    for (const healthPath of ["//example.test/health", "/\\example.test/health"]) {
      const config = mergeConfigLayers({ proxy: { healthPath } }, {});

      expect(validateConfig(config)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            severity: "error",
            field: "proxy.healthPath",
          }),
        ]),
      );
    }
  });

  it("rejects non-v1 proxy and MCP modes", () => {
    const config = mergeConfigLayers({ proxy: { modeArg: "learn" }, mcp: { mode: "http" } }, {});
    const issues = validateConfig(config);

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ severity: "error", field: "proxy.modeArg" }),
        expect.objectContaining({ severity: "error", field: "mcp.mode" }),
      ]),
    );
  });

  it("rejects provider secrets stored in proxy.env", () => {
    const config = mergeConfigLayers({ proxy: { env: { OPENROUTER_API_KEY: "sk-secret" } } }, {});
    const issues = validateConfig(config);

    expect(issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ severity: "error", field: "proxy.env.OPENROUTER_API_KEY" })]),
    );
  });

  it("rejects secret-shaped proxy.env values under harmless keys", () => {
    const config = mergeConfigLayers({ proxy: { env: { HEADROOM_EXTRA: "sk-secret-value" } } }, {});

    expect(validateConfig(config)).toEqual([
      expect.objectContaining({
        severity: "error",
        field: "proxy.env.HEADROOM_EXTRA",
      }),
    ]);
  });

  it("requires proxy.env values to be strings", () => {
    const config = mergeConfigLayers({ proxy: { env: { HEADROOM_EXTRA: 123 } } }, {});

    expect(validateConfig(config)).toEqual([
      expect.objectContaining({
        severity: "error",
        field: "proxy.env.HEADROOM_EXTRA",
      }),
    ]);
  });

  it("rejects secret-shaped apiKeyEnv overrides", () => {
    const config = mergeConfigLayers(
      {
        routing: {
          upstreamOverrides: {
            openrouter: {
              apiKeyEnv: "sk-secret-value",
            },
          },
        },
      },
      {},
    );

    expect(validateConfig(config)).toEqual([
      expect.objectContaining({
        severity: "error",
        field: "routing.upstreamOverrides.openrouter.apiKeyEnv",
      }),
    ]);
  });

  it("rejects malformed upstream override fields", () => {
    const config = mergeConfigLayers(
      {
        routing: {
          defaultUpstream: "broken",
          upstreamOverrides: {
            broken: {
              backend: 123,
              baseUrl: {},
              apiKeyEnv: "sk-secret-value",
            },
            scalar: "bad",
          },
        },
      },
      {},
    );

    expect(validateConfig(config)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ severity: "error", field: "routing.defaultUpstream" }),
        expect.objectContaining({ severity: "error", field: "routing.upstreamOverrides.broken.backend" }),
        expect.objectContaining({ severity: "error", field: "routing.upstreamOverrides.broken.baseUrl" }),
        expect.objectContaining({ severity: "error", field: "routing.upstreamOverrides.broken.apiKeyEnv" }),
        expect.objectContaining({ severity: "error", field: "routing.upstreamOverrides.scalar" }),
      ]),
    );
  });

  it("rejects unknown keys inside upstream override entries", () => {
    const config = mergeConfigLayers(
      {
        routing: {
          upstreamOverrides: {
            openrouter: {
              baseURL: "https://openrouter.ai/api/v1",
            },
          },
        },
      },
      {},
    );

    expect(validateConfig(config)).toEqual([
      expect.objectContaining({
        severity: "error",
        field: "routing.upstreamOverrides.openrouter.baseURL",
      }),
    ]);
  });

  it("rejects empty or invalid upstream override strings", () => {
    const config = mergeConfigLayers(
      {
        routing: {
          defaultUpstream: "broken",
          upstreamOverrides: {
            broken: {
              backend: "",
              baseUrl: "not-a-url",
              apiKeyEnv: "BROKEN_API_KEY",
            },
          },
        },
      },
      {},
    );

    expect(validateConfig(config)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ severity: "error", field: "routing.defaultUpstream" }),
        expect.objectContaining({ severity: "error", field: "routing.upstreamOverrides.broken.backend" }),
        expect.objectContaining({ severity: "error", field: "routing.upstreamOverrides.broken.baseUrl" }),
      ]),
    );
  });

  it("rejects malformed state fields that would affect args or environment", () => {
    const config = mergeConfigLayers(
      {
        state: {
          configDir: 1,
          workspaceDir: {},
          stateless: "false",
        },
      },
      {},
    );

    expect(validateConfig(config)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ severity: "error", field: "state.configDir" }),
        expect.objectContaining({ severity: "error", field: "state.workspaceDir" }),
        expect.objectContaining({ severity: "error", field: "state.stateless" }),
      ]),
    );
  });

  it("validates documented proxy, MCP, routing, and UI field types", () => {
    const config = mergeConfigLayers(
      {
        proxy: {
          healthPath: "health",
          startupTimeoutMs: 0,
          shutdownTimeoutMs: "soon",
        },
        mcp: {
          enabled: "yes",
          serverName: "",
          startupTimeoutMs: -1,
        },
        routing: {
          autoDetect: "yes",
          sessionHeader: "true",
          upstreamHeader: "",
        },
        ui: {
          statusKey: "",
          showSavings: "yes",
          showProxyHealth: null,
        },
      },
      {},
    );

    expect(validateConfig(config)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ severity: "error", field: "proxy.healthPath" }),
        expect.objectContaining({ severity: "error", field: "proxy.startupTimeoutMs" }),
        expect.objectContaining({ severity: "error", field: "proxy.shutdownTimeoutMs" }),
        expect.objectContaining({ severity: "error", field: "mcp.enabled" }),
        expect.objectContaining({ severity: "error", field: "mcp.serverName" }),
        expect.objectContaining({ severity: "error", field: "mcp.startupTimeoutMs" }),
        expect.objectContaining({ severity: "error", field: "routing.autoDetect" }),
        expect.objectContaining({ severity: "error", field: "routing.sessionHeader" }),
        expect.objectContaining({ severity: "error", field: "routing.upstreamHeader" }),
        expect.objectContaining({ severity: "error", field: "ui.statusKey" }),
        expect.objectContaining({ severity: "error", field: "ui.showSavings" }),
        expect.objectContaining({ severity: "error", field: "ui.showProxyHealth" }),
      ]),
    );
  });
});

describe("pi-headroom v1 provider routing", () => {
  it("falls back to OpenRouter when harness provider metadata is missing", () => {
    const profile = deriveUpstreamProfile(DEFAULT_CONFIG, { modelId: "anthropic/claude-sonnet-4" });

    expect(profile).toEqual({
      name: "openrouter",
      piProvider: "openai-compatible",
      model: "anthropic/claude-sonnet-4",
      backend: "openrouter",
      baseUrl: "https://openrouter.ai/api/v1",
      apiKeyEnv: "OPENROUTER_API_KEY",
    });
  });

  it("derives OpenRouter when Pi reports an OpenRouter provider", () => {
    const profile = deriveUpstreamProfile(DEFAULT_CONFIG, {
      providerName: "OpenRouter",
      providerFamily: "openai-compatible",
      modelId: "openai/gpt-5.5",
    });

    expect(profile.backend).toBe("openrouter");
    expect(profile.baseUrl).toBe("https://openrouter.ai/api/v1");
    expect(profile.apiKeyEnv).toBe("OPENROUTER_API_KEY");
    expect(profile.piProvider).toBe("openai-compatible");
  });

  it("preserves provider family and base URL for direct provider metadata", () => {
    const profile = deriveUpstreamProfile(DEFAULT_CONFIG, {
      providerName: "anthropic",
      providerFamily: "anthropic-messages",
      providerBaseUrl: "https://api.anthropic.com",
      modelId: "claude-sonnet-4-20250514",
    });

    expect(profile).toEqual({
      name: "anthropic",
      piProvider: "anthropic-messages",
      model: "claude-sonnet-4-20250514",
      backend: "anthropic",
      baseUrl: "https://api.anthropic.com",
      apiKeyEnv: "ANTHROPIC_API_KEY",
    });
  });

  it("applies provider overrides after harness derivation", () => {
    const config = mergeConfigLayers(
      {
        routing: {
          upstreamOverrides: {
            anthropic: {
              backend: "litellm-openai",
              baseUrl: "http://127.0.0.1:4000/v1",
              apiKeyEnv: "LITELLM_API_KEY",
            },
          },
        },
      },
      {},
    );
    const profile = deriveUpstreamProfile(config, {
      providerName: "anthropic",
      providerFamily: "anthropic-messages",
      modelId: "claude-sonnet-4-20250514",
    });

    expect(profile.backend).toBe("litellm-openai");
    expect(profile.baseUrl).toBe("http://127.0.0.1:4000/v1");
    expect(profile.apiKeyEnv).toBe("LITELLM_API_KEY");
    expect(profile.piProvider).toBe("anthropic-messages");
  });

  it("allows only OpenRouter as built-in default selector unless override is complete", () => {
    const incomplete = mergeConfigLayers({ routing: { defaultUpstream: "bedrock-prod" } }, {});
    expect(validateConfig(incomplete)).toEqual([
      expect.objectContaining({ severity: "error", field: "routing.defaultUpstream" }),
    ]);

    const complete = mergeConfigLayers(
      {
        routing: {
          defaultUpstream: "bedrock-prod",
          upstreamOverrides: {
            "bedrock-prod": {
              backend: "bedrock",
              baseUrl: "https://bedrock-runtime.us-east-1.amazonaws.com",
              apiKeyEnv: "AWS_PROFILE",
            },
          },
        },
      },
      {},
    );
    const profile = deriveUpstreamProfile(complete, {
      providerName: "anthropic",
      providerFamily: "anthropic-messages",
      modelId: "anthropic.claude-sonnet-4",
    });

    expect(validateConfig(complete)).toEqual([]);
    expect(profile).toEqual({
      name: "bedrock-prod",
      piProvider: "anthropic-messages",
      model: "anthropic.claude-sonnet-4",
      backend: "bedrock",
      baseUrl: "https://bedrock-runtime.us-east-1.amazonaws.com",
      apiKeyEnv: "AWS_PROFILE",
    });
  });

  it("verifies credential presence by env var name without exposing secret values", () => {
    const profile = deriveUpstreamProfile(DEFAULT_CONFIG, {});

    expect(verifyCredential(profile, {})).toEqual({
      ok: false,
      apiKeyEnv: "OPENROUTER_API_KEY",
      message: "headroom: missing OPENROUTER_API_KEY",
    });
    expect(verifyCredential(profile, { OPENROUTER_API_KEY: "sk-secret" })).toEqual({
      ok: true,
      apiKeyEnv: "OPENROUTER_API_KEY",
    });
  });

  it("does not echo invalid credential override values in diagnostics", () => {
    const profile = deriveUpstreamProfile(
      mergeConfigLayers({ routing: { upstreamOverrides: { openrouter: { apiKeyEnv: "sk-secret-value" } } } }, {}),
      {},
    );

    expect(verifyCredential(profile, {})).toEqual({
      ok: false,
      apiKeyEnv: null,
      message: "headroom: invalid credential environment variable name",
    });
  });

  it("builds managed proxy args from explicit v1 fields only", () => {
    const config = mergeConfigLayers({ state: { stateless: true } }, {});
    const profile = deriveUpstreamProfile(config, {});

    expect(buildManagedProxyArgs(config, profile)).toEqual([
      "proxy",
      "--host",
      "127.0.0.1",
      "--port",
      "8787",
      "--backend",
      "openrouter",
      "--mode",
      "cache",
      "--stateless",
    ]);
  });

  it("builds stdio MCP args bound to the active proxy URL", () => {
    expect(buildMcpArgs("http://127.0.0.1:8787")).toEqual([
      "mcp",
      "serve",
      "--proxy-url",
      "http://127.0.0.1:8787",
    ]);
  });

  it("maps state config to Headroom environment without memory DB flags", () => {
    const config = mergeConfigLayers(
      {
        state: {
          configDir: "/tmp/headroom-config",
          workspaceDir: "/tmp/headroom-workspace",
          stateless: true,
        },
      },
      {},
    );

    expect(buildStateEnv(config)).toEqual({
      HEADROOM_CONFIG_DIR: "/tmp/headroom-config",
      HEADROOM_WORKSPACE_DIR: "/tmp/headroom-workspace",
    });
    expect(buildManagedProxyArgs(config, deriveUpstreamProfile(config, {}))).not.toContain("--memory-db-path");
  });

  it("merges partial harness events over the last complete metadata snapshot", () => {
    const first = mergeHarnessMetadata(null, {
      providerName: "anthropic",
      providerFamily: "anthropic-messages",
      modelId: "claude-sonnet-4-20250514",
      sessionId: "session-1",
      cwd: "/workspace",
    });
    const second = mergeHarnessMetadata(first, {
      modelId: "claude-opus-4-20250514",
    });

    expect(second).toEqual({
      providerName: "anthropic",
      providerFamily: "anthropic-messages",
      modelId: "claude-opus-4-20250514",
      sessionId: "session-1",
      cwd: "/workspace",
    });
  });

  it("does not derive upstream provider from harness metadata when autoDetect is false", () => {
    const config = mergeConfigLayers({ routing: { autoDetect: false } }, {});
    const profile = deriveUpstreamProfile(config, {
      providerName: "anthropic",
      providerFamily: "anthropic-messages",
      providerBaseUrl: "https://api.anthropic.com",
      modelId: "claude-sonnet-4-20250514",
    });

    expect(profile).toEqual({
      name: "openrouter",
      piProvider: "openai-compatible",
      model: "claude-sonnet-4-20250514",
      backend: "openrouter",
      baseUrl: "https://openrouter.ai/api/v1",
      apiKeyEnv: "OPENROUTER_API_KEY",
    });
  });

  it("covers the remaining disabled and credential helper paths", () => {
    const disabled = mergeConfigLayers({ proxy: { mode: "disabled" } }, {});

    expect(hasErrors([{ severity: "warning", field: "proxy", message: "ignored" }])).toBe(false);
    expect(hasErrors([{ severity: "error", field: "proxy", message: "invalid" }])).toBe(true);
    expect(resolveProxyUrl(disabled)).toBeNull();
    expect(buildManagedProxyArgs(disabled, deriveUpstreamProfile(disabled, {}))).toEqual([]);
    expect(buildStateEnv(mergeConfigLayers({}, {}))).toEqual({});
    expect(verifyCredential({ name: "local", piProvider: "openai", model: "test", backend: "local", baseUrl: null, apiKeyEnv: null }, {})).toEqual({
      ok: true,
      apiKeyEnv: null,
    });
  });

  it("normalizes provider aliases and applies provider-family overrides", () => {
    const config = mergeConfigLayers(
      {
        routing: {
          upstreamOverrides: {
            "openai-compatible": { backend: "gateway", baseUrl: "http://127.0.0.1:4000/v1", apiKeyEnv: "GATEWAY_KEY" },
          },
        },
      },
      {},
    );

    expect(deriveUpstreamProfile(config, { providerName: " OpenRouter API ", providerFamily: "openai-compatible" })).toMatchObject({
      backend: "gateway",
      apiKeyEnv: "GATEWAY_KEY",
    });
    expect(deriveUpstreamProfile(DEFAULT_CONFIG, { providerName: "unknown" }).name).toBe("openrouter");
    expect(deriveUpstreamProfile(DEFAULT_CONFIG, { providerName: "internal-gateway" }).name).toBe("openrouter");
  });

  it("validates invalid top-level and managed-proxy selectors", () => {
    const config = mergeConfigLayers({ enabled: "yes", proxy: { mode: "pooled" } }, {});

    expect(validateConfig(config)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "enabled", message: "must be boolean" }),
        expect.objectContaining({ field: "proxy.mode", message: "must be managed, external, or disabled" }),
      ]),
    );
    expect(validateConfig(mergeConfigLayers({ proxy: { port: 0 } }, {}))).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: "proxy.port", message: "must be an integer between 1 and 65535" })]),
    );
  });
});
