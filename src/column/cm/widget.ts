import {WidgetType, EditorView} from "@codemirror/view";
import {Component} from "obsidian";
import {ColumnEditorSuggest} from "../editor/editor-suggest";
import {applyContainerStyle} from "../core/column-style";
import type {ColumnRegion} from "../core/types";
import {isSameStyle, isInteractivePreviewTarget} from "../core/widget-types";
import {buildColumns} from "../render/column-renderer";

// ── Widget ──────────────────────────────────────────────────────

export class ColumnWidget extends WidgetType {
	private region: ColumnRegion;
	private components: Component[] = [];
	private suggests: ColumnEditorSuggest[] = [];

	constructor(region: ColumnRegion) {
		super();
		this.region = region;
	}

	get estimatedHeight(): number {
		return 120;
	}

	eq(other: ColumnWidget): boolean {
		if (this.region.from !== other.region.from) return false;
		if (this.region.to !== other.region.to) return false;
		if (!isSameStyle(this.region.containerStyle, other.region.containerStyle)) return false;
		if (this.region.columns.length !== other.region.columns.length) return false;
		for (let i = 0; i < this.region.columns.length; i++) {
			const a = this.region.columns[i]!;
			const b = other.region.columns[i]!;
			if (a.content !== b.content || a.widthPercent !== b.widthPercent) return false;
			if ((a.stacked ?? 0) !== (b.stacked ?? 0)) return false;
			if (!isSameStyle(a.style, b.style)) return false;
		}
		return true;
	}

	toDOM(view: EditorView): HTMLElement {
		const container = document.createElement("div");
		container.className = "columns-container columns-ui";
		applyContainerStyle(container, this.region.containerStyle);

		container.addEventListener("mousedown", (e) => {
			const target = e.target as HTMLElement;
			if (isInteractivePreviewTarget(target, container)) return;
			e.preventDefault();
		});

		buildColumns(container, {
			region: this.region,
			view,
			components: this.components,
			suggests: this.suggests,
		});
		return container;
	}

	updateDOM(dom: HTMLElement, view: EditorView): boolean {
		this.cleanupComponents();
		dom.className = "columns-container columns-ui";
		applyContainerStyle(dom, this.region.containerStyle);
		dom.empty();
		buildColumns(dom, {
			region: this.region,
			view,
			components: this.components,
			suggests: this.suggests,
		});
		return true;
	}

	destroy(): void {
		this.cleanupComponents();
	}

	ignoreEvent(): boolean {
		return true;
	}

	private cleanupComponents(): void {
		for (const c of this.components) c.unload();
		this.components = [];
		for (const s of this.suggests) s.destroy();
		this.suggests = [];
	}
}
