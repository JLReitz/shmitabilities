// Test-focused subset of @earendil-works/pi-tui.
const KEY_SEQUENCES: Record<string, string[]> = {
  "ctrl+c": ["\x03"],
  "ctrl+shift+up": ["\x1b[1;6A"],
  "ctrl+shift+down": ["\x1b[1;6B"],
  pageup: ["\x1b[5~", "\x1b[[5~"],
  pagedown: ["\x1b[6~", "\x1b[[6~"],
};

function stripTerminalControls(text: string): string {
  return text
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
}

function codePointWidth(codePoint: number): number {
  if (codePoint === 0 || codePoint < 32 || (codePoint >= 0x7f && codePoint < 0xa0)) return 0;
  if (/\p{Mark}/u.test(String.fromCodePoint(codePoint))) return 0;
  return (
    codePoint >= 0x1100 && (
      codePoint <= 0x115f
      || codePoint === 0x2329
      || codePoint === 0x232a
      || (codePoint >= 0x2e80 && codePoint <= 0xa4cf)
      || (codePoint >= 0xac00 && codePoint <= 0xd7a3)
      || (codePoint >= 0xf900 && codePoint <= 0xfaff)
      || (codePoint >= 0xfe10 && codePoint <= 0xfe19)
      || (codePoint >= 0xfe30 && codePoint <= 0xfe6f)
      || (codePoint >= 0xff00 && codePoint <= 0xff60)
      || (codePoint >= 0xffe0 && codePoint <= 0xffe6)
      || (codePoint >= 0x1f300 && codePoint <= 0x1faff)
      || (codePoint >= 0x20000 && codePoint <= 0x3fffd)
    )
  ) ? 2 : 1;
}

export function deleteAllKittyImages() {
  return "\x1b_Ga=d,d=A,q=2\x1b\\";
}

export function isKeyRelease(data: string) {
  return /:(?:3|[0-9]+;3)[~u]$/.test(data);
}

export function matchesKey(data: string, key: string) {
  return KEY_SEQUENCES[key.toLowerCase()]?.includes(data) ?? data === key;
}

export function truncateToWidth(text: string, width: number, suffix = "", _wrap = false) {
  if (visibleWidth(text) <= width) return text;
  const available = Math.max(0, width - visibleWidth(suffix));
  let result = "";
  let used = 0;
  for (const character of stripTerminalControls(text)) {
    const characterWidth = codePointWidth(character.codePointAt(0) ?? 0);
    if (used + characterWidth > available) break;
    result += character;
    used += characterWidth;
  }
  return result + suffix;
}

export function visibleWidth(text: string) {
  let width = 0;
  for (const character of stripTerminalControls(text)) {
    width += codePointWidth(character.codePointAt(0) ?? 0);
  }
  return width;
}
