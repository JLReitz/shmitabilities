/**
 * Pi extension entry point for the LSP-and-edit-tools package.
 *
 * Phase 1 ships two tools sharing a single in-memory snapshot store and a
 * Node.js filesystem adapter:
 *
 *   - `hashline_read`  — mints `[path#TAG]` content-hash anchors (producer).
 *   - `hashline_edit`  — applies hashline patches anchored to those tags.
 *
 * The snapshot store is process-local: tags are only ever produced and
 * consumed by these two tools via `SnapshotStore.record`, so the
 * `node:crypto`-based tag format (which diverges from upstream's xxHash32) is
 * internally consistent. See README.md for the divergence note.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { InMemorySnapshotStore } from "@oh-my-pi/hashline";
import { NodeFilesystem } from "./node-filesystem";
import { createHashlineEdit } from "./hashline-edit";
import { createHashlineRead } from "./hashline-read";
import { createAstGrep } from "./ast-grep";
import { createAstEdit } from "./ast-edit";
import { createWritethroughFactory } from "./lsp-writethrough";
import { createLspTool } from "./lsp-tool";

export default function (pi: ExtensionAPI): void {
	// One shared store + filesystem so read-minted tags validate at edit time.
	const fs = new NodeFilesystem();
	const snapshots = new InMemorySnapshotStore();

	// Phase 4 stage 4a: one shared LSP writethrough factory, resolved per cwd
	// from `.pi/shmit.json` (project) + `~/.pi/shmit.json` (user). Injected
	// into `ast_edit` (full writethrough: format + diagnostics per settings)
	// and `hashline_edit` (diagnostics-only, `enableFormat:false` so returned
	// content-hash tags stay valid). When `lsp.enabled` is false the factory
	// falls back to `writethroughNoop` / no pass — the tools keep working.
	const writethrough = createWritethroughFactory();

	pi.registerTool(createHashlineRead({ fs, snapshots }));
	pi.registerTool(createHashlineEdit({ fs, snapshots, diagnosticsSource: writethrough }));
	pi.registerTool(createAstGrep());
	pi.registerTool(createAstEdit({ writethroughSource: writethrough }));
	// Phase 4 stages 4b + 4c: the `lsp` tool. Ships all 14 actions — the 9
	// read-only actions (status, capabilities, diagnostics, hover, definition,
	// type_definition, implementation, references, symbols) plus the 5
	// write-tier actions (rename, rename_file, code_actions, reload, request).
	// Single `lsp` tool ships all 14 actions (no per-tool approval tier in
	// stock pi; write safety enforced inside runLspAction via `apply`).
	pi.registerTool(createLspTool());
}
