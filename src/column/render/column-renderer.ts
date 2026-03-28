import {EditorView} from "@codemirror/view";
import {Component, MarkdownRenderer, Scope, setIcon} from "obsidian";
import {findColumnRegions, serializeColumns} from "../core/parser";
import {getPluginInstance} from "../core/plugin-ref";
import {ColumnEditorSuggest, SlashCommandSuggest} from "../editor/editor-suggest";
import {ThirdPartySuggestBridge} from "../editor/third-party-suggest";
import {restoreEditState, wireEditCore} from "../editor/column-editor";
import {openColumnStyleContextMenu} from "./style-context-menu";
import {applyColumnStyle, applyContainerStyle, COLOR_CSS} from "../core/column-style";
import type {ColumnData, ColumnLayout, ColumnRegion, ColumnStyleData} from "../core/types";
import type {StyleColorOption} from "../../settings";
import type {ColumnContextActions, ContainerPath} from "../core/widget-types";
import {getInteractionState} from "../editor/interaction-state";
import {buildResizeHandle} from "./column-resizer";
import {wireDragItem} from "./column-drag";
import {
	insertColumnAfter,
	insertColumnAfterOpposite,
	removeColumnPreservingWidths,
	addChildColumnToContent,
	dispatchUpdate,
} from "../core/column-serializer";

// ── Render Context ──────────────────────────────────────────

export interface RenderContext {
	region: ColumnRegion;
	view: EditorView;
	components: Component[];
	suggests: ColumnEditorSuggest[];
}

type SlashSuggestController = Pick<SlashCommandSuggest, "active" | "handleKeydown" | "handleInput">;

const DISABLED_SLASH_SUGGEST: SlashSuggestController = {
	active: false,
	handleKeydown: () => false,
	handleInput: () => {},
};

function createSlashSuggest(textarea: HTMLTextAreaElement): SlashSuggestController {
	const plugin = getPluginInstance();
	if (!plugin.settings.enableSlashSuggest) {
		return DISABLED_SLASH_SUGGEST;
	}
	return new SlashCommandSuggest(textarea);
}

// ── Column Grouping ─────────────────────────────────────────

export interface ColumnGroup {
	/** Indices into the flat columns array */
	indices: number[];
	/** True when this group contains consecutive stacked columns */
	isStack: boolean;
}

/**
 * Group consecutive columns with the same stack group ID together.
 * Non-stacked columns form single-element groups.
 * Different stack group IDs (stk:1, stk:2, etc.) form separate groups.
 */
export function groupColumns(columns: ReadonlyArray<ColumnData>): ColumnGroup[] {
	const groups: ColumnGroup[] = [];
	let i = 0;
	while (i < columns.length) {
		const stackId = columns[i]!.stacked;
		if (stackId && stackId > 0) {
			const start = i;
			while (i < columns.length && columns[i]!.stacked === stackId) i++;
			groups.push({indices: Array.from({length: i - start}, (_, k) => start + k), isStack: true});
		} else {
			groups.push({indices: [i], isStack: false});
			i++;
		}
	}
	return groups;
}

/**
 * Find all .column-item elements in order, including those inside
 * .columns-stack-group wrappers. Replaces `:scope > .column-item` queries.
 */
export function getColumnElements(container: HTMLElement): HTMLElement[] {
	const result: HTMLElement[] = [];
	for (const child of Array.from(container.children)) {
		if (!(child instanceof HTMLElement)) continue;
		if (child.classList.contains("column-item")) {
			result.push(child);
		} else if (child.classList.contains("columns-stack-group")) {
			for (const inner of Array.from(child.children)) {
				if (inner instanceof HTMLElement && inner.classList.contains("column-item")) {
					result.push(inner);
				}
			}
		}
	}
	return result;
}

// ── Separator Element Builder ────────────────────────────────

export function buildSeparatorElement(container: HTMLElement, col: ColumnData): void {
	const style = col.style;
	if (!style?.separator) return;

	const color = COLOR_CSS[style.separatorColor as StyleColorOption ?? "gray"] ?? COLOR_CSS.gray;

	if (style.separatorStyle === "custom" && style.separatorCustomChar) {
		const sep = document.createElement("div");
		sep.className = "column-separator-custom";
		sep.textContent = style.separatorCustomChar;
		sep.style.setProperty("--sep-color", color);
		if (style.separatorWidth) {
			sep.style.setProperty("--sep-size", `${style.separatorWidth * 6 + 6}px`);
		}
		container.appendChild(sep);
	} else {
		const sep = document.createElement("div");
		sep.className = "column-separator-visual";
		sep.style.setProperty("--sep-color", color);
		if (style.separatorWidth) {
			sep.style.setProperty("--sep-width", `${style.separatorWidth}px`);
		}
		if (style.separatorStyle && style.separatorStyle !== "custom") {
			sep.style.setProperty("--sep-style", style.separatorStyle);
		}
		container.appendChild(sep);
	}
}

// ── Compact Preview Spacing ─────────────────────────────────

