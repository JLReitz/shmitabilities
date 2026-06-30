/**
 * Minimal stand-in for upstream's `../tools/grouped-file-output`
 * `formatGroupedFiles`, used by the vendored LSP diagnostics formatter to
 * group diagnostic lines by file. Upstream builds a full directory path tree
 * (`buildPathTree`/`walkPathTree` from `@oh-my-pi/pi-utils`); this shim emits
 * a simpler `## <file>` header per file followed by the section's model
 * lines — same logical structure (file → its diagnostics) without the tree
 * machinery or the `@oh-my-pi/pi-utils` dependency.
 */
export interface GroupedFileSection {
	headerSuffix?: string;
	modelLines: string[];
	displayLines?: string[];
	skip?: boolean;
}

export interface GroupedFilesOutput {
	model: string[];
	display: string[];
}

export function formatGroupedFiles(
	files: string[],
	renderFile: (filePath: string) => GroupedFileSection,
): GroupedFilesOutput {
	const model: string[] = [];
	const display: string[] = [];
	let emitted = false;
	for (const filePath of files) {
		const section = renderFile(filePath);
		if (section.skip) continue;
		if (emitted) {
			model.push("");
			display.push("");
		}
		emitted = true;
		const header = `## ${filePath}${section.headerSuffix ?? ""}`;
		model.push(header, ...section.modelLines);
		display.push(header, ...(section.displayLines ?? section.modelLines));
	}
	return { model, display };
}
