import { afterEach, describe, expect, it, vi } from "vitest";
import { emergencyTerminalModeReset } from "../src/components/terminal-split.ts";
import { createTerminalSplitHarness } from "./helpers/terminal-split-harness.ts";

const wheelUp = (code = 64, col = 1, row = 1) => `\x1b[<${code};${col};${row}M`;
const wheelDown = (code = 65, col = 1, row = 1) => `\x1b[<${code};${col};${row}M`;
const leftPress = (col: number, row: number) => `\x1b[<0;${col};${row}M`;
const leftDrag = (col: number, row: number) => `\x1b[<32;${col};${row}M`;
const leftRelease = (col: number, row: number) => `\x1b[<0;${col};${row}m`;
const rightPress = (col: number, row: number) => `\x1b[<2;${col};${row}M`;

afterEach(() => {
  vi.useRealTimers();
});

describe("TerminalSplitCompositor", () => {
  it("wraps one host render span and restores the original layout", () => {
    const harness = createTerminalSplitHarness({ rootLines: ["line-1", "line-2"] });

    expect(harness.tui.render).toBeTypeOf("function");
    expect(harness.tui.children).toEqual([harness.proxy(), harness.editor]);
    expect(harness.renderRoot()).toEqual(["line-1", "line-2"]);
    expect(harness.compositor.getRootChildLineOffset(harness.root)).toBe(0);

    harness.compositor.dispose();

    expect(harness.tui.children).toEqual(harness.originalChildren);
    expect(harness.terminal.write).not.toBe(harness.installedWrite);
    expect(harness.tui.doRender).not.toBe(harness.installedDoRender);
    expect(harness.removeInputListener).toHaveBeenCalledOnce();
  });

  it("guards mouse modes while installed and disables them on cleanup", () => {
    const harness = createTerminalSplitHarness();
    const setup = String(harness.originalWrite.mock.calls[0]?.[0] ?? "");

    expect(setup).toContain("\x1b[?1049h");
    expect(setup).toContain("\x1b[?1002h");
    expect(setup).toContain("\x1b[?1006h");
    expect(setup).toContain("\x1b[?1007l");

    harness.terminal.write("body");
    expect(String(harness.originalWrite.mock.calls.at(-1)?.[0] ?? "")).toContain("\x1b[?1006h");

    harness.compositor.dispose();
    const cleanup = String(harness.originalWrite.mock.calls.at(-1)?.[0] ?? "");
    expect(cleanup).toContain("\x1b[?1006l");
    expect(cleanup).toContain("\x1b[?1002l");
    expect(cleanup).toContain("\x1b[?1007l");
    expect(cleanup).not.toContain("\x1b[?1007h");
  });

  it("does not register or consume mouse input when mouse scrolling is disabled", () => {
    const harness = createTerminalSplitHarness({ mouseScroll: false });
    const setup = String(harness.originalWrite.mock.calls[0]?.[0] ?? "");

    expect(setup).not.toContain("\x1b[?1002h");
    expect(setup).not.toContain("\x1b[?1006h");
    expect(harness.sendInput(wheelUp())).toBeUndefined();

    harness.compositor.dispose();
  });

  it("scrolls concatenated modifier-bearing wheel packets as one input chunk", () => {
    const rootLines = Array.from({ length: 12 }, (_, index) => `line-${index}`);
    const harness = createTerminalSplitHarness({ rootLines });
    harness.renderRoot();

    expect(harness.sendInput(wheelUp(68) + wheelUp(72))).toEqual({ consume: true });
    expect(harness.renderRoot()).toEqual(["line-1", "line-2", "line-3", "line-4", "line-5"]);

    expect(harness.sendInput(wheelDown(69))).toEqual({ consume: true });
    expect(harness.renderRoot()).toEqual(["line-4", "line-5", "line-6", "line-7", "line-8"]);

    harness.compositor.dispose();
  });

  it("supports PageUp, PageDown, configured shortcuts, and unknown-key fallthrough", () => {
    const rootLines = Array.from({ length: 15 }, (_, index) => `line-${index}`);
    const harness = createTerminalSplitHarness({
      rootLines,
      keyboardScrollShortcuts: { up: "ctrl+shift+up", down: "ctrl+shift+down" },
    });
    harness.renderRoot();

    expect(harness.sendInput("\x1b[5~")).toEqual({ consume: true });
    expect(harness.renderRoot()).toEqual(["line-0", "line-1", "line-2", "line-3", "line-4"]);
    expect(harness.sendInput("\x1b[1;6B")).toEqual({ consume: true });
    expect(harness.renderRoot()).toEqual(rootLines);
    expect(harness.sendInput("x")).toBeUndefined();

    expect(harness.sendInput("\x1b[1;6A")).toEqual({ consume: true });
    expect(harness.renderRoot()).toEqual(["line-0", "line-1", "line-2", "line-3", "line-4"]);
    expect(harness.sendInput("\x1b[6~")).toEqual({ consume: true });
    expect(harness.renderRoot()).toEqual(rootLines);

    harness.compositor.dispose();
  });

  it("leaves input and terminal writes alone while an overlay is visible", () => {
    const harness = createTerminalSplitHarness({
      rootLines: Array.from({ length: 10 }, (_, index) => `line-${index}`),
      overlayVisible: true,
    });
    harness.renderRoot();
    const writesBefore = harness.originalWrite.mock.calls.length;

    expect(harness.sendInput(wheelUp())).toBeUndefined();
    harness.terminal.write("overlay-frame");
    harness.compositor.requestRepaint();

    expect(harness.originalWrite.mock.calls).toHaveLength(writesBefore + 1);
    expect(harness.originalWrite.mock.calls.at(-1)?.[0]).toBe("overlay-frame");
    harness.compositor.dispose();
  });

  it("updates the reserved viewport when the fixed cluster height changes", () => {
    const harness = createTerminalSplitHarness({ rows: 8, cluster: { lines: ["editor"], cursor: null } });

    expect(harness.terminal.rows).toBe(7);
    harness.setCluster({ lines: ["status", "editor", "footer"], cursor: null });
    expect(harness.terminal.rows).toBe(5);

    harness.compositor.dispose();
    expect(harness.terminal.rows).toBe(8);
  });

  it("deletes Kitty images before repainting a newly scrolled viewport", () => {
    const harness = createTerminalSplitHarness({
      rootLines: Array.from({ length: 10 }, (_, index) => `line-${index}`),
    });
    harness.renderRoot();

    harness.sendInput(wheelUp());

    const repaint = String(harness.originalWrite.mock.calls.at(-1)?.[0] ?? "");
    expect(repaint).toContain("\x1b_Ga=d,d=A,q=2\x1b\\");
    harness.compositor.dispose();
  });

  it("removes its process-exit cleanup and input listener on dispose", () => {
    const exitListenersBefore = process.listenerCount("exit");
    const harness = createTerminalSplitHarness();

    expect(process.listenerCount("exit")).toBe(exitListenersBefore + 1);
    harness.compositor.dispose();
    harness.compositor.dispose();

    expect(process.listenerCount("exit")).toBe(exitListenersBefore);
    expect(harness.removeInputListener).toHaveBeenCalledOnce();
  });

  it("keeps select-to-copy highlighted until Ctrl+C copies, clears, and falls through", () => {
    const harness = createTerminalSplitHarness({ rootLines: ["line-1", "line-2"] });
    harness.renderRoot();

    expect(harness.sendInput(leftPress(1, 1) + leftDrag(5, 1) + leftRelease(5, 1))).toEqual({ consume: true });
    expect(harness.copied).toEqual(["line"]);
    expect(harness.renderRoot()[0]).toBe("\x1b[7mline\x1b[27m-1");

    expect(harness.sendInput("\x03")).toBeUndefined();
    expect(harness.copied).toEqual(["line", "line"]);
    expect(harness.renderRoot()[0]).toBe("line-1");
    expect(harness.sendInput("\x03")).toBeUndefined();
    expect(harness.copied).toEqual(["line", "line"]);

    harness.compositor.dispose();
  });

  it("copies multiline selections in forward and backward drag directions", () => {
    const forward = createTerminalSplitHarness({ rootLines: ["alpha", "bravo"] });
    forward.renderRoot();
    forward.sendInput(leftPress(3, 1) + leftDrag(4, 2) + leftRelease(4, 2));
    expect(forward.copied).toEqual(["pha\nbra"]);
    forward.compositor.dispose();

    const backward = createTerminalSplitHarness({ rootLines: ["alpha", "bravo"] });
    backward.renderRoot();
    backward.sendInput(leftPress(4, 2) + leftDrag(2, 1) + leftRelease(2, 1));
    expect(backward.copied).toEqual(["lpha\nbra"]);
    backward.compositor.dispose();
  });

  it("selects and highlights fixed-cluster text", () => {
    const harness = createTerminalSplitHarness({
      rows: 6,
      rootLines: ["chat"],
      cluster: { lines: ["status", "editor"], cursor: null },
    });
    harness.renderRoot();

    harness.sendInput(leftPress(1, 5) + leftDrag(5, 5) + leftRelease(5, 5));

    expect(harness.copied).toEqual(["stat"]);
    harness.compositor.requestRepaint();
    expect(String(harness.originalWrite.mock.calls.at(-1)?.[0] ?? "")).toContain("\x1b[7mstat\x1b[27mus");
    harness.compositor.dispose();
  });

  it("double-click selects an entire line and leaves it highlighted", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-14T12:00:00Z"));
    const harness = createTerminalSplitHarness({ rootLines: ["whole line"] });
    harness.renderRoot();

    harness.sendInput(leftPress(3, 1) + leftRelease(3, 1));
    vi.advanceTimersByTime(100);
    harness.sendInput(leftPress(3, 1) + leftRelease(3, 1));

    expect(harness.copied).toEqual(["whole line"]);
    expect(harness.renderRoot()[0]).toBe("\x1b[7mwhole line\x1b[27m");
    harness.compositor.dispose();
  });

  it("strips OSC controls and respects wide-glyph columns when copying", () => {
    const linkedWideText = "\x1b]8;;https://example.test\x07界ab\x1b]8;;\x07";
    const harness = createTerminalSplitHarness({ rootLines: [linkedWideText] });
    harness.renderRoot();

    harness.sendInput(leftPress(1, 1) + leftDrag(3, 1) + leftRelease(3, 1));

    expect(harness.copied).toEqual(["界"]);
    expect(harness.renderRoot()[0]).toBe("\x1b[7m界\x1b[27mab");
    harness.compositor.dispose();
  });

  it("clears an existing selection when the conversation scrolls", () => {
    const harness = createTerminalSplitHarness({
      rootLines: Array.from({ length: 10 }, (_, index) => `line-${index}`),
    });
    harness.renderRoot();
    harness.sendInput(leftPress(1, 1) + leftDrag(5, 1) + leftRelease(5, 1));
    expect(harness.copied).toHaveLength(1);

    harness.sendInput(wheelUp());
    expect(harness.renderRoot().join("\n")).not.toContain("\x1b[7m");
    harness.sendInput("\x03");
    expect(harness.copied).toHaveLength(1);
    harness.compositor.dispose();
  });

  it("pauses mouse reporting when right-clicking inside a selection", () => {
    vi.useFakeTimers();
    const harness = createTerminalSplitHarness({ rootLines: ["line-1"] });
    harness.renderRoot();
    harness.sendInput(leftPress(1, 1) + leftDrag(5, 1) + leftRelease(5, 1));

    harness.sendInput(rightPress(2, 1));

    expect(harness.copied).toEqual(["line", "line"]);
    expect(String(harness.originalWrite.mock.calls.at(-1)?.[0] ?? "")).toContain("\x1b[?1006l");
    harness.compositor.dispose();
  });

  it("keeps the emergency reset out of alternate-scroll mode", () => {
    expect(emergencyTerminalModeReset()).toContain("\x1b[?1007l");
    expect(emergencyTerminalModeReset()).not.toContain("\x1b[?1007h");
  });
});