export function applyCompactPreviewSpacing(target: HTMLElement): void {
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

// ── Markdown Rendering ──────────────────────────────────────

export function renderMarkdown(
	parent: HTMLElement,
	content: string,
	sourcePath: string,
	ctx: RenderContext,
	onContentChange?: (nextContent: string) => void,
): void {
	try {
		const plugin = getPluginInstance();
		const component = new Component();
		component.load();
		ctx.components.push(component);
		void MarkdownRenderer.render(plugin.app, content, parent, sourcePath, component).then(() => {
			// Unwrap <p> inside <li> (loose lists) so parent items render
			// identically to child items without block-level spacing artifacts.
			unwrapLooseListParagraphs(parent);
			// Mark list items that follow a blank line in the source with a gap class
			markListGaps(parent, content);
			if (onContentChange) {
				wireTaskCheckboxes(parent, content, onContentChange);
			}
		});
	} catch {
		const errEl = document.createElement("div");
		errEl.className = "column-render-error";
		errEl.textContent = "Failed to render content";
		parent.appendChild(errEl);
	}
}

/**
 * Unwrap <p> elements inside <li> (produced by loose lists with blank lines).
 * Moves the <p>'s children directly into the <li> and removes surrounding
 * whitespace-only text nodes so the DOM matches tight-list structure.
 */
function unwrapLooseListParagraphs(parent: HTMLElement): void {
	const ps = parent.querySelectorAll<HTMLElement>("li > p");
	ps.forEach((p) => {
		const li = p.parentElement!;
		while (p.firstChild) li.insertBefore(p.firstChild, p);
		p.remove();
		while (li.firstChild?.nodeType === 3 && !li.firstChild.textContent?.trim()) {
			li.firstChild.remove();
		}
		while (li.lastChild?.nodeType === 3 && !li.lastChild.textContent?.trim()) {
			li.lastChild.remove();
		}
	});
}

/**
 * Wire click handlers on task checkboxes in rendered markdown.
 * Clicking a checkbox toggles the character inside `[x]`/`[ ]`/`[/]` etc.
 */
function wireTaskCheckboxes(
	parent: HTMLElement,
	content: string,
	onContentChange: (nextContent: string) => void,
): void {
	const checkboxes = parent.querySelectorAll<HTMLInputElement>(
		"li.task-list-item > input[type='checkbox'], li.task-list-item > .task-list-item-checkbox",
	);
	if (checkboxes.length === 0) return;

	// Find all task lines in the content: lines matching `- [.] ` or `* [.] ` etc.
	const lines = content.split("\n");
	const taskLineIndices: number[] = [];
	for (let i = 0; i < lines.length; i++) {
		if (/^\s*[-*+] \[.\] /.test(lines[i]!)) {
			taskLineIndices.push(i);
		}
	}

	checkboxes.forEach((checkbox, idx) => {
		if (idx >= taskLineIndices.length) return;
		const lineIdx = taskLineIndices[idx]!;

		checkbox.addEventListener("click", (e) => {
			e.preventDefault();
			e.stopPropagation();
			const line = lines[lineIdx]!;
			const match = line.match(/^(\s*[-*+] \[)(.)(\] )/);
			if (!match) return;

			const currentStatus = match[2]!;
			// Toggle: unchecked → checked, anything else → unchecked
			const newStatus = currentStatus === " " ? "x" : " ";
			lines[lineIdx] = line.replace(/^(\s*[-*+] \[).\]/, `$1${newStatus}]`);
			onContentChange(lines.join("\n"));
		});
	});
}

/**
 * Detect blank lines between list items in the source and add a gap class
 * to the corresponding rendered <li> elements.
 */
function markListGaps(parent: HTMLElement, content: string): void {
	const lines = content.split("\n");
	const listPattern = /^(\s*)([-*+]( \[.\])?|\d+\.)\s/;

	// Find list item line indices and whether each is preceded by a blank line
	const listItems: {lineIdx: number; hasGapBefore: boolean}[] = [];
	for (let i = 0; i < lines.length; i++) {
		if (listPattern.test(lines[i]!)) {
			const hasGapBefore = i > 0 && lines[i - 1]!.trim() === "" && listItems.length > 0;
			listItems.push({lineIdx: i, hasGapBefore});
		}
	}

	// Match rendered <li> elements at the same depth level
	const renderedLists = parent.querySelectorAll<HTMLElement>(":scope > ul, :scope > ol");
	let itemIdx = 0;
	renderedLists.forEach((list) => {
		const items = list.querySelectorAll<HTMLElement>(":scope li");
		items.forEach((li) => {
			if (itemIdx < listItems.length && listItems[itemIdx]!.hasGapBefore) {
				li.classList.add("amc-list-gap");
			}
			itemIdx++;
		});
	});

	// Mark blank-line gaps between top-level block elements (p, headings, lists, etc.)
	markBlockGaps(parent, content);
}

/**
 * Detect blank lines between top-level blocks in markdown source and add
 * an `amc-block-gap` class to the rendered element that follows the gap.
 *
 * Strategy: split content into top-level "chunks" separated by blank lines.
 * Each chunk produces one or more rendered top-level children. We count
 * rendered children per chunk and mark the first child of each chunk
 * (after the first) with the gap class.
 */
function markBlockGaps(parent: HTMLElement, content: string): void {
	// Split into groups of non-blank lines separated by blank lines
	const groups: string[][] = [];
	let current: string[] = [];
	for (const line of content.split("\n")) {
		if (line.trim() === "") {
			if (current.length > 0) {
				groups.push(current);
				current = [];
			}
		} else {
			current.push(line);
		}
	}
	if (current.length > 0) groups.push(current);

	// If only one group or none, no gaps to mark
	if (groups.length <= 1) return;

	// Count how many top-level rendered children each group produces.
	// Each group of contiguous non-blank lines maps to one rendered block element
	// (a <p>, <ul>, <h1>, <blockquote>, etc.) — except list items which stay in
	// one <ul>/<ol> until interrupted by a blank line.
	const children = Array.from(parent.querySelectorAll<HTMLElement>(":scope > *"));
	// With blank-line separation, markdown typically produces one top-level element
	// per group. Mark child elements starting from the second group.
	let childIdx = 0;
	for (let g = 0; g < groups.length; g++) {
		if (childIdx >= children.length) break;
		if (g > 0) {
			children[childIdx]!.classList.add("amc-block-gap");
		}
		childIdx++;
	}
}

// ── Column Selection ────────────────────────────────────────

function clearColumnSelection(view: EditorView): void {
	const iState = getInteractionState(view);
	if (iState.selectionContainerEl) {
		iState.selectionContainerEl.querySelectorAll(".column-selected").forEach(
			(el) => el.classList.remove("column-selected"),
		);
	}
	iState.selectedColumns.clear();
	iState.selectionContainerEl = null;
}

function ensureSelectionClearOnNormalClick(view: EditorView): void {
	const iState = getInteractionState(view);
	if (iState.cleanupSelectionClickTracking) return;

	const clearOnClick = (e: MouseEvent) => {
		// Primary-button plain click clears selection anywhere (inside or outside columns).
		if (e.button !== 0) return;
		if (e.ctrlKey || e.metaKey) return;

		const nextState = getInteractionState(view);
		if (!view.dom.isConnected) {
			nextState.cleanupSelectionClickTracking?.();
			nextState.cleanupSelectionClickTracking = null;
			return;
		}
		if (nextState.selectedColumns.size === 0) return;
		clearColumnSelection(view);
	};

	document.addEventListener("click", clearOnClick, true);
	iState.cleanupSelectionClickTracking = () => {
		document.removeEventListener("click", clearOnClick, true);
	};
}

function wireColumnSelection(
	item: HTMLElement,
	index: number,
	container: HTMLElement,
	view: EditorView,
): void {
	item.addEventListener("click", (e: MouseEvent) => {
		// Let toolbar action buttons (add/drag) handle their own Ctrl+Click
		const target = e.target as HTMLElement;
		if (target.closest(".column-toolbar-actions")) return;

		if (!e.ctrlKey && !e.metaKey) {
			const iState = getInteractionState(view);
			if (iState.selectedColumns.size > 0) clearColumnSelection(view);
			return;
		}
		e.preventDefault();
		e.stopPropagation();

		const iState = getInteractionState(view);
		if (iState.selectionContainerEl !== container) {
			clearColumnSelection(view);
			iState.selectionContainerEl = container;
		}

		if (iState.selectedColumns.has(index)) {
			iState.selectedColumns.delete(index);
			item.classList.remove("column-selected");
		} else {
			iState.selectedColumns.add(index);
			item.classList.add("column-selected");
		}
	}, true); // capture phase to intercept before preview click
}

// ── Context Menu ────────────────────────────────────────────

export function wireContextMenu(
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
	containerEl?: HTMLElement,
	layout?: ColumnLayout,
	onLayoutChange?: (nextLayout: ColumnLayout | undefined) => void,
	view?: EditorView,
): void {
	item.addEventListener("contextmenu", (e: MouseEvent) => {
		const target = e.target as HTMLElement;
		if (target.closest("textarea") || target.closest("input")) return;

		let selectedIndices: Set<number> | undefined;
		if (view && containerEl) {
			const iState = getInteractionState(view);
			if (iState.selectionContainerEl === containerEl && iState.selectedColumns.size > 0) {
				// Include the right-clicked column in selection
				selectedIndices = new Set(iState.selectedColumns);
				selectedIndices.add(index);
			}
		}

		openColumnStyleContextMenu(e, {
			columnIndex: index,
			columns,
			onChange,
			containerStyle,
			layout,
			onLayoutChange,
			parentIndex,
			actions,
			containerEl,
			selectedIndices,
		});
	});
}

// ── Commit Edit Helper ──────────────────────────────────────

function commitEdit(editedIndex: number, newContent: string, ctx: RenderContext): void {
	const updated = ctx.region.columns.map((col, i) =>
		i === editedIndex ? {...col, content: newContent} : col,
	);
	dispatchUpdate(ctx.region, updated, ctx.view);
}

// ── Top-level Edit Toggle ───────────────────────────────────

function wireTopLevelEditToggle(
	container: HTMLElement,
	previewEl: HTMLElement,
	textarea: HTMLTextAreaElement,
	index: number,
	suggest: ColumnEditorSuggest,
	slashSuggest: SlashSuggestController,
	thirdPartySuggest: ThirdPartySuggestBridge,
	ctx: RenderContext,
): void {
	// Scope to intercept Obsidian hotkeys (e.g. Ctrl+L) while editing
	const plugin = getPluginInstance();
	const editScope = new Scope(plugin.app.scope);
	editScope.register(["Mod"], "l", (evt) => {
		if (!textarea.parentElement?.classList.contains("is-editing")) return;
		evt.preventDefault();
		const cursor = textarea.selectionStart;
		const val = textarea.value;
		const lineStart = val.lastIndexOf("\n", cursor - 1) + 1;
		const lineEnd = val.indexOf("\n", cursor);
		const line = val.substring(lineStart, lineEnd === -1 ? val.length : lineEnd);
		const lineLen = line.length;

		let newLine: string;
		if (/^\s*- \[ \] /.test(line)) {
			// Unchecked → checked
			newLine = line.replace(/^(\s*)- \[ \] /, "$1- [x] ");
		} else if (/^\s*- \[.\] /.test(line)) {
			// Checked → unchecked
			newLine = line.replace(/^(\s*)- \[.\] /, "$1- [ ] ");
		} else if (/^\s*[-*+] /.test(line)) {
			newLine = line.replace(/^(\s*)([-*+]) /, "$1- [ ] ");
		} else if (/^\s*\d+\. /.test(line)) {
			newLine = line.replace(/^(\s*)\d+\. /, "$1- [ ] ");
		} else {
			newLine = line.replace(/^(\s*)/, "$1- [ ] ");
		}

		const cursorShift = newLine.length - lineLen;
		textarea.value = val.substring(0, lineStart) + newLine + val.substring(lineStart + lineLen);
		textarea.selectionStart = textarea.selectionEnd = Math.max(lineStart, cursor + cursorShift);
		textarea.dispatchEvent(new Event("input", {bubbles: true}));
		return false;
	});

	wireEditCore({
		container,
		previewEl,
		textarea,
		suggest,
		slashSuggest,
		thirdPartySuggest,
		getContent: () => ctx.region.columns[index]!.content,
		onCommit: (nextContent) => commitEdit(index, nextContent, ctx),
		onEnterEdit: () => {
			plugin.app.keymap.pushScope(editScope);
			getInteractionState(ctx.view).activeEdit = {
				regionFrom: ctx.region.from,
				columnIndex: index,
				cursorStart: textarea.value.length,
				cursorEnd: textarea.value.length,
				scrollTop: 0,
				value: textarea.value,
			};
		},
		onCommitClose: () => {
			plugin.app.keymap.popScope(editScope);
			getInteractionState(ctx.view).activeEdit = null;
		},
		clickGuard: (target) => !!target.closest(".columns-nested"),
		blurDelay: 200,
		onKeydown: (e) => {
			const listPattern = /^(\s*)([-*+]( \[.\])?|\d+\.)\s/;

			// ── Enter: auto-continue lists ──
			if (e.key === "Enter" && !e.shiftKey) {
				const cursor = textarea.selectionStart;
				const val = textarea.value;
				const lineStart = val.lastIndexOf("\n", cursor - 1) + 1;
				const line = val.substring(lineStart, cursor);
				const match = line.match(listPattern);
				if (match) {
					const indent = match[1]!;
					const marker = match[2]!;
					const afterMarker = line.substring(match[0].length);
					// If the line is just a bare marker with nothing after, remove it (exit list)
					if (afterMarker.trim() === "") {
						e.preventDefault();
						textarea.value = val.substring(0, lineStart) + val.substring(cursor);
						textarea.selectionStart = textarea.selectionEnd = lineStart;
						textarea.dispatchEvent(new Event("input", {bubbles: true}));
						return true;
					}
					// Auto-continue: insert newline + same indent + marker
					e.preventDefault();
					// For numbered lists, increment the number
					let nextMarker = marker;
					const numMatch = marker.match(/^(\d+)\./);
					if (numMatch) {
						nextMarker = (parseInt(numMatch[1]!) + 1) + ".";
					}
					// For task lists, reset checkbox to unchecked
					if (/\[.\]/.test(marker)) {
						nextMarker = marker.replace(/\[.\]/, "[ ]");
					}
					const insertion = "\n" + indent + nextMarker + " ";
					const before = val.substring(0, cursor);
					const after = val.substring(cursor);
					textarea.value = before + insertion + after;
					textarea.selectionStart = textarea.selectionEnd = cursor + insertion.length;
					textarea.dispatchEvent(new Event("input", {bubbles: true}));
					return true;
				}
			}

			// ── Tab: indent list items or navigate columns ──
			if (e.key === "Tab") {
				const cursor = textarea.selectionStart;
				const val = textarea.value;
				const lineStart = val.lastIndexOf("\n", cursor - 1) + 1;
				const lineEnd = val.indexOf("\n", cursor);
				const line = val.substring(lineStart, lineEnd === -1 ? val.length : lineEnd);

				if (listPattern.test(line)) {
					e.preventDefault();
					if (e.shiftKey) {
						// Unindent: remove one tab or up to 4 leading spaces
						const stripped = line.replace(/^\t/, "").length < line.length
							? val.substring(0, lineStart) + line.replace(/^\t/, "") + val.substring(lineStart + line.length)
							: val.substring(0, lineStart) + line.replace(/^ {1,4}/, "") + val.substring(lineStart + line.length);
						const removed = val.length - stripped.length;
						textarea.value = stripped;
						textarea.selectionStart = textarea.selectionEnd = Math.max(lineStart, cursor - removed);
					} else {
						// Indent: insert a tab at start of line; reset numbered list to 1
						const indented = line.replace(/^(\s*)\d+\./, "$11.");
						textarea.value = val.substring(0, lineStart) + "\t" + indented + val.substring(lineStart + line.length);
						const shift = 1 + indented.length - line.length;
						textarea.selectionStart = textarea.selectionEnd = cursor + shift;
					}
					textarea.dispatchEvent(new Event("input", {bubbles: true}));
					return true;
				}

				// Not a list line — navigate columns
				e.preventDefault();
				textarea.parentElement!.classList.remove("is-editing");
				const newContent = textarea.value;
				plugin.app.keymap.popScope(editScope);
				getInteractionState(ctx.view).activeEdit = null;
				if (newContent !== ctx.region.columns[index]!.content) {
					commitEdit(index, newContent, ctx);
				}
				const dir = e.shiftKey ? -1 : 1;
				const next = index + dir;
				if (next >= 0 && next < ctx.region.columns.length) {
					const allItems = getColumnElements(container);
					const nextItem = allItems[next];
					const nextPreview = nextItem?.querySelector<HTMLElement>(".column-preview");
					if (nextPreview) {
						setTimeout(() => nextPreview.click(), 50);
					}
				}
				return true;
			}
			requestAnimationFrame(() => {
				const iState = getInteractionState(ctx.view);
				if (iState.activeEdit && iState.activeEdit.regionFrom === ctx.region.from && iState.activeEdit.columnIndex === index) {
					iState.activeEdit.cursorStart = textarea.selectionStart;
					iState.activeEdit.cursorEnd = textarea.selectionEnd;
					iState.activeEdit.scrollTop = textarea.scrollTop;
					iState.activeEdit.value = textarea.value;
				}
			});
			return false;
		},
	});

	textarea.addEventListener("input", () => {
		const iStateInput = getInteractionState(ctx.view);
		if (iStateInput.activeEdit && iStateInput.activeEdit.regionFrom === ctx.region.from && iStateInput.activeEdit.columnIndex === index) {
			iStateInput.activeEdit.value = textarea.value;
		}
	});
}

// ── Nested Edit Toggle ──────────────────────────────────────

function wireNestedEditToggle(
	container: HTMLElement,
	previewEl: HTMLElement,
	textarea: HTMLTextAreaElement,
	getCurrentContent: () => string,
	onCommit: (nextContent: string) => void,
	ctx: RenderContext,
): void {
	const plugin = getPluginInstance();
	const suggest = new ColumnEditorSuggest(textarea, plugin.app);
	const slashSuggest = createSlashSuggest(textarea);
	const tpSuggest = new ThirdPartySuggestBridge(textarea, plugin.app);
	ctx.suggests.push(suggest);

	wireEditCore({
		container,
		previewEl,
		textarea,
		suggest,
		slashSuggest,
		thirdPartySuggest: tpSuggest,
		getContent: getCurrentContent,
		onCommit,
		clickGuard: (target) => {
			const currentNested = previewEl.closest(".columns-nested");
			const clickedNested = target.closest(".columns-nested");
			return !!(currentNested && clickedNested && clickedNested !== currentNested);
		},
		blurDelay: 180,
	});
}

// ── Editable Text Segment ───────────────────────────────────

function renderEditableTextSegment(
	parent: HTMLElement,
	initialText: string,
	sourcePath: string,
	onCommit: (nextText: string) => void,
	ctx: RenderContext,
): void {
	const block = document.createElement("div");
	block.className = "column-inline-edit-block";
	parent.appendChild(block);

	const preview = document.createElement("div");
	preview.className = "column-inline-edit-preview markdown-rendered";
	applyCompactPreviewSpacing(preview);
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
		renderMarkdown(preview, text, sourcePath, ctx, onCommit);
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
	const slashSuggest = createSlashSuggest(textarea);
	const tpSuggest = new ThirdPartySuggestBridge(textarea, plugin.app);
	ctx.suggests.push(suggest);

	let currentText = initialText;

	wireEditCore({
		container: block,
		previewEl: preview,
		textarea,
		suggest,
		slashSuggest,
		thirdPartySuggest: tpSuggest,
		getContent: () => currentText,
		onCommit: (nextText) => {
			currentText = nextText;
			onCommit(nextText);
		},
		blurDelay: 180,
	});
}

// ── Column Content (recursive) ──────────────────────────────

function renderColumnContent(
	parent: HTMLElement,
	content: string,
	sourcePath: string,
	depth: number,
	onContentChange: (nextContent: string) => void,
	containerPath: ContainerPath,
	columnIndex: number,
	ctx: RenderContext,
): void {
	if (depth > 8) {
		renderMarkdown(parent, content, sourcePath, ctx, onContentChange);
		return;
	}

	const regions = findColumnRegions(content);
	if (regions.length === 0) {
		renderMarkdown(parent, content, sourcePath, ctx, onContentChange);
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

			renderEditableTextSegment(
				parent,
				part.text,
				sourcePath,
				(nextText) => {
					const nextContent = content.slice(0, part.from) + nextText + content.slice(part.to);
					onContentChange(nextContent);
				},
				ctx,
			);
			continue;
		}

		const region = part.region;
		const nestedContainerPath: ContainerPath = [
			...containerPath,
			{columnIndex, regionIndex: part.regionIndex},
		];
		renderNestedRegion(
			parent,
			region,
			sourcePath,
			depth + 1,
			(nextRegionColumns, nextRegionContainerStyle) => {
				const nextContent =
					content.slice(0, region.from) +
					serializeColumns(nextRegionColumns, nextRegionContainerStyle, region.layout) +
					content.slice(region.to);
				onContentChange(nextContent);
			},
			() => {
				const nextContent = content.slice(0, region.from) + content.slice(region.to);
				onContentChange(nextContent);
			},
			nestedContainerPath,
			ctx,
			(nextLayout) => {
				const nextContent =
					content.slice(0, region.from) +
					serializeColumns(region.columns, region.containerStyle, nextLayout) +
					content.slice(region.to);
				onContentChange(nextContent);
			},
		);
	}
}

