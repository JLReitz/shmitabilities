import { describe, it, expect } from "vitest";
import { parsePowerlineConfig } from "../../src/components/powerline-config.ts";

describe("powerline-config component", () => {
  it("should parse default config when no settings provided", () => {
    const config = parsePowerlineConfig(undefined, ["default"]);
    expect(config.preset).toBe("default");
  });

  it("should parse specified preset", () => {
    const config = parsePowerlineConfig({ preset: "custom" } as any, ["default", "custom"]);
    expect(config.preset).toBe("custom");
  });

  it("should fallback to default if preset is not in allowed list", () => {
    const config = parsePowerlineConfig({ preset: "unknown" } as any, ["default"]);
    expect(config.preset).toBe("default");
  });
});
