import {EditorState, StateField, Transaction, Range} from "@codemirror/state";
import {Decoration, DecorationSet, EditorView} from "@codemirror/view";
import {editorLivePreviewField} from "obsidian";
import {findColumnRegions} from "../core/parser";
import {getPluginInstance} from "../core/plugin-ref";
import {ColumnWidget} from "./widget";

interface ColumnRenderState {
	decorations: DecorationSet;
	atomicRanges: DecorationSet;
}

const EMPTY_COLUMN_RENDER_STATE: ColumnRenderState = {
	decorations: Decoration.none,
	atomicRanges: Decoration.none,
};

/**
 * Scan the document text for %% col-start %% / %% col-end %% markers
 * and build replace decorations for each column region.
 * Only active in Live Preview mode (not source mode).
 */
function shouldRenderColumns(state: EditorState): boolean {
	try {
		if (!getPluginInstance().settings.enableLivePreview) return false;
	} catch {
		return false;
	}

	// Don't render widgets in source mode — only live preview
	return state.field(editorLivePreviewField, false) === true;
}

function buildColumnRenderState(state: EditorState): ColumnRenderState {
	if (!shouldRenderColumns(state)) return EMPTY_COLUMN_RENDER_STATE;

	const doc = state.doc.toString();
	if (!doc.includes("col-start")) return EMPTY_COLUMN_RENDER_STATE;

	const regions = findColumnRegions(doc);
	if (regions.length === 0) return EMPTY_COLUMN_RENDER_STATE;

	const decorations: Range<Decoration>[] = [];
	const atomicRanges: Range<Decoration>[] = [];
	for (const region of regions) {
		decorations.push(
			Decoration.replace({
				widget: new ColumnWidget(region),
				block: true,
			}).range(region.from, region.to),
		);
		if (region.from < region.to) {
			atomicRanges.push(Decoration.mark({}).range(region.from, region.to));
		}
	}

	return {
		decorations: Decoration.set(decorations, true),
		atomicRanges: Decoration.set(atomicRanges, true),
	};
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
 * Main decoration state field.
 */
const columnRenderStateField = StateField.define<ColumnRenderState>({
	create(state) {
		return buildColumnRenderState(state);
	},

	update(renderState: ColumnRenderState, tr: Transaction) {
		if (tr.docChanged || modeChanged(tr)) {
			return buildColumnRenderState(tr.state);
		}
		return renderState;
	},

	provide(field) {
		return EditorView.decorations.from(field, (value) => value.decorations);
	},
});

/**
 * Atomic ranges: prevent the cursor from entering column regions.
 * This stops CM6 from collapsing the replace decoration when clicked.
 */
const atomicCol = EditorView.atomicRanges.of((view) => {
	const renderState = view.state.field(columnRenderStateField, false);
	return renderState?.atomicRanges ?? Decoration.none;
});

/**
 * Export all extensions as an array.
 */
export const columnDecorations = [
	columnRenderStateField,
	atomicCol,
];