// ── Nested Region ───────────────────────────────────────────

function renderNestedRegion(
	parent: HTMLElement,
	region: ColumnRegion,
	sourcePath: string,
	depth: number,
	onRegionChange: (
		nextColumns: ColumnData[],
		nextStyle: ColumnStyleData | undefined,
	) => void,
	onRemoveRegion: () => void,
	containerPath: ContainerPath,
	ctx: RenderContext,
	onLayoutChange?: (nextLayout: ColumnLayout | undefined) => void,
): void {
	const container = document.createElement("div");
	container.className = "columns-container columns-ui columns-nested";
	const isContainerStacked = region.layout === "stack";
	if (isContainerStacked) container.classList.add("columns-stacked");
	applyContainerStyle(container, region.containerStyle);
	parent.appendChild(container);

	const groups = isContainerStacked
		? [{indices: region.columns.map((_, i) => i), isStack: true}]
		: groupColumns(region.columns);

	for (let gi = 0; gi < groups.length; gi++) {
		const group = groups[gi]!;

		if (gi > 0 && !isContainerStacked) {
			const prevGroup = groups[gi - 1]!;
			const leftIndex = prevGroup.indices[prevGroup.indices.length - 1]!;
			buildResizeHandle(container, leftIndex, region.columns, (nextColumns) => {
				onRegionChange(nextColumns, region.containerStyle);
			});
		}

		if (gi > 0 && isContainerStacked) {
			const prevGroup = groups[gi - 1]!;
			buildSeparatorElement(container, region.columns[prevGroup.indices[prevGroup.indices.length - 1]!]!);
		}

		// A single-column stack group renders as a normal column (no wrapper needed)
		const useStackWrapper = group.isStack && !isContainerStacked && group.indices.length > 1;
		let groupParent: HTMLElement;
		if (useStackWrapper) {
			const stackGroupEl = document.createElement("div");
			stackGroupEl.className = "columns-stack-group";
			const maxWidth = Math.max(...group.indices.map((idx) => region.columns[idx]!.widthPercent));
			if (maxWidth > 0) {
				const handleTotal = (groups.length - 1) * 8;
				const shrink = handleTotal / groups.length;
				stackGroupEl.style.flex = `0 0 calc(${maxWidth}% - ${shrink.toFixed(1)}px)`;
			}
			container.appendChild(stackGroupEl);
			groupParent = stackGroupEl;
		} else {
			groupParent = container;
		}

		for (let gi2 = 0; gi2 < group.indices.length; gi2++) {
			const i = group.indices[gi2]!;
			const col = region.columns[i]!;

			if (gi2 > 0 && group.isStack) {
				buildSeparatorElement(groupParent, region.columns[group.indices[gi2 - 1]!]!);
			}

			const colEl = document.createElement("div");
			colEl.className = "column-item";
			colEl.dataset.colIndex = String(i);
			if (useStackWrapper) {
				// Stacked: full width via CSS
			} else if (!isContainerStacked && col.widthPercent > 0) {
				const handleTotal = (groups.length - 1) * 8;
				const shrink = handleTotal / groups.length;
				colEl.style.flex = `0 0 calc(${col.widthPercent}% - ${shrink.toFixed(1)}px)`;
			}
			applyColumnStyle(colEl, col.style);
			groupParent.appendChild(colEl);

			const toolbar = document.createElement("div");
			toolbar.className = "column-toolbar";

			const dragHandle = document.createElement("span");
			dragHandle.className = "column-drag-handle";
			dragHandle.setAttribute("aria-label", "Drag to reorder");
			setIcon(dragHandle, "grip-vertical");

			const isStacked = !!(col.stacked && col.stacked > 0);
			const addBtn = document.createElement("button");
			addBtn.className = "column-add-btn";
			addBtn.setAttribute("aria-label", isStacked ? "Add stacked item below" : "Add column to the right");
			setIcon(addBtn, "plus");
			addBtn.addEventListener("click", (e) => {
				e.preventDefault();
				e.stopPropagation();
				const updated = e.ctrlKey || e.metaKey
					? insertColumnAfterOpposite(region.columns, i)
					: insertColumnAfter(region.columns, i);
				onRegionChange(updated, region.containerStyle);
			});

			const toolbarActions = document.createElement("div");
			toolbarActions.className = "column-toolbar-actions";
			toolbarActions.appendChild(addBtn);
			toolbarActions.appendChild(dragHandle);

			toolbar.appendChild(toolbarActions);
			colEl.appendChild(toolbar);

			wireDragItem(colEl, dragHandle, containerPath, i, ctx.view, ctx.region);
			wireColumnSelection(colEl, i, container, ctx.view);
			wireContextMenu(
				colEl,
				i,
				region.columns,
				region.containerStyle,
				(nextColumns, nextContainerStyle) => {
					onRegionChange(nextColumns, nextContainerStyle);
				},
				{
					addColumn: () => {
						const updated = insertColumnAfter(region.columns, i);
						onRegionChange(updated, region.containerStyle);
					},
					addChild: () => {
						const nextChildContent = addChildColumnToContent(col.content);
						const updated = region.columns.map((c, idx) =>
							idx === i ? {...c, content: nextChildContent} : c,
						);
						onRegionChange(updated, region.containerStyle);
					},
					deleteColumn: () => {
						if (region.columns.length <= 1) {
							onRemoveRegion();
							return;
						}
						const updated = removeColumnPreservingWidths(region.columns, i);
						onRegionChange(updated, region.containerStyle);
					},
				},
				containerPath[containerPath.length - 1]?.columnIndex !== undefined
					? containerPath[containerPath.length - 1]!.columnIndex + 1
					: undefined,
				container,
				region.layout,
				onLayoutChange,
				ctx.view,
			);

			const previewEl = document.createElement("div");
			previewEl.className = "column-preview markdown-rendered";
			applyCompactPreviewSpacing(previewEl);
			colEl.appendChild(previewEl);
			const hasNestedRegions = findColumnRegions(col.content).length > 0;

			if (col.content.length > 0) {
				renderColumnContent(
					previewEl,
					col.content,
					sourcePath,
					depth,
					(nextChildContent) => {
						const updated = region.columns.map((c, idx) =>
							idx === i ? {...c, content: nextChildContent} : c,
						);
						onRegionChange(updated, region.containerStyle);
					},
					containerPath,
					i,
					ctx,
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

				wireNestedEditToggle(
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
					ctx,
				);
			}
		}
	}
}

// ── Build Columns (top-level) ───────────────────────────────

export function buildColumns(container: HTMLElement, ctx: RenderContext): void {
	const {columns} = ctx.region;
	const isContainerStacked = ctx.region.layout === "stack";
	if (isContainerStacked) container.classList.add("columns-stacked");
	const plugin = getPluginInstance();
	const activeFile = plugin.app.workspace.getActiveFile();
	const sourcePath = activeFile?.path ?? "";

	// Clear any stale selection state when the container is rebuilt
	// (updateDOM reuses the same DOM element but empties its children,
	// so previous selections are no longer valid)
	const iStateInit = getInteractionState(ctx.view);
	if (iStateInit.selectionContainerEl === container) {
		iStateInit.selectedColumns.clear();
		iStateInit.selectionContainerEl = null;
	}
	ensureSelectionClearOnNormalClick(ctx.view);

	// Clear column selection on regular (non-Ctrl/Meta) clicks anywhere in the container
	container.addEventListener("click", (e: MouseEvent) => {
		if (!e.ctrlKey && !e.metaKey) {
			clearColumnSelection(ctx.view);
		}
	});

	const groups = isContainerStacked ? [{indices: columns.map((_, i) => i), isStack: true}] : groupColumns(columns);

	for (let gi = 0; gi < groups.length; gi++) {
		const group = groups[gi]!;

		// Resize handle between groups
		if (gi > 0 && !isContainerStacked) {
			const prevGroup = groups[gi - 1]!;
			const leftIndex = prevGroup.indices[prevGroup.indices.length - 1]!;
			buildResizeHandle(container, leftIndex, columns, (updated) => {
				dispatchUpdate(ctx.region, updated, ctx.view);
			});
		}

		// Separator between groups in container-stacked mode
		if (gi > 0 && isContainerStacked) {
			const prevGroup = groups[gi - 1]!;
			buildSeparatorElement(container, columns[prevGroup.indices[prevGroup.indices.length - 1]!]!);
		}

		// Create stack group wrapper if needed (skip for single-column groups)
		const useStackWrapper = group.isStack && !isContainerStacked && group.indices.length > 1;
		let groupParent: HTMLElement;
		if (useStackWrapper) {
			const stackGroupEl = document.createElement("div");
			stackGroupEl.className = "columns-stack-group";
			const maxWidth = Math.max(...group.indices.map((idx) => columns[idx]!.widthPercent));
			if (maxWidth > 0) {
				const handleTotal = (groups.length - 1) * 8;
				const shrink = handleTotal / groups.length;
				stackGroupEl.style.flex = `0 0 calc(${maxWidth}% - ${shrink.toFixed(1)}px)`;
			}
			container.appendChild(stackGroupEl);
			groupParent = stackGroupEl;
		} else {
			groupParent = container;
		}

		for (let gi2 = 0; gi2 < group.indices.length; gi2++) {
			const i = group.indices[gi2]!;
			const col = columns[i]!;

			// Separator between stacked columns within a group
			if (gi2 > 0 && group.isStack) {
				buildSeparatorElement(groupParent, columns[group.indices[gi2 - 1]!]!);
			}

			const colEl = document.createElement("div");
			colEl.className = "column-item";
			if (useStackWrapper) {
				// Stacked columns: full width via CSS
			} else if (!isContainerStacked && col.widthPercent > 0) {
				const handleTotal = (groups.length - 1) * 8;
				const shrink = handleTotal / groups.length;
				colEl.style.flex = `0 0 calc(${col.widthPercent}% - ${shrink.toFixed(1)}px)`;
			}
			applyColumnStyle(colEl, col.style);
			colEl.dataset.colIndex = String(i);
			groupParent.appendChild(colEl);

			try {
				const hasNestedRegions = findColumnRegions(col.content).length > 0;

				const toolbar = document.createElement("div");
				toolbar.className = "column-toolbar";

				const dragHandle = document.createElement("span");
				dragHandle.className = "column-drag-handle";
				dragHandle.setAttribute("aria-label", "Drag to reorder");
				setIcon(dragHandle, "grip-vertical");

				const isStacked = !!(col.stacked && col.stacked > 0);
				const addBtn = document.createElement("button");
				addBtn.className = "column-add-btn";
				addBtn.setAttribute("aria-label", isStacked ? "Add stacked item below" : "Add column to the right");
				setIcon(addBtn, "plus");
				addBtn.addEventListener("click", (e) => {
					e.preventDefault();
					e.stopPropagation();
					const updated = e.ctrlKey || e.metaKey
						? insertColumnAfterOpposite(columns, i)
						: insertColumnAfter(columns, i);
					dispatchUpdate(ctx.region, updated, ctx.view);
				});

				const toolbarActions = document.createElement("div");
				toolbarActions.className = "column-toolbar-actions";
				toolbarActions.appendChild(addBtn);
				toolbarActions.appendChild(dragHandle);

				toolbar.appendChild(toolbarActions);
				colEl.appendChild(toolbar);

				const previewEl = document.createElement("div");
				previewEl.className = "column-preview markdown-rendered";
				applyCompactPreviewSpacing(previewEl);
				colEl.appendChild(previewEl);

				if (col.content.length === 0) {
					const ph = document.createElement("div");
					ph.className = "column-empty-placeholder";
					ph.textContent = "Click to edit";
					previewEl.appendChild(ph);
				} else {
					renderColumnContent(
						previewEl,
						col.content,
						sourcePath,
						0,
						(nextContent) => {
							commitEdit(i, nextContent, ctx);
						},
						[],
						i,
						ctx,
					);
				}

				if (!hasNestedRegions) {
					const textarea = document.createElement("textarea");
					textarea.className = "column-editor";
					textarea.value = col.content;
					textarea.spellcheck = false;
					textarea.placeholder = "Type here";
					colEl.appendChild(textarea);

					const suggest = new ColumnEditorSuggest(textarea, plugin.app);
					const slashSuggest = createSlashSuggest(textarea);
					const tpSuggest = new ThirdPartySuggestBridge(textarea, plugin.app);
					ctx.suggests.push(suggest);
					wireTopLevelEditToggle(container, previewEl, textarea, i, suggest, slashSuggest, tpSuggest, ctx);

					const iState = getInteractionState(ctx.view);
					if (iState.activeEdit && iState.activeEdit.regionFrom === ctx.region.from && iState.activeEdit.columnIndex === i) {
						restoreEditState(textarea, ctx.view);
					}
				}

				wireDragItem(colEl, dragHandle, [], i, ctx.view, ctx.region);
				wireColumnSelection(colEl, i, container, ctx.view);
				wireContextMenu(
					colEl,
					i,
					columns,
					ctx.region.containerStyle,
					(nextColumns, nextContainerStyle) => {
						dispatchUpdate(ctx.region, nextColumns, ctx.view, nextContainerStyle);
					},
					{
						addColumn: () => {
							const updated = insertColumnAfter(columns, i);
							dispatchUpdate(ctx.region, updated, ctx.view);
						},
						addChild: () => {
							const nextContent = addChildColumnToContent(col.content);
							commitEdit(i, nextContent, ctx);
						},
						deleteColumn: () => {
							if (columns.length <= 1) return;
							const updated = removeColumnPreservingWidths(columns, i);
							dispatchUpdate(ctx.region, updated, ctx.view);
						},
					},
					undefined,
					container,
					ctx.region.layout,
					(nextLayout) => {
						ctx.view.dispatch({
							changes: {
								from: ctx.region.from,
								to: ctx.region.to,
								insert: serializeColumns(columns, ctx.region.containerStyle, nextLayout),
							},
						});
					},
					ctx.view,
				);
			} catch {
				const errEl = document.createElement("div");
				errEl.className = "column-render-error";
				errEl.textContent = "Failed to render column";
				colEl.appendChild(errEl);
			}
		}
	}
}
