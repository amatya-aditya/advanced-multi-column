import {EditorState, StateField, Transaction, Range} from "@codemirror/state";
import {Decoration, DecorationSet, EditorView} from "@codemirror/view";
import {editorLivePreviewField} from "obsidian";
import {findColumnRegions} from "./parser";
import {getPluginInstance} from "./plugin-ref";
import {ColumnWidget} from "./widget";
import type {ColumnRegion} from "./types";

/**
 * Scan the document text for %% col-start %% / %% col-end %% markers
 * and build replace decorations for each column region.
 * Only active in Live Preview mode (not source mode).
 */
function buildDecorations(state: EditorState): DecorationSet {
	try {
		if (!getPluginInstance().settings.enableLivePreview) return Decoration.none;
	} catch {
		return Decoration.none;
	}

	// Don't render widgets in source mode — only live preview
	if (!state.field(editorLivePreviewField, false)) return Decoration.none;

	const doc = state.doc.toString();
	const regions = findColumnRegions(doc);
	const decorations: Range<Decoration>[] = [];

	for (const region of regions) {
		decorations.push(
			Decoration.replace({
				widget: new ColumnWidget(region),
				block: true,
			}).range(region.from, region.to),
		);
	}

	return Decoration.set(decorations, true);
}

/**
 * Detect when the editor switches between source mode and live preview.
 */
function modeChanged(tr: Transaction): boolean {
	const before = tr.startState.field(editorLivePreviewField, false);
	const after = tr.state.field(editorLivePreviewField, false);
	return before !== after;
}

/**
 * Track column regions for atomic range behavior.
 */
const colRegionsField = StateField.define<ColumnRegion[]>({
	create(state) {
		return findColumnRegions(state.doc.toString());
	},
	update(regions, tr) {
		if (tr.docChanged) {
			return findColumnRegions(tr.state.doc.toString());
		}
		return regions;
	},
});

/**
 * Main decoration state field.
 */
const columnDecorationsField = StateField.define<DecorationSet>({
	create(state) {
		return buildDecorations(state);
	},

	update(decorations: DecorationSet, tr: Transaction) {
		if (tr.docChanged || modeChanged(tr)) {
			return buildDecorations(tr.state);
		}
		return decorations;
	},

	provide(field) {
		return EditorView.decorations.from(field);
	},
});

/**
 * Atomic ranges: prevent the cursor from entering column regions.
 * This stops CM6 from collapsing the replace decoration when clicked.
 */
const atomicCol = EditorView.atomicRanges.of((view) => {
	// Only block cursor in live preview — source mode needs free navigation
	if (!view.state.field(editorLivePreviewField, false)) return Decoration.none;

	const regions = view.state.field(colRegionsField, false);
	if (!regions || regions.length === 0) return Decoration.none;

	const decs: Range<Decoration>[] = [];
	for (const r of regions) {
		if (r.from < r.to) {
			decs.push(Decoration.mark({}).range(r.from, r.to));
		}
	}
	return Decoration.set(decs, true);
});

/**
 * Export all extensions as an array.
 */
export const columnDecorations = [
	colRegionsField,
	columnDecorationsField,
	atomicCol,
];
