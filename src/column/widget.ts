import {WidgetType, EditorView} from "@codemirror/view";
import {Component, MarkdownRenderer} from "obsidian";
import {findColumnRegions, serializeColumns} from "./parser";
import {getPluginInstance} from "./plugin-ref";
import {ColumnEditorSuggest, handleAutoPair, handleMarkdownShortcut} from "./editor-suggest";
import {openColumnStyleContextMenu} from "./style-context-menu";
import {applyColumnStyle, applyContainerStyle} from "./column-style";
import type {ColumnData, ColumnRegion, ColumnStyleData} from "./types";

interface ColumnContextActions {
	addColumn?: () => void;
	addChild?: () => void;
}

interface ContainerPathEntry {
	columnIndex: number;
	regionIndex: number;
}

type ContainerPath = ContainerPathEntry[];

// ── Module-level editing state (survives widget re-renders) ─────
interface ActiveEditState {
	regionFrom: number;
	columnIndex: number;
	cursorStart: number;
	cursorEnd: number;
	scrollTop: number;
	value: string;
}

let activeEdit: ActiveEditState | null = null;

interface ActiveDragState {
	sourceRegionFrom: number;
	sourcePath: ContainerPath;
	sourceIndex: number;
	dropHandled: boolean;
}

let activeDragState: ActiveDragState | null = null;
let activeDragPoint: {x: number; y: number} | null = null;
let cleanupActiveDragTracking: (() => void) | null = null;

const BLOCK_LANGUAGE_PREVIEW_SELECTOR = [
	".el-pre",
	"pre",
	"[class*='block-language-']",
].join(",");

const INTERACTIVE_PREVIEW_SELECTOR = [
	"a",
	"button",
	"input",
	"textarea",
	"select",
	"label",
	"summary",
	"details",
	"video",
	"audio",
	"iframe",
	"canvas",
	"[role='button']",
	"[role='link']",
	"[role='slider']",
	"[role='switch']",
	"[role='checkbox']",
	"[role='tab']",
	"[role='menuitem']",
	".clickable-icon",
	".mod-slider",
	".slider",
	".markdown-embed",
	".internal-embed",
	".media-embed",
	".image-embed",
	BLOCK_LANGUAGE_PREVIEW_SELECTOR,
].join(",");

