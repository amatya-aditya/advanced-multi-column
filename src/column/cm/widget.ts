import {WidgetType, EditorView} from "@codemirror/view";
import {Component, editorInfoField} from "obsidian";
import {ColumnEditorSuggest} from "../editor/editor-suggest";
import {applyContainerStyle} from "../core/column-style";
import type {ColumnRegion} from "../core/types";
import {isInteractivePreviewTarget} from "../core/widget-types";
import {bindRegionToDom} from "../core/region-position";
import {buildColumns} from "../render/column-renderer";

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
	readonly source: string;
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
		this.region.from = from;
		this.region.to = to;
	}

	get estimatedHeight(): number {
		if (this.heightEstimate < 0) this.heightEstimate = estimateRegionHeight(this.region);
		return this.heightEstimate;
	}

	eq(other: ColumnWidget): boolean {
		return this.source === other.source && this.generation === other.generation;
	}

	toDOM(view: EditorView): HTMLElement {
		const doc = view.dom.doc;
		const host = doc.createElement("div");
		host.className = "amc-columns-host";
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
