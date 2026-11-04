import { describe, it, expect, vi } from "vitest";
import {
  shortcutUsesSuper,
  isSupportedSuperShortcut,
  matchesConfiguredShortcut,
  resolveShortcutConfig,
} from "../../src/components/shortcuts.ts";

describe("shortcuts component", () => {
  describe("shortcutUsesSuper", () => {
    it("should return true if super is present", () => {
      expect(shortcutUsesSuper("super+up")).toBe(true);
      expect(shortcutUsesSuper("shift+super+up")).toBe(true);
    });

    it("should return false if super is not present", () => {
      expect(shortcutUsesSuper("ctrl+up")).toBe(false);
      expect(shortcutUsesSuper("up")).toBe(false);
    });
  });

  describe("isSupportedSuperShortcut", () => {
    it("should return true for known super shortcuts", () => {
      expect(isSupportedSuperShortcut("super+up")).toBe(true);
      expect(isSupportedSuperShortcut("super+shift+down")).toBe(true);
    });

    it("should return false for unknown super shortcuts", () => {
      expect(isSupportedSuperShortcut("super+f1")).toBe(false);
    });
  });

  describe("matchesConfiguredShortcut", () => {
    it("should match configured super shortcut", () => {
      // \x1b[1;9A is super+up in many terminals
      expect(matchesConfiguredShortcut("\x1b[1;9A", "super+up")).toBe(true);
    });

    it("should return false if it doesn't match", () => {
      expect(matchesConfiguredShortcut("abc", "super+up")).toBe(false);
    });
  });

  describe("resolveShortcutConfig", () => {
    it("should return defaults when no settings provided", () => {
      const result = resolveShortcutConfig({});
      expect(result.jumpPreviousUserMessage).toBe("ctrl+up");
      expect(result.jumpNextUserMessage).toBe("ctrl+down");
      expect(result.jumpPreviousLlmMessage).toBe("ctrl+alt+up");
      expect(result.jumpNextLlmMessage).toBe("ctrl+alt+down");
      expect(result.jumpChatBottom).toEqual(["ctrl+shift+g", "ctrl+end"]);
    });

    it("should return settings when provided", () => {
      const result = resolveShortcutConfig({ shortcuts: { jumpPreviousUserMessage: "ctrl+alt+up", jumpNextUserMessage: "ctrl+alt+down" } });
      expect(result.jumpPreviousUserMessage).toBe("ctrl+alt+up");
      expect(result.jumpNextUserMessage).toBe("ctrl+alt+down");
      // Unchanged keys retain defaults
      expect(result.jumpPreviousLlmMessage).toBe("ctrl+alt+up");
    });

    it("should support string or array values", () => {
      const result = resolveShortcutConfig({ shortcuts: { jumpChatBottom: "ctrl+g" } });
      expect(result.jumpChatBottom).toBe("ctrl+g");
    });

    it("should preserve array values when not overridden", () => {
      const result = resolveShortcutConfig({ shortcuts: { jumpPreviousUserMessage: "ctrl+up" } });
      expect(result.jumpChatBottom).toEqual(["ctrl+shift+g", "ctrl+end"]);
    });
  });

  describe("collision detection", () => {
    it("should not conflate super+up and super+home for 7;9~", () => {
      const sequence = "\x1b[7;9~";
      expect(matchesConfiguredShortcut(sequence, "super+up")).toBe(false);
      expect(matchesConfiguredShortcut(sequence, "super+home")).toBe(true);
    });

    it("should not conflate super+down and super+shift+down for 8;9~", () => {
      const sequence = "\x1b[8;9~";
      expect(matchesConfiguredShortcut(sequence, "super+down")).toBe(false);
      expect(matchesConfiguredShortcut(sequence, "super+shift+down")).toBe(true);
    });

    it("should not conflate super+end and super+shift+end for 57424;10u", () => {
      const sequence = "\x1b[57424;10u";
      expect(matchesConfiguredShortcut(sequence, "super+end")).toBe(false);
      expect(matchesConfiguredShortcut(sequence, "super+shift+end")).toBe(true);
    });
  });
});
