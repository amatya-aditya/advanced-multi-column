import {EditorState, StateEffect, StateField, Transaction, Range} from "@codemirror/state";
import {Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate} from "@codemirror/view";
import {editorLivePreviewField} from "obsidian";
import {findColumnRegions} from "../core/parser";
import {getPluginInstance} from "../core/plugin-ref";
import {getInteractionState} from "../editor/interaction-state";
import {ColumnWidget} from "./widget";

/**
 * Forces every column widget to rebuild, e.g. after a settings change that
 * affects rendering. Dispatch with `refreshColumnWidgets(view)`.
 */
const refreshColumnsEffect = StateEffect.define<null>();

/** Bumped on every forced refresh so equal-source widgets still re-render. */
let renderGeneration = 0;

function shouldRenderColumns(state: EditorState): boolean {
	try {
		if (!getPluginInstance().settings.enableLivePreview) return false;
	} catch {
		return false;
	}

	// Don't render widgets in source mode — only live preview
	return state.field(editorLivePreviewField, false) === true;
}

/** Widgets from the previous decorations that a rescan may hand to new regions. */
class ReusableWidgets {
	private readonly bySource = new Map<string, ColumnWidget[]>();
	private readonly used = new Set<ColumnWidget>();

	constructor(private readonly mapped: DecorationSet | null, unmapped: DecorationSet | null) {
		const cursor = (unmapped ?? Decoration.none).iter();
		while (cursor.value) {
			const widget = (cursor.value.spec as {widget?: unknown}).widget;
			if (widget instanceof ColumnWidget && widget.generation === renderGeneration) {
				const list = this.bySource.get(widget.source) ?? [];
				list.push(widget);
				this.bySource.set(widget.source, list);
			}
			cursor.next();
		}
	}

	/**
	 * Prefer the widget that mapped exactly onto this region; otherwise any
	 * unused widget with identical source (e.g. after a whole-file reload,
	 * which deletes every mapped decoration).
	 */
	take(from: number, to: number, source: string): ColumnWidget | null {
		let match: ColumnWidget | null = null;
		this.mapped?.between(from, from, (decoFrom, decoTo, deco) => {
			const widget = (deco.spec as {widget?: unknown}).widget;
			if (
				decoFrom === from
				&& decoTo === to
				&& widget instanceof ColumnWidget
				&& widget.source === source
				&& widget.generation === renderGeneration
				&& !this.used.has(widget)
			) {
				match = widget;
				return false;
			}
			return undefined;
		});
		if (!match) {
			match = this.bySource.get(source)?.find((widget) => !this.used.has(widget)) ?? null;
		}
		if (match) this.used.add(match);
		return match;
	}
}

/**
 * Scan the document for column regions and build one block widget per region.
 * Widgets from `previous` (already mapped through the transaction) are reused
 * when their source text is unchanged, so CodeMirror keeps their DOM — and any
 * open column editor — instead of re-rendering the whole block.
 */
function buildDecorations(
	state: EditorState,
	mapped: DecorationSet | null,
	unmapped: DecorationSet | null,
): DecorationSet {
	if (!shouldRenderColumns(state)) return Decoration.none;

	const doc = state.doc.toString();
	if (!doc.includes("col-start")) return Decoration.none;

	const regions = findColumnRegions(doc);
	if (regions.length === 0) return Decoration.none;

	const reusable = new ReusableWidgets(mapped, unmapped);
	const decorations: Range<Decoration>[] = [];
	for (const region of regions) {
		const source = doc.slice(region.from, region.to);
		const reused = reusable.take(region.from, region.to, source);
		const widget = reused ?? new ColumnWidget(region, source, renderGeneration);
		if (reused) reused.moveTo(region.from, region.to);
		decorations.push(
			Decoration.replace({widget, block: true}).range(region.from, region.to),
		);
	}
	return Decoration.set(decorations, true);
}

const MARKER_HINT_RE = /%%|col-(?:start|break|end)/;

