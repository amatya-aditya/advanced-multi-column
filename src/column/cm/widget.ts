import {WidgetType, EditorView} from "@codemirror/view";
import type {EditorState} from "@codemirror/state";
import {Component, editorInfoField} from "obsidian";
import {ColumnEditorSuggest} from "../editor/editor-suggest";
import {applyContainerStyle} from "../core/column-style";
import type {ColumnRegion} from "../core/types";
import {isInteractivePreviewTarget} from "../core/widget-types";
import {bindRegionToDom} from "../core/region-position";
import {buildColumns} from "../render/column-renderer";
import {findColumnRegions} from "../core/parser";
import {isCodeOrMathAt} from "../core/lezer-guard";

/** Everything a rendered widget DOM owns, released when CodeMirror drops it. */
interface MountedColumns {
	components: Component[];
	suggests: ColumnEditorSuggest[];
}

// Keyed by DOM rather than by widget: CodeMirror may hand an existing DOM to
// an equal replacement widget and later destroy it through either instance.
const mountedByDom = new WeakMap<HTMLElement, MountedColumns>();

function estimateRegionHeight(region: ColumnRegion): number {
	let maxLines = 1;
	for (const col of region.columns) {
		let lines = 1;
		for (let i = 0; i < col.content.length; i++) {
			if (col.content.charCodeAt(i) === 10) lines++;
		}
		if (lines > maxLines) maxLines = lines;
	}
	return Math.min(4000, 48 + maxLines * 26);
}

export class ColumnWidget extends WidgetType {
	/** Region offsets are kept current while the block only moves (see moveTo). */
	readonly region: ColumnRegion;
	source: string;
	readonly generation: number;
	private heightEstimate = -1;

	constructor(region: ColumnRegion, source: string, generation: number) {
		super();
		this.region = region;
		this.source = source;
		this.generation = generation;
	}

	/** Update offsets after the block moved without its source changing. */
	moveTo(from: number, to: number): void {
		const delta = from - this.region.from;
		this.region.from = from;
		this.region.to = to;
		if (delta !== 0) {
			this.region.columnContentRanges = this.region.columnContentRanges.map(
				([start, end]) => [start + delta, end + delta] as [number, number],
			);
		}
	}

	/**
	 * Re-read this block from the live document without remounting its DOM.
	 * Used for real-time sub-editor mirroring and for plugin-initiated undo,
	 * where the widget (and an open embedded editor) must survive the change.
	 * Nested offsets in the parsed block are shifted to document coordinates.
	 */
	refreshFromDocument(doc: {sliceString(from: number, to: number): string}, state?: EditorState): boolean {
		const {from, to} = this.region;
		if (from < 0 || to < from) return false;
		const source = doc.sliceString(from, to);
		const regions = findColumnRegions(source, state
			? {isIgnoredPosition: (rel) => isCodeOrMathAt(state, from + rel)}
			: {});
		const parsed = regions.find((region) => region.from === 0 && region.to === source.length)
			?? (regions.length === 1 ? regions[0]! : null);
		if (!parsed) return false;
		const shift = from;
		this.region.columns = parsed.columns;
		this.region.containerStyle = parsed.containerStyle;
		this.region.layout = parsed.layout;
		this.region.mocId = parsed.mocId;
		this.region.virtual = parsed.virtual;
		this.region.lineStart = parsed.lineStart;
		this.region.lineEnd = parsed.lineEnd;
		this.region.columnLineRanges = parsed.columnLineRanges;
		this.region.columnContentRanges = parsed.columnContentRanges.map(
			([start, end]) => [start + shift, end + shift] as [number, number],
		);
		this.source = source;
		return true;
	}

	get estimatedHeight(): number {
		if (this.heightEstimate < 0) this.heightEstimate = estimateRegionHeight(this.region);
		return this.heightEstimate;
	}

	eq(other: ColumnWidget): boolean {
		return this.source === other.source && this.generation === other.generation;
	}

	toDOM(view: EditorView): HTMLElement {
		const host = createDiv({cls: "amc-columns-host"});
		const container = host.createDiv({cls: "columns-container columns-ui"});
		applyContainerStyle(container, this.region.containerStyle);

		container.addEventListener("mousedown", (e) => {
			const target = e.target as HTMLElement;
			// Never swallow events inside the embedded live-preview editor —
			// it needs native mousedown for caret placement and selection.
			if (target.closest(".amc-embedded-editor")) return;
			if (isInteractivePreviewTarget(target, container)) return;
			e.preventDefault();
		});

		const mounted: MountedColumns = {components: [], suggests: []};
		mountedByDom.set(host, mounted);
		bindRegionToDom(this.region, view, host);

		buildColumns(container, {
			region: this.region,
			source: this.source,
			view,
			sourcePath: view.state.field(editorInfoField, false)?.file?.path ?? "",
			components: mounted.components,
			suggests: mounted.suggests,
		});
		return host;
	}

	// Intentionally use WidgetType.updateDOM's default `false` result: a changed
	// source rebuilds the whole block, and CodeMirror destroys the old DOM.
	destroy(dom: HTMLElement): void {
		const mounted = mountedByDom.get(dom);
		if (!mounted) return;
		mountedByDom.delete(dom);
		for (const c of mounted.components) c.unload();
		mounted.components.length = 0;
		for (const s of mounted.suggests) s.destroy();
		mounted.suggests.length = 0;
	}

	ignoreEvent(): boolean {
		return true;
	}
}
