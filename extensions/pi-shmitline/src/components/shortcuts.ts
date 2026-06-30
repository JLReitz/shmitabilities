import { matchesKey } from "@earendil-works/pi-tui";

const SUPER_SHORTCUT_PATTERNS = new Map<string, RegExp>([
  ["super+up", /^\x1b\[(?:1;9(?::[12])?[AH]|574(?:19|23);9(?::[12])?u|27;9;65~)$/],
  ["super+down", /^\x1b\[(?:1;9(?::[12])?[BF]|574(?:20|24);9(?::[12])?u|27;9;66~)$/],
  ["super+home", /^\x1b\[(?:1;9(?::[12])?H|57423;9(?::[12])?u|7;9(?::[12])?~)$/],
  ["super+end", /^\x1b\[(?:1;9(?::[12])?F|57424;9(?::[12])?u|8;9(?::[12])?~)$/],
  ["super+pageup", /^\x1b\[(?:5;9(?::[12])?~|57421;9(?::[12])?u)$/],
  ["super+pagedown", /^\x1b\[(?:6;9(?::[12])?~|57422;9(?::[12])?u)$/],
  ["super+shift+up", /^\x1b\[(?:1;10(?::[12])?[AH]|574(?:19|23);10(?::[12])?u|27;10;65~)$/],
  ["super+shift+down", /^\x1b\[(?:1;10(?::[12])?[BF]|574(?:20|24);10(?::[12])?u|8;9(?::[12])?~|27;10;66~)$/],
  ["super+shift+home", /^\x1b\[(?:1;10(?::[12])?H|57423;10(?::[12])?u|7;10(?::[12])?~)$/],
  ["super+shift+end", /^\x1b\[(?:1;10(?::[12])?F|57424;10(?::[12])?u|8;10(?::[12])?~)$/],
]);

export function shortcutUsesSuper(shortcut: string): boolean {
  const parts = shortcut.toLowerCase().split("+");
  return parts.slice(0, -1).includes("super");
}

export function isSupportedSuperShortcut(shortcut: string): boolean {
  return SUPER_SHORTCUT_PATTERNS.has(shortcut.toLowerCase());
}

export function shortcutConflictKey(shortcut: string): string {
  switch (shortcut.toLowerCase()) {
    case "super+home":
      return "super+up";
    case "super+end":
      return "super+down";
    case "super+shift+home":
      return "super+shift+up";
    case "super+shift+end":
      return "super+shift+down";
    default:
      return shortcut;
  }
}

export function matchesConfiguredShortcut(data: string, shortcut: string): boolean {
  const normalizedShortcut = shortcut.toLowerCase();
  if (shortcutUsesSuper(normalizedShortcut)) {
    return SUPER_SHORTCUT_PATTERNS.get(normalizedShortcut)?.test(data) ?? false;
  }

  return matchesKey(data, shortcut);
}

export interface ShortcutConfig {
  jumpPreviousUserMessage: string | string[];
  jumpNextUserMessage: string | string[];
  jumpPreviousLlmMessage: string | string[];
  jumpNextLlmMessage: string | string[];
  jumpChatBottom: string | string[];
}

export const DEFAULT_SHORTCUTS: ShortcutConfig = {
  jumpPreviousUserMessage: "ctrl+up",
  jumpNextUserMessage: "ctrl+down",
  jumpPreviousLlmMessage: "ctrl+alt+up",
  jumpNextLlmMessage: "ctrl+alt+down",
  jumpChatBottom: ["ctrl+shift+g", "ctrl+end"],
};

export function normalizeShortcut(shortcut: string): string {
  return shortcut.toLowerCase().trim();
}

export function resolveShortcutConfig(settings: { shortcuts?: Record<string, string | string[]> } | undefined): ShortcutConfig {
  const result = { ...DEFAULT_SHORTCUTS };

  if (!settings?.shortcuts) {
    return result;
  }

  for (const key of Object.keys(DEFAULT_SHORTCUTS) as Array<keyof ShortcutConfig>) {
    const configured = settings.shortcuts[key];
    if (configured !== undefined) {
      result[key] = configured;
    }
  }

  return result;
}

export function matchAnyShortcut(data: string, shortcuts: string | string[]): boolean {
  const keys = Array.isArray(shortcuts) ? shortcuts : [shortcuts];
  return keys.some((key) => matchesConfiguredShortcut(data, normalizeShortcut(key)));
}

export function getAllShortcutKeys(config: ShortcutConfig): string[] {
  const keys: string[] = [];
  for (const value of Object.values(config)) {
    if (Array.isArray(value)) {
      keys.push(...value);
    } else {
      keys.push(value);
    }
  }
  return keys;
}