/**
 * Whether a document change can affect where column regions start or end.
 * Plain typing outside every region, on lines without comment markers, only
 * shifts positions — the existing decorations can simply be mapped.
 */
function needsRescan(tr: Transaction, previous: DecorationSet): boolean {
	let rescan = false;
	tr.changes.iterChanges((fromA, toA, fromB, toB) => {
		if (rescan) return;

		// Edits that touch an existing region change its content.
		previous.between(fromA, toA, (decoFrom, decoTo) => {
			if (decoFrom <= toA && decoTo >= fromA) {
				rescan = true;
				return false;
			}
			return undefined;
		});
		if (rescan) return;

		// Deleted text may have contained a marker.
		if (toA > fromA && MARKER_HINT_RE.test(tr.startState.doc.sliceString(fromA, toA))) {
			rescan = true;
			return;
		}

		// The edited lines may now form a marker.
		const doc = tr.state.doc;
		const lineFrom = doc.lineAt(fromB).from;
		const lineTo = doc.lineAt(toB).to;
		if (MARKER_HINT_RE.test(doc.sliceString(lineFrom, lineTo))) {
			rescan = true;
		}
	});
	return rescan;
}

/** Keep each reused widget's region offsets in step with mapped decorations. */
function syncWidgetPositions(decorations: DecorationSet): void {
	const cursor = decorations.iter();
	while (cursor.value) {
		const widget = (cursor.value.spec as {widget?: unknown}).widget;
		if (widget instanceof ColumnWidget) widget.moveTo(cursor.from, cursor.to);
		cursor.next();
	}
}

function modeChanged(tr: Transaction): boolean {
	const before = tr.startState.field(editorLivePreviewField, false);
	const after = tr.state.field(editorLivePreviewField, false);
	return before !== after;
}

function hasRefreshEffect(tr: Transaction): boolean {
	return tr.effects.some((effect) => effect.is(refreshColumnsEffect));
}

const columnDecorationField = StateField.define<DecorationSet>({
	create(state) {
		return buildDecorations(state, null, null);
	},

	update(decorations: DecorationSet, tr: Transaction) {
		if (hasRefreshEffect(tr) || modeChanged(tr)) {
			return buildDecorations(tr.state, null, null);
		}
		if (!tr.docChanged) return decorations;

		const mapped = decorations.map(tr.changes);
		if (!needsRescan(tr, decorations)) {
			syncWidgetPositions(mapped);
			return mapped;
		}
		return buildDecorations(tr.state, mapped, decorations);
	},

	provide(field) {
		return EditorView.decorations.from(field);
	},
});

/**
 * Map interaction state that stores document offsets (open column editor,
 * in-flight drag) through every change, so a widget rebuilt later in the same
 * update still finds its open editor. View plugins update before the DOM is
 * redrawn, which is when widgets are rebuilt.
 */
const interactionPositionTracker = ViewPlugin.fromClass(class {
	update(update: ViewUpdate): void {
		if (!update.docChanged) return;
		const iState = getInteractionState(update.view);
		if (iState.activeEdit) {
			iState.activeEdit.regionFrom = update.changes.mapPos(iState.activeEdit.regionFrom, -1);
		}
		if (iState.activeDragState) {
			iState.activeDragState.sourceRegionFrom = update.changes.mapPos(
				iState.activeDragState.sourceRegionFrom,
				-1,
			);
		}
	}
});

/**
 * Keep the main editor's cursor out of rendered column blocks: text typed at a
 * position inside a block would silently land in its hidden source.
 */
const atomicColumns = EditorView.atomicRanges.of(
	(view) => view.state.field(columnDecorationField, false) ?? Decoration.none,
);

/** Rebuild all column widgets in the given editors (e.g. after a settings change). */
export function refreshColumnWidgets(views: Iterable<EditorView>): void {
	renderGeneration++;
	for (const view of views) {
		view.dispatch({effects: refreshColumnsEffect.of(null)});
	}
}

/**
 * Export all extensions as an array.
 */
export const columnDecorations = [
	columnDecorationField,
	atomicColumns,
	interactionPositionTracker,
];
