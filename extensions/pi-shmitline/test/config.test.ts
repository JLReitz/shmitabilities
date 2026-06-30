import { describe, it, expect } from "vitest";
import { DEFAULT_CONFIG, mergeConfigLayers, validateConfig } from "../index.ts";

describe("config", () => {
  describe("DEFAULT_CONFIG", () => {
    it("should have empty statusScript by default", () => {
      expect(DEFAULT_CONFIG.statusScript).toBe("");
    });

    it("should have mouseScroll enabled by default", () => {
      expect(DEFAULT_CONFIG.mouseScroll).toBe(true);
    });

    it("should have default shortcuts", () => {
      expect(DEFAULT_CONFIG.shortcuts.jumpPreviousUserMessage).toBe("ctrl+up");
      expect(DEFAULT_CONFIG.shortcuts.jumpNextUserMessage).toBe("ctrl+down");
      expect(DEFAULT_CONFIG.shortcuts.jumpPreviousLlmMessage).toBe("ctrl+alt+up");
      expect(DEFAULT_CONFIG.shortcuts.jumpNextLlmMessage).toBe("ctrl+alt+down");
      expect(DEFAULT_CONFIG.shortcuts.jumpChatBottom).toEqual(["ctrl+shift+g", "ctrl+end"]);
    });
  });

  describe("validateConfig", () => {
    it("should validate valid config", () => {
      const errors = validateConfig(DEFAULT_CONFIG);
      expect(errors).toEqual([]);
    });

    it("should validate invalid shortcut type", () => {
      const config = {
        ...DEFAULT_CONFIG,
        shortcuts: {
          ...DEFAULT_CONFIG.shortcuts,
          jumpPreviousUserMessage: 123 as any,
        },
      };
      const errors = validateConfig(config);
      expect(errors).toHaveLength(1);
      expect(errors[0].field).toBe("shortcuts.jumpPreviousUserMessage");
      expect(errors[0].message).toContain("must be string or string[]");
    });

    it("should validate invalid shortcut array element type", () => {
      const config = {
        ...DEFAULT_CONFIG,
        shortcuts: {
          ...DEFAULT_CONFIG.shortcuts,
          jumpChatBottom: ["ctrl+g", 123 as any],
        },
      };
      const errors = validateConfig(config);
      expect(errors).toHaveLength(1);
      expect(errors[0].field).toBe("shortcuts.jumpChatBottom");
    });

    it("should not validate statusScript if empty", () => {
      const config = { ...DEFAULT_CONFIG, statusScript: "" };
      const errors = validateConfig(config);
      expect(errors).toEqual([]);
    });
  });

  describe("mergeConfigLayers", () => {
    it("merges shortcut fields while project values override global values", () => {
      const config = mergeConfigLayers(
        {
          mouseScroll: false,
          _configPath: "/global/shmitline.json",
          _rawShortcuts: {
            jumpPreviousUserMessage: "global-prev",
            jumpNextUserMessage: "global-next",
          },
        },
        {
          _configPath: "/project/shmitline.json",
          _rawShortcuts: {
            jumpPreviousUserMessage: "project-prev",
          },
        },
      );

      expect(config.mouseScroll).toBe(false);
      expect(config.shortcuts.jumpPreviousUserMessage).toBe("project-prev");
      expect(config.shortcuts.jumpNextUserMessage).toBe("global-next");
      expect(config.shortcuts.jumpPreviousLlmMessage).toBe(DEFAULT_CONFIG.shortcuts.jumpPreviousLlmMessage);
      expect(config).not.toHaveProperty("_rawShortcuts");
      expect(config).not.toHaveProperty("_configPath");
    });
  });
});
