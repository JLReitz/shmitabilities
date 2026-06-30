import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export const CURSOR_MARKER = "\x1b_pi:c\x07";

export interface FixedEditorClusterInput {
  width: number;
  terminalRows: number;
  statusLines?: string[];
  errorLines?: string[];
  aboveWidgetLines?: string[];
  editorLines: string[];
  footerLines?: string[];
}

export interface FixedEditorCursor {
  row: number;
  col: number;
}

export interface FixedEditorClusterRender {
  lines: string[];
  cursor: FixedEditorCursor | null;
}

function normalizeLines(lines: string[] | undefined, width: number): string[] {
  if (!lines || width <= 0) return [];

  return lines
    .filter((line) => line !== undefined && line !== null)
    .map((line) => visibleWidth(line) > width ? truncateToWidth(line, width, "", true) : line);
}

function takeTail(lines: string[], count: number): string[] {
  if (count <= 0) return [];
  return lines.length <= count ? lines : lines.slice(lines.length - count);
}

function capEditorLines(lines: string[], count: number): string[] {
  if (count <= 0) return [];
  if (lines.length <= count) return lines;

  const cursorRow = lines.findIndex((line) => line.includes(CURSOR_MARKER));
  if (cursorRow !== -1) {
    const start = Math.max(0, Math.min(cursorRow - count + 1, lines.length - count));
    return lines.slice(start, start + count);
  }

  const selectedRow = lines.findIndex((line) => line.replace(/\x1b\[[0-9;]*m/g, "").trimStart().startsWith("→ "));
  if (selectedRow === -1) {
    return lines.slice(0, count);
  }

  const start = Math.max(0, Math.min(selectedRow - Math.floor(count / 2), lines.length - count));
  return lines.slice(start, start + count);
}

function extractCursor(lines: string[]): FixedEditorClusterRender {
  let cursor: FixedEditorCursor | null = null;
  const cleaned = lines.map((line, row) => {
    const markerIndex = line.indexOf(CURSOR_MARKER);
    if (markerIndex === -1) return line;

    if (!cursor) {
      cursor = {
        row,
        col: visibleWidth(line.slice(0, markerIndex)),
      };
    }

    return line.slice(0, markerIndex) + line.slice(markerIndex + CURSOR_MARKER.length);
  });

  return { lines: cleaned, cursor };
}

export function renderFixedEditorCluster(input: FixedEditorClusterInput): FixedEditorClusterRender {
  const width = Math.max(1, input.width);
  const terminalRows = Math.max(1, input.terminalRows);
  const statusLines = normalizeLines(input.statusLines, width);
  const errorLines = normalizeLines(input.errorLines, width);
  const aboveWidgetLines = normalizeLines(input.aboveWidgetLines, width);
  const editorSource = normalizeLines(input.editorLines, width);
  const footerLines = normalizeLines(input.footerLines, width);

  let remaining = terminalRows;
  const footer = takeTail(footerLines, remaining);
  remaining -= footer.length;

  const error = takeTail(errorLines, remaining);
  remaining -= error.length;

  const editorLines = capEditorLines(editorSource, remaining);
  remaining -= editorLines.length;

  const aboveWidget = takeTail(aboveWidgetLines, remaining);
  remaining -= aboveWidget.length;

  const status = takeTail(statusLines, remaining);
  const editorResult = extractCursor(editorLines);

  return {
    lines: [
      ...status,
      ...error,
      ...aboveWidget,
      ...editorResult.lines,
      ...footer,
    ],
    cursor: editorResult.cursor
      ? { row: status.length + error.length + aboveWidget.length + editorResult.cursor.row, col: editorResult.cursor.col }
      : null,
  };
}
