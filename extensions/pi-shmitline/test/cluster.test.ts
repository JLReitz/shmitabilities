import { describe, it, expect } from "vitest";
import { renderFixedEditorCluster, CURSOR_MARKER } from "../src/components/cluster.ts";

describe("cluster", () => {
  describe("renderFixedEditorCluster", () => {
    it("should render empty cluster when no lines provided", () => {
      const result = renderFixedEditorCluster({
        width: 80,
        terminalRows: 24,
        editorLines: [],
      });
      expect(result.lines).toEqual([]);
      expect(result.cursor).toBeNull();
    });

    it("should render editor lines at the bottom of the cluster", () => {
      const result = renderFixedEditorCluster({
        width: 80,
        terminalRows: 24,
        editorLines: ["line1", "line2", "line3"],
      });
      expect(result.lines).toEqual(["line1", "line2", "line3"]);
    });

    it("should place runtime errors above the editor", () => {
      const result = renderFixedEditorCluster({
        width: 80,
        terminalRows: 24,
        errorLines: ["「statusScript exited with code 1", "/tmp/script.sh」"],
        editorLines: ["editor1"],
      });
      expect(result.lines).toEqual([
        "「statusScript exited with code 1",
        "/tmp/script.sh」",
        "editor1",
      ]);
    });

    it("should keep status lines ahead of runtime errors and above-widget content", () => {
      const result = renderFixedEditorCluster({
        width: 80,
        terminalRows: 24,
        statusLines: ["status1"],
        errorLines: ["「script error」"],
        aboveWidgetLines: ["widget1"],
        editorLines: ["editor1"],
      });
      expect(result.lines).toEqual(["status1", "「script error」", "widget1", "editor1"]);
    });

    it("should truncate long lines by visible width", () => {
      const longLine = "x".repeat(100);
      const result = renderFixedEditorCluster({
        width: 80,
        terminalRows: 24,
        editorLines: [longLine],
      });
      expect(result.lines[0]).toBeDefined();
    });

    it("should track cursor position with preceding error lines", () => {
      const editorLines = ["line1", `${CURSOR_MARKER}line2`, "line3"];
      const result = renderFixedEditorCluster({
        width: 80,
        terminalRows: 24,
        errorLines: ["「script error」"],
        editorLines,
      });
      expect(result.cursor).not.toBeNull();
      expect(result.cursor!.row).toBe(2);
      expect(result.cursor!.col).toBe(0);
      expect(result.lines[2]).toBe("line2");
    });

    it("should cap the editor to the remaining viewport rows", () => {
      const editorLines = Array.from({ length: 100 }, (_, i) => `line${i}`);
      const result = renderFixedEditorCluster({
        width: 80,
        terminalRows: 4,
        errorLines: ["「script error」"],
        editorLines,
      });
      expect(result.lines.length).toBeLessThanOrEqual(4);
      expect(result.lines[result.lines.length - 1]).toBe("line2");
    });

    it("should preserve footer lines at the bottom", () => {
      const result = renderFixedEditorCluster({
        width: 80,
        terminalRows: 24,
        editorLines: ["editor1"],
        footerLines: ["footer"],
      });
      expect(result.lines).toEqual(["editor1", "footer"]);
    });
  });
});