function isSameStyle(a: ColumnData["style"], b: ColumnData["style"]): boolean {
	return (
		a?.background === b?.background &&
		a?.borderColor === b?.borderColor &&
		a?.textColor === b?.textColor &&
		a?.showBorder === b?.showBorder &&
		a?.horizontalDividers === b?.horizontalDividers
	);
}

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
			if (!isSameStyle(a.style, b.style)) return false;
		}
		return true;
	}

	toDOM(view: EditorView): HTMLElement {
		const container = document.createElement("div");
		container.className = "columns-container columns-ui";
		applyContainerStyle(container, this.region.containerStyle);

		// Block mousedown from reaching CM6 — prevents cursor placement
		// inside the replaced range. Allow textareas to receive focus.
		container.addEventListener("mousedown", (e) => {
			const target = e.target as HTMLElement;
			if (this.isInteractivePreviewTarget(target, container)) return;
			e.preventDefault();
		});

		this.buildUI(container, view);
		return container;
	}

	updateDOM(dom: HTMLElement, view: EditorView): boolean {
		this.cleanupComponents();
		dom.className = "columns-container columns-ui";
		applyContainerStyle(dom, this.region.containerStyle);
		dom.empty();
		this.buildUI(dom, view);
		return true;
	}

	destroy(): void {
		this.cleanupComponents();
	}

	ignoreEvent(): boolean {
		return true;
	}

	// ── Build Full UI ────────────────────────────────────────────

	private buildUI(container: HTMLElement, view: EditorView): void {
		this.buildColumns(container, view);
	}

	// ── Column Rendering ─────────────────────────────────────────

	private buildColumns(container: HTMLElement, view: EditorView): void {
		const {columns} = this.region;
		const plugin = getPluginInstance();
		const activeFile = plugin.app.workspace.getActiveFile();
		const sourcePath = activeFile?.path ?? "";

		for (let i = 0; i < columns.length; i++) {
			const col = columns[i]!;
			const hasNestedRegions = findColumnRegions(col.content).length > 0;

			// Resize handle between columns
			if (i > 0) {
				this.buildResizeHandle(container, i - 1, columns, view);
			}

			// Column element – use flex: 1 for equal; explicit width if set
			const colEl = document.createElement("div");
			colEl.className = "column-item";
			if (col.widthPercent > 0) {
				// Account for resize handle width (8px effective each) between columns
				const handleTotal = (columns.length - 1) * 8;
				const shrink = handleTotal / columns.length;
				colEl.style.flex = `0 0 calc(${col.widthPercent}% - ${shrink.toFixed(1)}px)`;
			}
			applyColumnStyle(colEl, col.style);
			colEl.dataset.colIndex = String(i);
			container.appendChild(colEl);

			// Header row (drag handle + add/remove buttons)
			const header = document.createElement("div");
			header.className = "column-header";

			const dragHandle = document.createElement("span");
			dragHandle.className = "column-drag-handle";
			dragHandle.textContent = "\u22EE\u22EE";
			dragHandle.setAttribute("aria-label", "Drag to reorder");

			const addBtn = document.createElement("button");
			addBtn.className = "column-add-btn";
			addBtn.textContent = "+";
			addBtn.setAttribute("aria-label", "Add column to the right");
			addBtn.addEventListener("click", (e) => {
				e.preventDefault();
				e.stopPropagation();
				const updated = this.insertColumnAfter(columns, i);
				this.dispatchUpdate(updated, view);
			});

			const removeBtn = document.createElement("button");
			removeBtn.className = "column-remove-btn";
			removeBtn.textContent = "\u00D7";
			removeBtn.setAttribute("aria-label", "Remove column");
			removeBtn.addEventListener("click", (e) => {
				e.preventDefault();
				e.stopPropagation();
				if (columns.length <= 1) return; // don't remove last column
				const updated = this.normalizeColumnWidths(
					columns.filter((_, idx) => idx !== i),
				);
				this.dispatchUpdate(updated, view);
			});

			const headerActions = document.createElement("div");
			headerActions.className = "column-header-actions";
			headerActions.appendChild(addBtn);
			headerActions.appendChild(removeBtn);

			header.appendChild(dragHandle);
			header.appendChild(headerActions);
			colEl.appendChild(header);

			// Preview layer — append to DOM BEFORE rendering so the parent
			// chain (.columns-container) is intact for any post-processor guards
			const previewEl = document.createElement("div");
			previewEl.className = "column-preview";
			this.applyCompactPreviewSpacing(previewEl);
			colEl.appendChild(previewEl);

			if (col.content.length === 0) {
				const ph = document.createElement("div");
				ph.className = "column-empty-placeholder";
				ph.textContent = "Click to edit";
				previewEl.appendChild(ph);
			} else {
				this.renderColumnContent(
					previewEl,
					col.content,
					sourcePath,
					0,
					view,
					(nextContent) => {
						this.commitEdit(i, nextContent, view);
					},
					[],
					i,
				);
			}

			if (!hasNestedRegions) {
				// Editor textarea (only for columns without nested child regions)
				const textarea = document.createElement("textarea");
				textarea.className = "column-editor";
				textarea.value = col.content;
				textarea.spellcheck = false;
				textarea.placeholder = "Type here";
				colEl.appendChild(textarea);

				// Wire editing (with autocomplete suggest)
				const suggest = new ColumnEditorSuggest(textarea, plugin.app);
				this.suggests.push(suggest);
				this.wireEditToggle(container, previewEl, textarea, i, view, suggest);

				// Restore editing state
				if (activeEdit && activeEdit.regionFrom === this.region.from && activeEdit.columnIndex === i) {
					this.restoreEditState(textarea);
				}
			}

			// Wire drag from handle
			this.wireDragItem(colEl, dragHandle, [], i, view);
			this.wireContextMenu(
				colEl,
				i,
				columns,
				this.region.containerStyle,
				(nextColumns, nextContainerStyle) => {
					this.dispatchUpdate(nextColumns, view, nextContainerStyle);
				},
				{
				addColumn: () => {
					const updated = this.insertColumnAfter(columns, i);
					this.dispatchUpdate(updated, view);
				},
				addChild: () => {
					const nextContent = this.addChildColumnToContent(col.content);
					this.commitEdit(i, nextContent, view);
				},
				},
				undefined,
			);

		}
	}

	private renderColumnContent(
		parent: HTMLElement,
		content: string,
		sourcePath: string,
		depth: number,
		view: EditorView,
		onContentChange: (nextContent: string) => void,
		containerPath: ContainerPath,
		columnIndex: number,
	): void {
		if (depth > 8) {
			this.renderMarkdown(parent, content, sourcePath);
			return;
		}

		const regions = findColumnRegions(content);
		if (regions.length === 0) {
			this.renderMarkdown(parent, content, sourcePath);
			return;
		}

		const sorted = [...regions].sort((a, b) => a.from - b.from);
		type ContentPart =
			| {kind: "text"; from: number; to: number; text: string}
			| {kind: "region"; region: ColumnRegion; regionIndex: number};
		const parts: ContentPart[] = [];
		let cursor = 0;
		for (let regionIndex = 0; regionIndex < sorted.length; regionIndex++) {
			const region = sorted[regionIndex]!;
			parts.push({
				kind: "text",
				from: cursor,
				to: region.from,
				text: content.slice(cursor, region.from),
			});
			parts.push({kind: "region", region, regionIndex});
			cursor = region.to;
		}
		parts.push({
			kind: "text",
			from: cursor,
			to: content.length,
			text: content.slice(cursor),
		});

		const hasNonEmptyText = parts.some(
			(part) => part.kind === "text" && part.text.trim().length > 0,
		);
		let renderedFallbackTextEditor = false;

		for (const part of parts) {
			if (part.kind === "text") {
				const shouldRender = part.text.trim().length > 0 || (!hasNonEmptyText && !renderedFallbackTextEditor);
				if (!shouldRender) continue;
				if (!hasNonEmptyText) renderedFallbackTextEditor = true;

				this.renderEditableTextSegment(
					parent,
					part.text,
					sourcePath,
					(nextText) => {
						const nextContent = content.slice(0, part.from) + nextText + content.slice(part.to);
						onContentChange(nextContent);
					},
				);
				continue;
			}

			const region = part.region;
			const nestedContainerPath: ContainerPath = [
				...containerPath,
				{columnIndex, regionIndex: part.regionIndex},
			];
			this.renderNestedRegion(
				parent,
				region,
				sourcePath,
				depth + 1,
				view,
				(nextRegionColumns, nextRegionContainerStyle) => {
					const nextContent =
						content.slice(0, region.from) +
						serializeColumns(nextRegionColumns, nextRegionContainerStyle) +
						content.slice(region.to);
					onContentChange(nextContent);
				},
				() => {
					const nextContent = content.slice(0, region.from) + content.slice(region.to);
					onContentChange(nextContent);
				},
				nestedContainerPath,
			);
		}
	}

	private renderEditableTextSegment(
		parent: HTMLElement,
		initialText: string,
		sourcePath: string,
		onCommit: (nextText: string) => void,
	): void {
		const block = document.createElement("div");
		block.className = "column-inline-edit-block";
		parent.appendChild(block);

		const preview = document.createElement("div");
		preview.className = "column-inline-edit-preview";
		this.applyCompactPreviewSpacing(preview);
		block.appendChild(preview);

		const renderPreview = (text: string) => {
			preview.empty();
			if (text.trim().length === 0) {
				const ph = document.createElement("div");
				ph.className = "column-empty-placeholder";
				ph.textContent = "Click to edit";
				preview.appendChild(ph);
				return;
			}
			this.renderMarkdown(preview, text, sourcePath);
		};
		renderPreview(initialText);

		const textarea = document.createElement("textarea");
		textarea.className = "column-inline-editor";
		textarea.value = initialText;
		textarea.spellcheck = false;
		textarea.placeholder = "Type here";
		block.appendChild(textarea);

		const plugin = getPluginInstance();
		const suggest = new ColumnEditorSuggest(textarea, plugin.app);
		this.suggests.push(suggest);

		let currentText = initialText;

		const enterEdit = () => {
			block.classList.add("is-editing");
			textarea.value = currentText;
			this.autoSize(textarea);
			setTimeout(() => {
				textarea.focus();
				textarea.selectionStart = textarea.value.length;
				textarea.selectionEnd = textarea.value.length;
			}, 0);
		};

		const commitAndClose = () => {
			block.classList.remove("is-editing");
			const nextText = textarea.value;
			if (nextText === currentText) return;
			currentText = nextText;
			onCommit(nextText);
		};

		preview.addEventListener("click", (e) => {
			const target = e.target as HTMLElement;
			if (this.isInteractivePreviewTarget(target, preview)) return;
			e.preventDefault();
			e.stopPropagation();
			enterEdit();
		});

		preview.addEventListener("dblclick", (e) => {
			const target = e.target as HTMLElement;
			if (!this.isBlockLanguagePreviewTarget(target, preview)) return;
			e.preventDefault();
			e.stopPropagation();
			enterEdit();
		});

		textarea.addEventListener("keydown", (e) => {
			e.stopPropagation();
			if (suggest.handleKeydown(e)) return;
			if (handleAutoPair(e, textarea)) return;
			if (handleMarkdownShortcut(e, textarea)) return;
			if (e.key === "Escape") {
				commitAndClose();
			}
		});

		textarea.addEventListener("input", (e) => {
			e.stopPropagation();
			this.autoSize(textarea);
			suggest.handleInput();
		});

		textarea.addEventListener("blur", () => {
			setTimeout(() => {
				if (suggest.active) return;
				if (block.contains(document.activeElement)) return;
				if (block.classList.contains("is-editing")) {
					commitAndClose();
				}
			}, 180);
		});

		textarea.addEventListener("paste", (e: ClipboardEvent) => {
			e.stopPropagation();
			const items = e.clipboardData?.items;
			if (!items) return;

			for (const item of Array.from(items)) {
				if (!item.type.startsWith("image/")) continue;
				e.preventDefault();
				const blob = item.getAsFile();
				if (!blob) return;
				void this.handleImagePaste(blob, item.type, textarea);
				return;
			}
		});

		for (const evt of ["cut", "copy"] as const) {
			textarea.addEventListener(evt, (e) => e.stopPropagation());
		}
	}

	private renderNestedRegion(
		parent: HTMLElement,
		region: ColumnRegion,
		sourcePath: string,
		depth: number,
		view: EditorView,
		onRegionChange: (
			nextColumns: ColumnData[],
			nextStyle: ColumnStyleData | undefined,
		) => void,
		onRemoveRegion: () => void,
		containerPath: ContainerPath,
	): void {
		const container = document.createElement("div");
		container.className = "columns-container columns-ui columns-nested";
		applyContainerStyle(container, region.containerStyle);
		parent.appendChild(container);

		for (let i = 0; i < region.columns.length; i++) {
			if (i > 0) {
				this.buildNestedResizeHandle(container, i - 1, region.columns, (nextColumns) => {
					onRegionChange(nextColumns, region.containerStyle);
				});
			}

			const col = region.columns[i]!;
			const colEl = document.createElement("div");
			colEl.className = "column-item";
			colEl.dataset.colIndex = String(i);
			if (col.widthPercent > 0) {
				const handleTotal = (region.columns.length - 1) * 8;
				const shrink = handleTotal / region.columns.length;
				colEl.style.flex = `0 0 calc(${col.widthPercent}% - ${shrink.toFixed(1)}px)`;
			}
			applyColumnStyle(colEl, col.style);
			container.appendChild(colEl);

			const header = document.createElement("div");
			header.className = "column-header";

			const dragHandle = document.createElement("span");
			dragHandle.className = "column-drag-handle";
			dragHandle.textContent = "\u22EE\u22EE";
			dragHandle.setAttribute("aria-label", "Drag to reorder");

			const addBtn = document.createElement("button");
			addBtn.className = "column-add-btn";
			addBtn.textContent = "+";
			addBtn.setAttribute("aria-label", "Add column to the right");
			addBtn.addEventListener("click", (e) => {
				e.preventDefault();
				e.stopPropagation();
				const updated = this.insertColumnAfter(region.columns, i);
				onRegionChange(updated, region.containerStyle);
			});

			const removeBtn = document.createElement("button");
			removeBtn.className = "column-remove-btn";
			removeBtn.textContent = "\u00D7";
			removeBtn.setAttribute("aria-label", "Remove column");
			removeBtn.addEventListener("click", (e) => {
				e.preventDefault();
				e.stopPropagation();
				if (region.columns.length <= 1) {
					onRemoveRegion();
					return;
				}
				const updated = this.normalizeColumnWidths(
					region.columns.filter((_, idx) => idx !== i),
				);
				onRegionChange(updated, region.containerStyle);
			});

			const headerActions = document.createElement("div");
			headerActions.className = "column-header-actions";
			headerActions.appendChild(addBtn);
			headerActions.appendChild(removeBtn);

			header.appendChild(dragHandle);
			header.appendChild(headerActions);
			colEl.appendChild(header);

			this.wireDragItem(colEl, dragHandle, containerPath, i, view);
			this.wireContextMenu(
				colEl,
				i,
				region.columns,
				region.containerStyle,
				(nextColumns, nextContainerStyle) => {
					onRegionChange(nextColumns, nextContainerStyle);
				},
				{
				addColumn: () => {
					const updated = this.insertColumnAfter(region.columns, i);
					onRegionChange(updated, region.containerStyle);
				},
				addChild: () => {
					const nextChildContent = this.addChildColumnToContent(col.content);
					const updated = region.columns.map((c, idx) =>
						idx === i ? {...c, content: nextChildContent} : c,
					);
					onRegionChange(updated, region.containerStyle);
				},
				},
				containerPath[containerPath.length - 1]?.columnIndex !== undefined
					? containerPath[containerPath.length - 1]!.columnIndex + 1
					: undefined,
			);

			const previewEl = document.createElement("div");
			previewEl.className = "column-preview";
			this.applyCompactPreviewSpacing(previewEl);
			colEl.appendChild(previewEl);
			const hasNestedRegions = findColumnRegions(col.content).length > 0;

			if (col.content.length > 0) {
				this.renderColumnContent(
					previewEl,
					col.content,
					sourcePath,
					depth,
					view,
					(nextChildContent) => {
						const updated = region.columns.map((c, idx) =>
							idx === i ? {...c, content: nextChildContent} : c,
						);
						onRegionChange(updated, region.containerStyle);
					},
					containerPath,
					i,
				);
			} else {
				const ph = document.createElement("div");
				ph.className = "column-empty-placeholder";
				ph.textContent = "Click to edit";
				previewEl.appendChild(ph);
			}

			if (!hasNestedRegions) {
				const textarea = document.createElement("textarea");
				textarea.className = "column-editor";
				textarea.value = col.content;
				textarea.spellcheck = false;
				textarea.placeholder = "Type here";
				colEl.appendChild(textarea);

				this.wireNestedEditToggle(
					container,
					previewEl,
					textarea,
					() => region.columns[i]!.content,
					(nextChildContent) => {
						const updated = region.columns.map((c, idx) =>
							idx === i ? {...c, content: nextChildContent} : c,
						);
						onRegionChange(updated, region.containerStyle);
					},
				);
			}
		}
	}

	private renderMarkdown(parent: HTMLElement, content: string, sourcePath: string): void {
		const plugin = getPluginInstance();
		const component = new Component();
		component.load();
		this.components.push(component);
		void MarkdownRenderer.render(plugin.app, content, parent, sourcePath, component);
	}

	// ── Edit / Preview Toggle ────────────────────────────────────

	private wireEditToggle(
		container: HTMLElement,
		previewEl: HTMLElement,
		textarea: HTMLTextAreaElement,
		index: number,
		view: EditorView,
		suggest: ColumnEditorSuggest,
	): void {
		const enterEdit = () => {
			// Close other open editors in this container
			container.querySelectorAll<HTMLElement>(".column-item.is-editing").forEach((el) => {
				if (el !== textarea.parentElement) {
					el.classList.remove("is-editing");
				}
			});

			const colEl = textarea.parentElement!;
			colEl.classList.add("is-editing");
			textarea.value = this.region.columns[index]!.content;
			this.autoSize(textarea);

			setTimeout(() => {
				textarea.focus();
				textarea.selectionStart = textarea.value.length;
				textarea.selectionEnd = textarea.value.length;
			}, 0);

			activeEdit = {
				regionFrom: this.region.from,
				columnIndex: index,
				cursorStart: textarea.value.length,
				cursorEnd: textarea.value.length,
				scrollTop: 0,
				value: textarea.value,
			};
		};

		const commitAndClose = () => {
			const colEl = textarea.parentElement!;
			colEl.classList.remove("is-editing");
			const newContent = textarea.value;
			activeEdit = null;

			if (newContent !== this.region.columns[index]!.content) {
				this.commitEdit(index, newContent, view);
			}
		};

		// Click preview → edit
		previewEl.addEventListener("click", (e) => {
			const target = e.target as HTMLElement;
			if (target.closest(".columns-nested")) return;
			if (this.isInteractivePreviewTarget(target, previewEl)) return;
			e.preventDefault();
			e.stopPropagation();
			enterEdit();
		});

		previewEl.addEventListener("dblclick", (e) => {
			const target = e.target as HTMLElement;
			if (target.closest(".columns-nested")) return;
			if (!this.isBlockLanguagePreviewTarget(target, previewEl)) return;
			e.preventDefault();
			e.stopPropagation();
			enterEdit();
		});

		// Keyboard
		textarea.addEventListener("keydown", (e) => {
			e.stopPropagation();
			// Suggest popup gets first priority
			if (suggest.handleKeydown(e)) return;
			// Auto-pair [[ and ]] handling
			if (handleAutoPair(e, textarea)) return;
			// Markdown shortcuts (Ctrl+B, Ctrl+I)
			if (handleMarkdownShortcut(e, textarea)) return;

			if (e.key === "Escape") {
				commitAndClose();
				return;
			}
			// Tab: switch to next/prev column
			if (e.key === "Tab") {
				e.preventDefault();
				commitAndClose();
				const dir = e.shiftKey ? -1 : 1;
				const next = index + dir;
				if (next >= 0 && next < this.region.columns.length) {
					const nextPreview = container.querySelectorAll<HTMLElement>(
						":scope > .column-item > .column-preview",
					)[next];
					if (nextPreview) {
						setTimeout(() => nextPreview.click(), 50);
					}
				}
				return;
			}
			// Track cursor
			setTimeout(() => {
				if (activeEdit && activeEdit.regionFrom === this.region.from && activeEdit.columnIndex === index) {
					activeEdit.cursorStart = textarea.selectionStart;
					activeEdit.cursorEnd = textarea.selectionEnd;
					activeEdit.scrollTop = textarea.scrollTop;
					activeEdit.value = textarea.value;
				}
			}, 0);
		});

		textarea.addEventListener("input", (e) => {
			e.stopPropagation();
			this.autoSize(textarea);
			suggest.handleInput();
			if (activeEdit && activeEdit.regionFrom === this.region.from && activeEdit.columnIndex === index) {
				activeEdit.value = textarea.value;
			}
		});

		// Blur: commit once focus leaves this column editor.
		textarea.addEventListener("blur", () => {
			setTimeout(() => {
				if (suggest.active) return;
				const currentItem = textarea.parentElement;
				if (currentItem?.contains(document.activeElement)) return;
				if (textarea.parentElement?.classList.contains("is-editing")) {
					commitAndClose();
				}
			}, 200);
		});

		// Image paste: save to vault and insert wikilink
		textarea.addEventListener("paste", (e: ClipboardEvent) => {
			e.stopPropagation();
			const items = e.clipboardData?.items;
			if (!items) return;

			for (const item of Array.from(items)) {
				if (!item.type.startsWith("image/")) continue;

				e.preventDefault();
				const blob = item.getAsFile();
				if (!blob) return;
				void this.handleImagePaste(blob, item.type, textarea);
				return;
			}
		});

		for (const evt of ["cut", "copy"] as const) {
			textarea.addEventListener(evt, (e) => e.stopPropagation());
		}
	}

	private wireNestedEditToggle(
		container: HTMLElement,
		previewEl: HTMLElement,
		textarea: HTMLTextAreaElement,
		getCurrentContent: () => string,
		onCommit: (nextContent: string) => void,
	): void {
		const plugin = getPluginInstance();
		const suggest = new ColumnEditorSuggest(textarea, plugin.app);
		this.suggests.push(suggest);

		const enterEdit = () => {
			container.querySelectorAll<HTMLElement>(".column-item.is-editing").forEach((el) => {
				if (el !== textarea.parentElement) {
					el.classList.remove("is-editing");
				}
			});

			const colEl = textarea.parentElement!;
			colEl.classList.add("is-editing");
			textarea.value = getCurrentContent();
			this.autoSize(textarea);
			setTimeout(() => {
				textarea.focus();
				textarea.selectionStart = textarea.value.length;
				textarea.selectionEnd = textarea.value.length;
			}, 0);
		};

		const commitAndClose = () => {
			const colEl = textarea.parentElement!;
			colEl.classList.remove("is-editing");
			const nextValue = textarea.value;
			if (nextValue !== getCurrentContent()) {
				onCommit(nextValue);
			}
		};

		previewEl.addEventListener("click", (e) => {
			const target = e.target as HTMLElement;
			const currentNested = previewEl.closest(".columns-nested");
			const clickedNested = target.closest(".columns-nested");
			if (currentNested && clickedNested && clickedNested !== currentNested) return;
			if (this.isInteractivePreviewTarget(target, previewEl)) return;
			e.preventDefault();
			e.stopPropagation();
			enterEdit();
		});

		previewEl.addEventListener("dblclick", (e) => {
			const target = e.target as HTMLElement;
			const currentNested = previewEl.closest(".columns-nested");
			const clickedNested = target.closest(".columns-nested");
			if (currentNested && clickedNested && clickedNested !== currentNested) return;
			if (!this.isBlockLanguagePreviewTarget(target, previewEl)) return;
			e.preventDefault();
			e.stopPropagation();
			enterEdit();
		});

		textarea.addEventListener("keydown", (e) => {
			e.stopPropagation();
			if (suggest.handleKeydown(e)) return;
			if (handleAutoPair(e, textarea)) return;
			if (handleMarkdownShortcut(e, textarea)) return;
			if (e.key === "Escape") {
				commitAndClose();
				return;
			}
		});

		textarea.addEventListener("input", (e) => {
			e.stopPropagation();
			this.autoSize(textarea);
			suggest.handleInput();
		});

		textarea.addEventListener("blur", () => {
			setTimeout(() => {
				if (suggest.active) return;
				const currentItem = textarea.parentElement;
				if (currentItem?.contains(document.activeElement)) return;
				if (textarea.parentElement?.classList.contains("is-editing")) {
					commitAndClose();
				}
			}, 180);
		});

		textarea.addEventListener("paste", (e: ClipboardEvent) => {
			e.stopPropagation();
			const items = e.clipboardData?.items;
			if (!items) return;

			for (const item of Array.from(items)) {
				if (!item.type.startsWith("image/")) continue;
				e.preventDefault();
				const blob = item.getAsFile();
				if (!blob) return;
				void this.handleImagePaste(blob, item.type, textarea);
				return;
			}
		});

		for (const evt of ["cut", "copy"] as const) {
			textarea.addEventListener(evt, (e) => e.stopPropagation());
		}
	}

	private async handleImagePaste(
		blob: File,
		mimeType: string,
		textarea: HTMLTextAreaElement,
	): Promise<void> {
		const plugin = getPluginInstance();
		const ext = mimeType === "image/jpeg" ? "jpg" : (mimeType.split("/")[1] ?? "png");
		const fileName = `pasted-image-${Date.now()}.${ext}`;
		const activeFile = plugin.app.workspace.getActiveFile();
		const folder = activeFile?.parent?.path ?? "";
		const fullPath = folder ? `${folder}/${fileName}` : fileName;

		const buf = await blob.arrayBuffer();
		const created = await plugin.app.vault.createBinary(fullPath, buf);

		const link = `![[${created.name}]]`;
		const start = textarea.selectionStart;
		const end = textarea.selectionEnd;
		const value = textarea.value;
		textarea.value = value.substring(0, start) + link + value.substring(end);
		textarea.selectionStart = start + link.length;
		textarea.selectionEnd = start + link.length;
		textarea.dispatchEvent(new Event("input", {bubbles: true}));
	}

	private restoreEditState(textarea: HTMLTextAreaElement): void {
		const saved = activeEdit!;
		const colEl = textarea.parentElement!;
		colEl.classList.add("is-editing");
		textarea.value = saved.value;
		this.autoSize(textarea);

		setTimeout(() => {
			textarea.focus();
			textarea.selectionStart = saved.cursorStart;
			textarea.selectionEnd = saved.cursorEnd;
			textarea.scrollTop = saved.scrollTop;
		}, 0);
	}

	private autoSize(ta: HTMLTextAreaElement): void {
		ta.setCssProps({"--column-editor-height": "0px"});
		ta.setCssProps({"--column-editor-height": Math.max(60, ta.scrollHeight) + "px"});
	}

	private applyCompactPreviewSpacing(target: HTMLElement): void {
		target.setCssProps({
			"--list-spacing": "0.12rem",
			"--p-spacing": "0.3rem",
			"--heading-spacing": "0.16rem",
			"--line-height-normal": "1.24",
			"--line-height-tight": "1.18",
			"--h1-margin-top": "0.35rem",
			"--h2-margin-top": "0.32rem",
			"--h3-margin-top": "0.3rem",
			"--h4-margin-top": "0.28rem",
			"--h5-margin-top": "0.26rem",
			"--h6-margin-top": "0.24rem",
			"--h1-margin-bottom": "0.2rem",
			"--h2-margin-bottom": "0.18rem",
			"--h3-margin-bottom": "0.16rem",
			"--h4-margin-bottom": "0.14rem",
			"--h5-margin-bottom": "0.12rem",
			"--h6-margin-bottom": "0.1rem",
		});
	}

	// ── Commit Edit ──────────────────────────────────────────────

	private commitEdit(editedIndex: number, newContent: string, view: EditorView): void {
		const updated = this.region.columns.map((col, i) =>
			i === editedIndex ? {...col, content: newContent} : col,
		);
		this.dispatchUpdate(updated, view);
	}

	private insertColumnAfter(columns: ColumnData[], index: number): ColumnData[] {
		const normalized = columns.map((col) => ({...col, widthPercent: 0}));
		normalized.splice(index + 1, 0, {content: "", widthPercent: 0});
		return normalized;
	}

	private normalizeColumnWidths(columns: ColumnData[]): ColumnData[] {
		return columns.map((col) => ({...col, widthPercent: 0}));
	}

	private addChildColumnToContent(content: string): string {
		const nestedRegions = findColumnRegions(content);
		if (nestedRegions.length > 0) {
			const region = nestedRegions[nestedRegions.length - 1]!;
			const nextChildren = [
				...region.columns.map((child) => ({...child, widthPercent: 0})),
				{content: "", widthPercent: 0},
			];
			return (
				content.slice(0, region.from) +
				serializeColumns(nextChildren, region.containerStyle) +
				content.slice(region.to)
			);
		}

		const trailingWhitespace = content.match(/\s*$/)?.[0] ?? "";
		const withoutTrailing = content.slice(0, content.length - trailingWhitespace.length);
		const separator = withoutTrailing.length > 0 ? "\n\n" : "";
		const nestedBlock = serializeColumns([{content: "", widthPercent: 0}]);
		return `${withoutTrailing}${separator}${nestedBlock}${trailingWhitespace}`;
	}

	private removeColumnAtPath(
		columns: ColumnData[],
		path: ContainerPath,
		removeIndex: number,
	): {nextColumns: ColumnData[] | null; removed: boolean} {
		if (path.length === 0) {
			if (removeIndex < 0 || removeIndex >= columns.length) {
				return {nextColumns: columns, removed: false};
			}
			const filtered = columns.filter((_, idx) => idx !== removeIndex);
			if (filtered.length === 0) {
				return {nextColumns: null, removed: true};
			}
			return {
				nextColumns: this.normalizeColumnWidths(filtered),
				removed: true,
			};
		}

		const [head, ...rest] = path;
		if (!head) return {nextColumns: columns, removed: false};
		const parentColumn = columns[head.columnIndex];
		if (!parentColumn) return {nextColumns: columns, removed: false};

		const regions = findColumnRegions(parentColumn.content).sort((a, b) => a.from - b.from);
		const region = regions[head.regionIndex];
		if (!region) return {nextColumns: columns, removed: false};

		const nestedResult = this.removeColumnAtPath(region.columns, rest, removeIndex);
		if (!nestedResult.removed) return {nextColumns: columns, removed: false};

		const nextContent =
			nestedResult.nextColumns === null
				? parentColumn.content.slice(0, region.from) +
				  parentColumn.content.slice(region.to)
				: parentColumn.content.slice(0, region.from) +
				  serializeColumns(nestedResult.nextColumns, region.containerStyle) +
				  parentColumn.content.slice(region.to);

		const nextColumns = columns.map((column, index) =>
			index === head.columnIndex ? {...column, content: nextContent} : column,
		);
		return {nextColumns, removed: true};
	}

	private isSameContainerPath(a: ContainerPath, b: ContainerPath): boolean {
		if (a.length !== b.length) return false;
		for (let i = 0; i < a.length; i++) {
			const left = a[i]!;
			const right = b[i]!;
			if (left.columnIndex !== right.columnIndex) return false;
			if (left.regionIndex !== right.regionIndex) return false;
		}
		return true;
	}

	private isDestinationInsideMovedColumn(
		sourcePath: ContainerPath,
		sourceIndex: number,
		destinationPath: ContainerPath,
	): boolean {
		if (destinationPath.length <= sourcePath.length) return false;
		for (let i = 0; i < sourcePath.length; i++) {
			const left = sourcePath[i]!;
			const right = destinationPath[i]!;
			if (left.columnIndex !== right.columnIndex) return false;
			if (left.regionIndex !== right.regionIndex) return false;
		}
		const next = destinationPath[sourcePath.length];
		return next?.columnIndex === sourceIndex;
	}

	private getColumnsAtPath(columns: ColumnData[], path: ContainerPath): ColumnData[] | null {
		if (path.length === 0) return columns;
		const [head, ...rest] = path;
		if (!head) return columns;
		const col = columns[head.columnIndex];
		if (!col) return null;
		const regions = findColumnRegions(col.content).sort((a, b) => a.from - b.from);
		const region = regions[head.regionIndex];
		if (!region) return null;
		return this.getColumnsAtPath(region.columns, rest);
	}

	private updateColumnsAtPath(
		columns: ColumnData[],
		path: ContainerPath,
		updater: (target: ColumnData[]) => ColumnData[],
	): ColumnData[] {
		if (path.length === 0) return updater(columns);
		const [head, ...rest] = path;
		if (!head) return updater(columns);
		return columns.map((col, index) => {
			if (index !== head.columnIndex) return col;
			const regions = findColumnRegions(col.content).sort((a, b) => a.from - b.from);
			const region = regions[head.regionIndex];
			if (!region) return col;
			const nextRegionColumns = this.updateColumnsAtPath(region.columns, rest, updater);
			const nextContent =
				col.content.slice(0, region.from) +
				serializeColumns(nextRegionColumns, region.containerStyle) +
				col.content.slice(region.to);
			return {...col, content: nextContent};
		});
	}

	private moveColumnBetweenContainers(
		sourcePath: ContainerPath,
		sourceIndex: number,
		destinationPath: ContainerPath,
		destinationIndex: number,
		view: EditorView,
	): void {
		if (this.isDestinationInsideMovedColumn(sourcePath, sourceIndex, destinationPath)) return;

		const rootColumns = this.region.columns;
		const sourceColumns = this.getColumnsAtPath(rootColumns, sourcePath);
		const destinationColumns = this.getColumnsAtPath(rootColumns, destinationPath);
		if (!sourceColumns || !destinationColumns) return;
		if (sourceIndex < 0 || sourceIndex >= sourceColumns.length) return;
		if (destinationIndex < 0 || destinationIndex >= destinationColumns.length) return;

		const sameContainer = this.isSameContainerPath(sourcePath, destinationPath);
		if (sameContainer && sourceIndex === destinationIndex) return;

		const moving = sourceColumns[sourceIndex];
		if (!moving) return;

		if (sameContainer) {
			const reordered = [...sourceColumns];
			const [removed] = reordered.splice(sourceIndex, 1);
			if (!removed) return;
			reordered.splice(destinationIndex, 0, removed);
			const nextRoot = this.updateColumnsAtPath(rootColumns, sourcePath, () => reordered);
			this.dispatchUpdate(nextRoot, view);
			return;
		}

		const removed = this.removeColumnAtPath(rootColumns, sourcePath, sourceIndex);
		const sourceRemovedRoot = removed.nextColumns;
		if (!removed.removed || !sourceRemovedRoot) return;

		const nextRoot = this.updateColumnsAtPath(sourceRemovedRoot, destinationPath, (target) => {
			const insertAt = Math.max(0, Math.min(destinationIndex, target.length));
			const inserted = [...target];
			inserted.splice(insertAt, 0, {...moving, widthPercent: 0});
			return this.normalizeColumnWidths(inserted);
		});

		this.dispatchUpdate(nextRoot, view);
	}

	private moveColumnBetweenBlocks(
		sourceDrag: ActiveDragState,
		destinationPath: ContainerPath,
		destinationIndex: number,
		view: EditorView,
	): void {
		const doc = view.state.doc.toString();
		const regions = findColumnRegions(doc);
		const sourceRegion = regions.find((region) => region.from === sourceDrag.sourceRegionFrom);
		const destinationRegion = regions.find((region) => region.from === this.region.from);
		if (!sourceRegion || !destinationRegion) return;

		if (sourceRegion.from === destinationRegion.from) {
			this.moveColumnBetweenContainers(
				sourceDrag.sourcePath,
				sourceDrag.sourceIndex,
				destinationPath,
				destinationIndex,
				view,
			);
			return;
		}

		const sourceColumns = this.getColumnsAtPath(sourceRegion.columns, sourceDrag.sourcePath);
		const destinationColumns = this.getColumnsAtPath(destinationRegion.columns, destinationPath);
		if (!sourceColumns || !destinationColumns) return;
		if (sourceDrag.sourceIndex < 0 || sourceDrag.sourceIndex >= sourceColumns.length) return;
		if (destinationIndex < 0 || destinationIndex >= destinationColumns.length) return;

		const moving = sourceColumns[sourceDrag.sourceIndex];
		if (!moving) return;

		const removed = this.removeColumnAtPath(
			sourceRegion.columns,
			sourceDrag.sourcePath,
			sourceDrag.sourceIndex,
		);
		if (!removed.removed) return;
		const nextSourceRoot = removed.nextColumns;
		const nextDestinationRoot = this.updateColumnsAtPath(
			destinationRegion.columns,
			destinationPath,
			(target) => {
				const insertAt = Math.max(0, Math.min(destinationIndex, target.length));
				const inserted = [...target];
				inserted.splice(insertAt, 0, {...moving, widthPercent: 0});
				return this.normalizeColumnWidths(inserted);
			},
		);

		const sourceReplacement =
			nextSourceRoot === null
				? ""
				: serializeColumns(nextSourceRoot, sourceRegion.containerStyle);

		const changes = [
			{
				from: sourceRegion.from,
				to: sourceRegion.to,
				insert: sourceReplacement,
			},
			{
				from: destinationRegion.from,
				to: destinationRegion.to,
				insert: serializeColumns(nextDestinationRoot, destinationRegion.containerStyle),
			},
		].sort((a, b) => a.from - b.from);

		view.dispatch({changes});
	}

	private moveColumnToCursorBlock(sourceDrag: ActiveDragState, view: EditorView): void {
		const doc = view.state.doc.toString();
		const regions = findColumnRegions(doc);
		const sourceRegion = regions.find((region) => region.from === sourceDrag.sourceRegionFrom);
		if (!sourceRegion) return;

		const sourceColumns = this.getColumnsAtPath(sourceRegion.columns, sourceDrag.sourcePath);
		if (!sourceColumns) return;
		if (sourceDrag.sourceIndex < 0 || sourceDrag.sourceIndex >= sourceColumns.length) return;

		const moving = sourceColumns[sourceDrag.sourceIndex];
		if (!moving) return;

		const removed = this.removeColumnAtPath(
			sourceRegion.columns,
			sourceDrag.sourcePath,
			sourceDrag.sourceIndex,
		);
		if (!removed.removed) return;
		const nextSourceRoot = removed.nextColumns;

		let cursorPos = view.state.selection.main.head;
		if (cursorPos >= sourceRegion.from && cursorPos <= sourceRegion.to) {
			cursorPos = sourceRegion.to;
		}
		const standaloneBlock = serializeColumns([{...moving, widthPercent: 0}]);
		const insertion = this.buildStandaloneBlockInsertion(doc, cursorPos, standaloneBlock);
		const sourceReplacement =
			nextSourceRoot === null
				? ""
				: serializeColumns(nextSourceRoot, sourceRegion.containerStyle);

		const changes = [
			{
				from: sourceRegion.from,
				to: sourceRegion.to,
				insert: sourceReplacement,
			},
			{
				from: cursorPos,
				to: cursorPos,
				insert: insertion,
			},
		].sort((a, b) => a.from - b.from);

		view.dispatch({changes});
	}

	private startDragPointerTracking(initialEvent: DragEvent): void {
		if (cleanupActiveDragTracking) {
			cleanupActiveDragTracking();
			cleanupActiveDragTracking = null;
		}

		activeDragPoint = {x: initialEvent.clientX, y: initialEvent.clientY};
		const updatePoint = (event: DragEvent) => {
			activeDragPoint = {x: event.clientX, y: event.clientY};
		};

		document.addEventListener("dragover", updatePoint, true);
		document.addEventListener("drop", updatePoint, true);
		cleanupActiveDragTracking = () => {
			document.removeEventListener("dragover", updatePoint, true);
			document.removeEventListener("drop", updatePoint, true);
		};
	}

	private stopDragPointerTracking(): void {
		if (cleanupActiveDragTracking) {
			cleanupActiveDragTracking();
			cleanupActiveDragTracking = null;
		}
		activeDragPoint = null;
	}

	private resolveDragPoint(event: DragEvent): {x: number; y: number} | null {
		const hasPoint = Number.isFinite(event.clientX) && Number.isFinite(event.clientY);
		if (hasPoint && (event.clientX !== 0 || event.clientY !== 0)) {
			return {x: event.clientX, y: event.clientY};
		}
		return activeDragPoint;
	}

	private isInteractivePreviewTarget(
		target: HTMLElement,
		scopeEl?: HTMLElement,
	): boolean {
		const interactive = target.closest(INTERACTIVE_PREVIEW_SELECTOR);
		if (!interactive) return false;
		if (!scopeEl) return true;
		return scopeEl.contains(interactive);
	}

	private isBlockLanguagePreviewTarget(
		target: HTMLElement,
		scopeEl: HTMLElement,
	): boolean {
		const block = target.closest(BLOCK_LANGUAGE_PREVIEW_SELECTOR);
		if (!block) return false;
		return scopeEl.contains(block);
	}

	private shouldInsertDraggedBlockAtCursor(event: DragEvent, view: EditorView): boolean {
		const point = this.resolveDragPoint(event);
		if (!point) return false;
		const target = document.elementFromPoint(point.x, point.y);
		if (!(target instanceof HTMLElement)) return false;
		if (!view.dom.contains(target)) return false;
		if (target.closest(".columns-container")) return false;
		if (target.closest(".column-item")) return false;
		return true;
	}

	private buildStandaloneBlockInsertion(doc: string, cursorPos: number, block: string): string {
		const beforeChar = cursorPos > 0 ? doc[cursorPos - 1] : "";
		const afterChar = cursorPos < doc.length ? doc[cursorPos] : "";

		const parts: string[] = [];
		if (beforeChar && beforeChar !== "\n") parts.push("\n");
		parts.push(block);
		if (afterChar && afterChar !== "\n") parts.push("\n");
		return parts.join("");
	}

	private increaseColumnWidth(columns: ColumnData[], index: number): ColumnData[] | null {
		if (columns.length < 2) return null;

		const min = getPluginInstance().settings.minColumnWidthPercent;
		const widthStep = 10;
		const base = this.resolveEffectiveWidths(columns);

		const donors = base
			.map((w, i) => ({w, i}))
			.filter((entry) => entry.i !== index && entry.w > min)
			.sort((a, b) => b.w - a.w);
		const donor = donors[0];
		if (!donor) return null;

		const maxTarget = 100 - min * (columns.length - 1);
		const targetCurrent = base[index]!;
		const availableForTarget = Math.max(0, maxTarget - targetCurrent);
		const availableFromDonor = Math.max(0, donor.w - min);
		const delta = Math.min(widthStep, availableForTarget, availableFromDonor);
		if (delta <= 0) return null;

		const next = [...base];
		next[index] = targetCurrent + delta;
		next[donor.i] = donor.w - delta;

		return columns.map((col, i) => ({
			...col,
			widthPercent: Math.round(next[i]!),
		}));
	}

	private resolveEffectiveWidths(columns: ColumnData[]): number[] {
		if (columns.length === 0) return [];
		const fallback = 100 / columns.length;
		const raw = columns.map((col) => (col.widthPercent > 0 ? col.widthPercent : fallback));
		const sum = raw.reduce((acc, value) => acc + value, 0);
		if (sum <= 0) return columns.map(() => fallback);
		return raw.map((value) => (value / sum) * 100);
	}

	private dispatchUpdate(
		columns: ColumnData[],
		view: EditorView,
		...containerStyleArg: [ColumnStyleData | undefined] | []
	): void {
		const containerStyle =
			containerStyleArg.length === 0
				? this.region.containerStyle
				: containerStyleArg[0];
		view.dispatch({
			changes: {
				from: this.region.from,
				to: this.region.to,
				insert: serializeColumns(columns, containerStyle),
			},
		});
	}

	// ── Resize Handle ────────────────────────────────────────────

	private buildResizeHandle(
		container: HTMLElement,
		resizeIndex: number,
		columns: ColumnData[],
		view: EditorView,
	): void {
		const handle = document.createElement("div");
		handle.className = "column-resize-handle";
		container.appendChild(handle);

		let startX = 0;
		let startLeftPct = 0;
		let startRightPct = 0;
		let totalPct = 0;
		let containerWidth = 0;

		const handleShrink = (columns.length - 1) * 8 / columns.length;

		const onMouseMove = (e: MouseEvent) => {
			if (containerWidth === 0) return;
			const dx = e.clientX - startX;
			const delta = (dx / containerWidth) * 100;
			const min = getPluginInstance().settings.minColumnWidthPercent;

			const newLeft = Math.max(min, Math.min(totalPct - min, startLeftPct + delta));
			const newRight = totalPct - newLeft;

			const items = container.querySelectorAll<HTMLElement>(":scope > .column-item");
			const leftEl = items[resizeIndex];
			const rightEl = items[resizeIndex + 1];
			if (leftEl) leftEl.style.flex = `0 0 calc(${newLeft}% - ${handleShrink.toFixed(1)}px)`;
			if (rightEl) rightEl.style.flex = `0 0 calc(${newRight}% - ${handleShrink.toFixed(1)}px)`;
		};

		const onMouseUp = (e: MouseEvent) => {
			document.removeEventListener("mousemove", onMouseMove);
			document.removeEventListener("mouseup", onMouseUp);
			container.classList.remove("columns-resizing");

			const dx = e.clientX - startX;
			const delta = (dx / containerWidth) * 100;
			const min = getPluginInstance().settings.minColumnWidthPercent;

			const newLeft = Math.max(min, Math.min(totalPct - min, startLeftPct + delta));
			const newRight = totalPct - newLeft;

			const updated = columns.map((col, i) => {
				if (i === resizeIndex) return {...col, widthPercent: Math.round(newLeft)};
				if (i === resizeIndex + 1) return {...col, widthPercent: Math.round(newRight)};
				return col;
			});
			this.dispatchUpdate(updated, view);
		};

		handle.addEventListener("mousedown", (e) => {
			e.preventDefault();
			e.stopPropagation();
			startX = e.clientX;
			containerWidth = container.getBoundingClientRect().width;
			container.classList.add("columns-resizing");

			const eqPct = 100 / columns.length;
			startLeftPct = columns[resizeIndex]?.widthPercent || eqPct;
			startRightPct = columns[resizeIndex + 1]?.widthPercent || eqPct;
			totalPct = startLeftPct + startRightPct;

			document.addEventListener("mousemove", onMouseMove);
			document.addEventListener("mouseup", onMouseUp);
		});
	}

	private buildNestedResizeHandle(
		container: HTMLElement,
		resizeIndex: number,
		columns: ColumnData[],
		onColumnsChange: (nextColumns: ColumnData[]) => void,
	): void {
		const handle = document.createElement("div");
		handle.className = "column-resize-handle";
		container.appendChild(handle);

		let startX = 0;
		let startLeftPct = 0;
		let startRightPct = 0;
		let totalPct = 0;
		let containerWidth = 0;

		const nestedHandleShrink = (columns.length - 1) * 8 / columns.length;

		const onMouseMove = (e: MouseEvent) => {
			if (containerWidth === 0) return;
			const dx = e.clientX - startX;
			const delta = (dx / containerWidth) * 100;
			const min = getPluginInstance().settings.minColumnWidthPercent;

			const newLeft = Math.max(min, Math.min(totalPct - min, startLeftPct + delta));
			const newRight = totalPct - newLeft;

			const items = container.querySelectorAll<HTMLElement>(":scope > .column-item");
			const leftEl = items[resizeIndex];
			const rightEl = items[resizeIndex + 1];
			if (leftEl) leftEl.style.flex = `0 0 calc(${newLeft}% - ${nestedHandleShrink.toFixed(1)}px)`;
			if (rightEl) rightEl.style.flex = `0 0 calc(${newRight}% - ${nestedHandleShrink.toFixed(1)}px)`;
		};

		const onMouseUp = (e: MouseEvent) => {
			document.removeEventListener("mousemove", onMouseMove);
			document.removeEventListener("mouseup", onMouseUp);
			container.classList.remove("columns-resizing");

			const dx = e.clientX - startX;
			const delta = (dx / containerWidth) * 100;
			const min = getPluginInstance().settings.minColumnWidthPercent;

			const newLeft = Math.max(min, Math.min(totalPct - min, startLeftPct + delta));
			const newRight = totalPct - newLeft;

			const updated = columns.map((col, i) => {
				if (i === resizeIndex) return {...col, widthPercent: Math.round(newLeft)};
				if (i === resizeIndex + 1) return {...col, widthPercent: Math.round(newRight)};
				return col;
			});
			onColumnsChange(updated);
		};

		handle.addEventListener("mousedown", (e) => {
			e.preventDefault();
			e.stopPropagation();
			startX = e.clientX;
			containerWidth = container.getBoundingClientRect().width;
			container.classList.add("columns-resizing");

			const eqPct = 100 / columns.length;
			startLeftPct = columns[resizeIndex]?.widthPercent || eqPct;
			startRightPct = columns[resizeIndex + 1]?.widthPercent || eqPct;
			totalPct = startLeftPct + startRightPct;

			document.addEventListener("mousemove", onMouseMove);
			document.addEventListener("mouseup", onMouseUp);
		});
	}

	// ── Drag & Drop ──────────────────────────────────────────────

	private wireDragItem(
		item: HTMLElement,
		handle: HTMLElement,
		containerPath: ContainerPath,
		index: number,
		view: EditorView,
	): void {
		// Dragging starts from the visible handle.
		handle.addEventListener("mousedown", (e) => {
			e.stopPropagation();
			item.setAttribute("draggable", "true");
		});

		// Also allow dragging by holding Alt and clicking anywhere on the column
		item.addEventListener("mousedown", (e) => {
			if (e.altKey) {
				e.stopPropagation();
				item.setAttribute("draggable", "true");
			}
		});

		item.addEventListener("dragstart", (e: DragEvent) => {
			if (e.target !== item) return;
			e.stopPropagation();
			if (!e.dataTransfer) return;
			e.dataTransfer.effectAllowed = "move";
			e.dataTransfer.setData("text/plain", "");
			activeDragState = {
				sourceRegionFrom: this.region.from,
				sourcePath: containerPath.map((entry) => ({...entry})),
				sourceIndex: index,
				dropHandled: false,
			};
			this.startDragPointerTracking(e);
			item.classList.add("column-dragging");
		});

		item.addEventListener("dragover", (e: DragEvent) => {
			if (!activeDragState) return;
			e.preventDefault();
			e.stopPropagation();
			if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
			item.classList.add("column-drag-over");
		});

		item.addEventListener("dragleave", () => {
			item.classList.remove("column-drag-over");
		});

		item.addEventListener("drop", (e: DragEvent) => {
			if (!activeDragState) return;
			e.preventDefault();
			e.stopPropagation();
			if (!e.dataTransfer) return;
			item.classList.remove("column-drag-over");
			const source = activeDragState;
			source.dropHandled = true;
			if (source.sourceRegionFrom === this.region.from) {
				this.moveColumnBetweenContainers(
					source.sourcePath,
					source.sourceIndex,
					containerPath,
					index,
					view,
				);
				return;
			}
			this.moveColumnBetweenBlocks(source, containerPath, index, view);
		});

		item.addEventListener("dragend", (e: DragEvent) => {
			if (e.target !== item) return;
			e.stopPropagation();
			item.classList.remove("column-dragging");
			item.setAttribute("draggable", "false");
			const source = activeDragState;
			if (
				source &&
				!source.dropHandled &&
				this.shouldInsertDraggedBlockAtCursor(e, view)
			) {
				this.moveColumnToCursorBlock(source, view);
			}
			activeDragState = null;
			this.stopDragPointerTracking();
		});
	}

	private wireContextMenu(
		item: HTMLElement,
		index: number,
		columns: ColumnData[],
		containerStyle: ColumnStyleData | undefined,
		onChange: (
			nextColumns: ColumnData[],
			nextStyle: ColumnStyleData | undefined,
		) => void,
		actions?: ColumnContextActions,
		parentIndex?: number,
	): void {
		item.addEventListener("contextmenu", (e: MouseEvent) => {
			const target = e.target as HTMLElement;
			if (target.closest("textarea") || target.closest("input")) return;
			openColumnStyleContextMenu(e, {
				columnIndex: index,
				columns,
				onChange,
				containerStyle,
				parentIndex,
				actions,
			});
		});
	}

	// ── Cleanup ──────────────────────────────────────────────────

	private cleanupComponents(): void {
		for (const c of this.components) c.unload();
		this.components = [];
		for (const s of this.suggests) s.destroy();
		this.suggests = [];
	}
}
