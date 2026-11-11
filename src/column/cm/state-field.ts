import {EditorState, StateEffect, StateField, Transaction, Range} from "@codemirror/state";
import {Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate} from "@codemirror/view";
import {editorLivePreviewField} from "obsidian";
import {findColumnRegions} from "../core/parser";
import type {ColumnRegion} from "../core/types";
import {isCodeOrMathAt} from "../core/lezer-guard";
import {isStructuralHoldActive, SubEditorSyncAnnotation} from "../core/sync-guard";
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

	const regions = findColumnRegions(doc, {isIgnoredPosition: (pos) => isCodeOrMathAt(state, pos)});
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

		// Edits that touch an existing region change its content. Iterating
		// also catches a point edit strictly inside a replaced block, which
		// RangeSet.between does not report in every CM version.
		const cursor = previous.iter();
		while (cursor.value) {
			if (cursor.from <= toA && cursor.to >= fromA) {
				rescan = true;
				break;
			}
			cursor.next();
		}
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

interface MappedChange {
	from: number;
	to: number;
}

/** Ranges of the new document that the transaction touched. */
function changedRanges(tr: Transaction): MappedChange[] {
	const ranges: MappedChange[] = [];
	tr.changes.iterChanges((_fromA, _toA, fromB, toB) => {
		ranges.push({from: fromB, to: toB});
	});
	return ranges;
}

function overlaps(ranges: ReadonlyArray<MappedChange>, from: number, to: number): boolean {
	for (const range of ranges) {
		if (range.from <= to && range.to >= from) return true;
	}
	return false;
}

/**
 * Keep each reused widget's region offsets in step with mapped decorations.
 * When `state` and `changed` are given, only the touched blocks are re-parsed;
 * this is the in-place path used by real-time sub-editor mirroring and by
 * plugin-initiated undo, where remounting the DOM would destroy the editor.
 */
function syncWidgetPositions(
	decorations: DecorationSet,
	state?: EditorState,
	changed?: ReadonlyArray<MappedChange>,
): void {
	const cursor = decorations.iter();
	while (cursor.value) {
		const widget = (cursor.value.spec as {widget?: unknown}).widget;
		if (widget instanceof ColumnWidget) {
			widget.moveTo(cursor.from, cursor.to);
			if (state && changed && overlaps(changed, cursor.from, cursor.to)) {
				widget.refreshFromDocument(state.doc, state);
			}
		}
		cursor.next();
	}
}

/**
 * Re-parse only the rendered blocks a transaction touched, keeping every
 * other widget (and its DOM) mapped in place. Returns null when the edit can
 * change block structure — a marker inserted/deleted, a block split/merged,
 * or an edit outside every block — in which case the caller does a full scan.
 */
function rebuildTouchedBlocks(
	tr: Transaction,
	mapped: DecorationSet,
): DecorationSet | null {
	const changes = changedRanges(tr);
	if (changes.length === 0) return null;

	const covered = new Set<number>();
	const decorations: Range<Decoration>[] = [];
	const cursor = mapped.iter();
	while (cursor.value) {
		const from = cursor.from;
		const to = cursor.to;
		const value = cursor.value;
		const touched: number[] = [];
		for (let i = 0; i < changes.length; i++) {
			const change = changes[i]!;
			if (change.from <= to && change.to >= from) touched.push(i);
		}
		if (touched.length === 0) {
			decorations.push(value.range(from, to));
			cursor.next();
			continue;
		}
		for (const i of touched) covered.add(i);

		const source = tr.state.doc.sliceString(from, to);
		if (!source.includes("col-start")) return null;
		const regions = findColumnRegions(source, {
			isIgnoredPosition: (pos) => isCodeOrMathAt(tr.state, from + pos),
		});
		const parsed = regions.length === 1 ? regions[0]! : null;
		if (!parsed || parsed.from !== 0 || parsed.to !== source.length) return null;

		const region: ColumnRegion = {
			...parsed,
			from,
			to,
			columnContentRanges: parsed.columnContentRanges.map(
				([start, end]) => [start + from, end + from] as [number, number],
			),
		};
		const widget = new ColumnWidget(region, source, renderGeneration);
		decorations.push(Decoration.replace({widget, block: true}).range(from, to));
		cursor.next();
	}

	// An edit outside every rendered block may have created a new block.
	if (covered.size !== changes.length) return null;
	return Decoration.set(decorations, true);
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
		const changed = changedRanges(tr);

		// A mirrored sub-editor transaction or a plugin-initiated undo must not
		// rebuild the block: that would destroy the open embedded editor.
		if (tr.annotation(SubEditorSyncAnnotation) === true || isStructuralHoldActive()) {
			syncWidgetPositions(mapped, tr.state, changed);
			return mapped;
		}

		if (!needsRescan(tr, decorations)) {
			syncWidgetPositions(mapped);
			return mapped;
		}

		// Re-parse only the intersecting block(s); everything above and below
		// is mapped through the transaction untouched.
		const incremental = rebuildTouchedBlocks(tr, mapped);
		if (incremental) {
			syncWidgetPositions(incremental);
			return incremental;
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
			if (iState.activeEdit.contentStart !== undefined) {
				iState.activeEdit.contentStart = update.changes.mapPos(iState.activeEdit.contentStart, -1);
			}
			if (iState.activeEdit.contentEnd !== undefined) {
				iState.activeEdit.contentEnd = update.changes.mapPos(iState.activeEdit.contentEnd, 1);
			}
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

/** Document ranges of the column blocks rendered in live preview, in order. */
export function columnBlocks(state: EditorState): {from: number; to: number}[] {
	const blocks: {from: number; to: number}[] = [];
	const cursor = (state.field(columnDecorationField, false) ?? Decoration.none).iter();
	while (cursor.value) {
		blocks.push({from: cursor.from, to: cursor.to});
		cursor.next();
	}
	return blocks;
}

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
