/**
 * Minimal stand-in for upstream's `../modes/theme/theme` used by the vendored
 * LSP formatting helpers in `utils.ts`. Upstream's `theme` is a TUI theme
 * object with color tokens; the vendored LSP code reads only a handful of
 * glyph properties (`nav.cursor`, `format.bullet`/`format.dash`,
 * `status.error`/`warning`/`info`, and a set of `icon.*` kind glyphs). All
 * accesses are `?? fallback`, so plain ASCII glyphs suffice for plain-text
 * output (the `lsp` tool renders text, not a TUI).
 */
export interface Theme {
	nav: { cursor: string };
	format: { bullet: string; dash: string };
	status: { error: string; warning: string; info: string };
	icon: {
		file: string;
		folder: string;
		package: string;
		model: string;
		auto: string;
	};
}

export const theme: Theme = {
	nav: { cursor: "→" },
	format: { bullet: "•", dash: "—" },
	status: { error: "✖", warning: "⚠", info: "ℹ" },
	icon: {
		file: "▤",
		folder: "▸",
		package: "📦",
		model: "◇",
		auto: "ƒ",
	},
};
