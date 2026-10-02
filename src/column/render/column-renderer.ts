import {EditorView} from "@codemirror/view";
import {Component, MarkdownRenderer, Scope, setIcon} from "obsidian";
import {findColumnRegions, serializeColumns} from "../core/parser";
import {getPluginInstance} from "../core/plugin-ref";
import {ColumnEditorSuggest, SlashCommandSuggest} from "../editor/editor-suggest";
import {ThirdPartySuggestBridge} from "../editor/third-party-suggest";
import {restoreEditState, wireEditCore} from "../editor/column-editor";
import {isEmbeddedEditorAvailable} from "../editor/embedded-editor";
import {wireLivePreviewEdit} from "../editor/live-edit";
import type {LiveEditHandle} from "../editor/live-edit";
import {openColumnStyleContextMenu} from "./style-context-menu";
import {applyColumnStyle, applyContainerStyle, BACKGROUND_CSS, COLOR_CSS, HEADER_BORDER_CSS} from "../core/column-style";
import type {ColumnData, ColumnLayout, ColumnRegion, ColumnStyleData} from "../core/types";
import type {StyleColorOption} from "../../settings";
import type {ColumnContextActions, ContainerPath} from "../core/widget-types";
import {isInteractivePreviewTarget} from "../core/widget-types";
import {getInteractionState} from "../editor/interaction-state";
import {refreshRegionPosition} from "../core/region-position";
import {buildResizeHandle} from "./column-resizer";
import {wireDragItem} from "./column-drag";
import {
	insertColumnAfter,
	insertColumnAfterOpposite,
	removeColumnPreservingWidths,
	addChildColumnToContent,
	dispatchUpdate,
} from "../core/column-serializer";

// ── Column Header Parsing ───────────────────────────────────

const HEADER_RE = /^!(\w[\w-]*)\s*:\s*(.*)$/;

export function parseColumnHeader(content: string): {type: string; title: string; restContent: string} | null {
	const lines = content.split("\n");
	for (let i = 0; i < lines.length; i++) {
		const trimmed = lines[i]!.trim();
		if (trimmed.length === 0) continue;
		const match = trimmed.match(HEADER_RE);
		if (!match) return null;
		const rest = [...lines.slice(0, i), ...lines.slice(i + 1)].join("\n").trim();
		return {type: match[1]!, title: match[2]!.trim(), restContent: rest};
	}
	return null;
}

function renderColumnHeader(colEl: HTMLElement, content: string): string {
	const plugin = getPluginInstance();
	if (!plugin.settings.enableHeaders) return content;

	const parsed = parseColumnHeader(content);
	if (!parsed) return content;

	const config = plugin.settings.headerTypes.find((h) => h.id === parsed.type);
	if (!config) return content;

	const headerEl = colEl.createDiv({cls: "column-header"});
	headerEl.style.background = BACKGROUND_CSS[config.background] ?? "transparent";
	headerEl.style.color = COLOR_CSS[config.textColor] ?? "var(--text-muted)";
	headerEl.style.fontSize = `${config.fontSize ?? 0.85}em`;
	headerEl.style.fontWeight = String(config.fontWeight ?? 600);

	const iconEl = headerEl.createSpan({cls: "column-header-icon"});
	setIcon(iconEl, config.icon);

	if (parsed.title) {
		headerEl.createSpan({cls: "column-header-title", text: parsed.title});
	}

	// Set the left-border accent color from the header background so it
	// reads like an Obsidian callout when left-border mode is enabled.
	const borderColor = HEADER_BORDER_CSS[config.background];
	if (borderColor) {
		colEl.style.setProperty("--columns-left-border-color", borderColor);
	}

	return parsed.restContent;
}

// ── Render Context ──────────────────────────────────────────

export interface RenderContext {
	region: ColumnRegion;
	/** Source text of the whole block. */
	source: string;
	view: EditorView;
	/** Path of the note that owns the editor (not necessarily the active file). */
	sourcePath: string;
	components: Component[];
	suggests: ColumnEditorSuggest[];
}

/** Stable id of a column editor inside its top-level block. */
function editKey(containerPath: ContainerPath, columnIndex: number): string {
	let key = "";
	for (const entry of containerPath) key += `c${entry.columnIndex}.r${entry.regionIndex}/`;
	return `${key}c${columnIndex}`;
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
		if (!child.instanceOf(HTMLElement)) continue;
		if (child.classList.contains("column-item")) {
			result.push(child);
		} else if (child.classList.contains("columns-stack-group")) {
			for (const inner of Array.from(child.children)) {
				if (inner.instanceOf(HTMLElement) && inner.classList.contains("column-item")) {
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
		const sep = container.createDiv({cls: "column-separator-custom"});
		sep.textContent = style.separatorCustomChar;
		sep.style.setProperty("--sep-color", color);
		if (style.separatorWidth) {
			sep.style.setProperty("--sep-size", `${style.separatorWidth * 6 + 6}px`);
		}
	} else {
		const sep = container.createDiv({cls: "column-separator-visual"});
		sep.style.setProperty("--sep-color", color);
		if (style.separatorWidth) {
			sep.style.setProperty("--sep-width", `${style.separatorWidth}px`);
		}
		if (style.separatorStyle && style.separatorStyle !== "custom") {
			sep.style.setProperty("--sep-style", style.separatorStyle);
		}
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
			// Tag link-only paragraphs so their spacing rules can target a class
			// instead of relying on the :has() selector.
			markLinkLines(parent);
			if (onContentChange) {
				wireTaskCheckboxes(parent, content, onContentChange);
			}
		});
	} catch {
		parent.createDiv({cls: "column-render-error", text: "Failed to render content"});
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
 * Tag paragraphs whose only element children are anchors (and <br>) with the
 * `amc-link-line` class. Replaces the `p:has(> a)…` selectors so spacing for
 * link-only paragraphs (e.g. consecutive wikilinks) can be styled by class.
 */
function markLinkLines(parent: HTMLElement): void {
	const paragraphs = parent.querySelectorAll<HTMLElement>("p");
	paragraphs.forEach((p) => {
		let hasAnchor = false;
		let onlyAnchorsOrBreaks = true;
		for (const child of Array.from(p.children)) {
			if (child.tagName === "A") {
				hasAnchor = true;
			} else if (child.tagName !== "BR") {
				onlyAnchorsOrBreaks = false;
				break;
			}
		}
		if (hasAnchor && onlyAnchorsOrBreaks) {
			p.classList.add("amc-link-line");
		}
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

type SourceBlockKind = "para" | "heading" | "hr" | "list" | "quote" | "table" | "fence" | "math";

const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})/;
const HEADING_RE = /^\s{0,3}#{1,6}(\s|$)/;
const HR_RE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const LIST_ITEM_RE = /^\s{0,3}([-*+]|\d+[.)])(\s|$)/;
const QUOTE_RE = /^\s{0,3}>/;
const TABLE_RE = /^\s*\|/;
const COMMENT_LINE_RE = /^\s*%%.*%%\s*$/;

/**
 * For each top-level block the markdown renderer will produce, whether a blank
 * line precedes it in the source. Tracks fenced code, math and lists so blank
 * lines inside them do not split blocks. Returns null for constructs it cannot
 * map reliably (multi-line comments, raw HTML).
 */
function sourceBlockGaps(content: string): boolean[] | null {
	const gaps: boolean[] = [];
	let prev: SourceBlockKind | null = null;
	let pendingBlank = false;
	let fence: string | null = null;
	let inMath = false;

	for (const line of content.split("\n")) {
		if (fence !== null) {
			if (line.trim().startsWith(fence)) fence = null;
			continue;
		}
		if (inMath) {
			if (line.trim().endsWith("$$")) inMath = false;
			continue;
		}
		if (line.trim() === "") {
			pendingBlank = true;
			continue;
		}
		if (COMMENT_LINE_RE.test(line)) continue;
		const trimmed = line.trim();
		if (trimmed.startsWith("%%") || trimmed.startsWith("<")) return null;

		let kind: SourceBlockKind;
		let continues = false;
		const fenceMatch = line.match(FENCE_RE);
		if (fenceMatch) {
			kind = "fence";
			fence = fenceMatch[1]!.slice(0, 3);
		} else if (trimmed.startsWith("$$")) {
			kind = "math";
			inMath = !(trimmed.length > 2 && trimmed.endsWith("$$"));
		} else if (HEADING_RE.test(line)) {
			kind = "heading";
		} else if (HR_RE.test(line)) {
			kind = "hr";
		} else if (LIST_ITEM_RE.test(line)) {
			kind = "list";
			continues = prev === "list";
		} else if (prev === "list" && (/^\s/.test(line) || !pendingBlank)) {
			// Indented continuation, or a lazy continuation line of an item.
			kind = "list";
			continues = true;
		} else if (QUOTE_RE.test(line)) {
			kind = "quote";
			continues = prev === "quote" && !pendingBlank;
		} else if (TABLE_RE.test(line)) {
			kind = "table";
			continues = prev === "table" && !pendingBlank;
		} else {
			kind = "para";
			// Lazy continuation of a paragraph or blockquote.
			continues = !pendingBlank && (prev === "para" || prev === "quote");
			if (continues && prev === "quote") kind = "quote";
		}

		if (!continues) gaps.push(pendingBlank && gaps.length > 0);
		pendingBlank = false;
		prev = kind;
	}
	return gaps;
}

/**
 * Mark top-level rendered blocks that follow a blank line in the source with
 * `amc-block-gap`, so the compact live preview keeps paragraph spacing. When
 * the source blocks cannot be matched one-to-one with the rendered elements,
 * nothing is marked rather than marking the wrong elements (the CSS still
 * separates adjacent paragraphs, which always come from a blank line).
 */
function markBlockGaps(parent: HTMLElement, content: string): void {
	const gaps = sourceBlockGaps(content);
	if (!gaps) return;
	const children = Array.from(parent.children);
	if (children.length !== gaps.length) return;
	children.forEach((child, i) => {
		if (gaps[i]) child.classList.add("amc-block-gap");
	});
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

	const doc = view.dom.doc;
	doc.addEventListener("click", clearOnClick, true);
	iState.cleanupSelectionClickTracking = () => {
		doc.removeEventListener("click", clearOnClick, true);
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
		// Ctrl/Cmd+Click on a link opens it in a new tab; never turn it into
		// a column selection (this capture listener would swallow the click).
		if (target.closest(".amc-embedded-editor")) return;
		if (isInteractivePreviewTarget(target, item)) return;

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
		if (target.closest("textarea") || target.closest("input") || target.closest(".amc-embedded-editor")) return;

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

// ── Toolbar Remove Button ───────────────────────────────────

function buildRemoveButton(toolbarActions: HTMLElement, onRemove: () => void): void {
	const removeBtn = toolbarActions.createEl("button", {cls: "column-remove-btn"});
	removeBtn.setAttribute("aria-label", "Remove column");
	setIcon(removeBtn, "x");
	removeBtn.addEventListener("click", (e) => {
		e.preventDefault();
		e.stopPropagation();
		onRemove();
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
				key: `c${index}`,
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
						nextPreview.win.setTimeout(() => nextPreview.click(), 50);
					}
				}
				return true;
			}
			requestAnimationFrame(() => {
				const iState = getInteractionState(ctx.view);
				if (iState.activeEdit && iState.activeEdit.regionFrom === ctx.region.from && iState.activeEdit.key === `c${index}`) {
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
		if (iStateInput.activeEdit && iStateInput.activeEdit.regionFrom === ctx.region.from && iStateInput.activeEdit.key === `c${index}`) {
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
	key: string,
): void {
	const block = parent.createDiv({cls: "column-inline-edit-block"});

	const preview = block.createDiv({cls: "column-inline-edit-preview markdown-rendered"});
	applyCompactPreviewSpacing(preview);

	const renderPreview = (text: string) => {
		preview.empty();
		if (text.trim().length === 0) {
			preview.createDiv({cls: "column-empty-placeholder", text: "Click to edit"});
			return;
		}
		renderMarkdown(preview, text, sourcePath, ctx, onCommit);
	};
	renderPreview(initialText);

	let currentText = initialText;

	if (isEmbeddedEditorAvailable()) {
		wireLivePreviewEdit({
			container: block,
			hostEl: block,
			previewEl: preview,
			components: ctx.components,
			getContent: () => currentText,
			onCommit: (nextText) => {
				currentText = nextText;
				onCommit(nextText);
			},
			editState: {view: ctx.view, region: ctx.region, regionSource: ctx.source, key},
		});
		return;
	}

	// Legacy textarea editor (fallback when the internal live-preview
	// editor class cannot be resolved).
	const textarea = block.createEl("textarea", {cls: "column-inline-editor"});
	textarea.value = initialText;
	textarea.spellcheck = false;
	textarea.placeholder = "Type here";

	const plugin = getPluginInstance();
	const suggest = new ColumnEditorSuggest(textarea, plugin.app);
	const slashSuggest = createSlashSuggest(textarea);
	const tpSuggest = new ThirdPartySuggestBridge(textarea, plugin.app);
	ctx.suggests.push(suggest);

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

	for (let partIndex = 0; partIndex < parts.length; partIndex++) {
		const part = parts[partIndex]!;
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
				`${editKey(containerPath, columnIndex)}/s${partIndex}`,
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
	const container = parent.createDiv({cls: "columns-container columns-ui columns-nested"});
	const isContainerStacked = region.layout === "stack";
	if (isContainerStacked) container.classList.add("columns-stacked");
	applyContainerStyle(container, region.containerStyle);

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
			const stackGroupEl = container.createDiv({cls: "columns-stack-group"});
			const maxWidth = Math.max(...group.indices.map((idx) => region.columns[idx]!.widthPercent));
			if (maxWidth > 0) {
				const handleTotal = (groups.length - 1) * 8;
				const shrink = handleTotal / groups.length;
				stackGroupEl.style.flex = `0 0 calc(${maxWidth}% - ${shrink.toFixed(1)}px)`;
			}
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

			const colEl = groupParent.createDiv({cls: "column-item"});
			colEl.dataset.colIndex = String(i);
			if (useStackWrapper) {
				// Stacked: full width via CSS
			} else if (!isContainerStacked && col.widthPercent > 0) {
				const handleTotal = (groups.length - 1) * 8;
				const shrink = handleTotal / groups.length;
				colEl.style.flex = `0 0 calc(${col.widthPercent}% - ${shrink.toFixed(1)}px)`;
			}
			applyColumnStyle(colEl, col.style);

			const colContent = renderColumnHeader(colEl, col.content);

			const toolbar = colEl.createDiv({cls: "column-toolbar"});

			const dragHandle = toolbar.createSpan({cls: "column-drag-handle"});
			dragHandle.setAttribute("aria-label", "Drag to reorder");
			setIcon(dragHandle, "grip-vertical");

			const isStacked = !!(col.stacked && col.stacked > 0);
			const addBtn = toolbar.createEl("button", {cls: "column-add-btn"});
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

			const deleteNestedColumn = () => {
				if (region.columns.length <= 1) {
					onRemoveRegion();
					return;
				}
				const updated = removeColumnPreservingWidths(region.columns, i);
				onRegionChange(updated, region.containerStyle);
			};

			const toolbarActions = toolbar.createDiv({cls: "column-toolbar-actions"});
			toolbarActions.appendChild(addBtn);
			buildRemoveButton(toolbarActions, deleteNestedColumn);
			toolbarActions.appendChild(dragHandle);

			const hasNestedRegions = findColumnRegions(colContent).length > 0;
			let liveEdit: LiveEditHandle | null = null;

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
					editColumn: hasNestedRegions ? undefined : () => liveEdit?.enterEdit(),
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
					deleteColumn: deleteNestedColumn,
				},
				containerPath[containerPath.length - 1]?.columnIndex !== undefined
					? containerPath[containerPath.length - 1]!.columnIndex + 1
					: undefined,
				container,
				region.layout,
				onLayoutChange,
				ctx.view,
			);

			const previewEl = colEl.createDiv({cls: "column-preview markdown-rendered"});
			applyCompactPreviewSpacing(previewEl);

			if (colContent.length > 0) {
				renderColumnContent(
					previewEl,
					colContent,
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
				previewEl.createDiv({cls: "column-empty-placeholder", text: "Click to edit"});
			}

			if (!hasNestedRegions) {
				const commitNested = (nextChildContent: string) => {
					const updated = region.columns.map((c, idx) =>
						idx === i ? {...c, content: nextChildContent} : c,
					);
					onRegionChange(updated, region.containerStyle);
				};

				if (isEmbeddedEditorAvailable()) {
					liveEdit = wireLivePreviewEdit({
						container,
						hostEl: colEl,
						previewEl,
						components: ctx.components,
						getContent: () => region.columns[i]!.content,
						onCommit: commitNested,
						clickGuard: (target) => {
							const currentNested = previewEl.closest(".columns-nested");
							const clickedNested = target.closest(".columns-nested");
							return !!(currentNested && clickedNested && clickedNested !== currentNested);
						},
						editState: {view: ctx.view, region: ctx.region, regionSource: ctx.source, key: editKey(containerPath, i)},
					});
				} else {
					const textarea = colEl.createEl("textarea", {cls: "column-editor"});
					textarea.value = col.content;
					textarea.spellcheck = false;
					textarea.placeholder = "Type here";

					wireNestedEditToggle(
						container,
						previewEl,
						textarea,
						() => region.columns[i]!.content,
						commitNested,
						ctx,
					);
				}
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
	const sourcePath = ctx.sourcePath;

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
			const stackGroupEl = container.createDiv({cls: "columns-stack-group"});
			const maxWidth = Math.max(...group.indices.map((idx) => columns[idx]!.widthPercent));
			if (maxWidth > 0) {
				const handleTotal = (groups.length - 1) * 8;
				const shrink = handleTotal / groups.length;
				stackGroupEl.style.flex = `0 0 calc(${maxWidth}% - ${shrink.toFixed(1)}px)`;
			}
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

			const colEl = groupParent.createDiv({cls: "column-item"});
			if (useStackWrapper) {
				// Stacked columns: full width via CSS
			} else if (!isContainerStacked && col.widthPercent > 0) {
				const handleTotal = (groups.length - 1) * 8;
				const shrink = handleTotal / groups.length;
				colEl.style.flex = `0 0 calc(${col.widthPercent}% - ${shrink.toFixed(1)}px)`;
			}
			applyColumnStyle(colEl, col.style);
			colEl.dataset.colIndex = String(i);

			try {
				const colContent = renderColumnHeader(colEl, col.content);
				const hasNestedRegions = findColumnRegions(colContent).length > 0;

				const toolbar = colEl.createDiv({cls: "column-toolbar"});

				const dragHandle = toolbar.createSpan({cls: "column-drag-handle"});
				dragHandle.setAttribute("aria-label", "Drag to reorder");
				setIcon(dragHandle, "grip-vertical");

				const isStacked = !!(col.stacked && col.stacked > 0);
				const addBtn = toolbar.createEl("button", {cls: "column-add-btn"});
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

				const deleteColumn = () => {
					if (columns.length <= 1) return;
					const updated = removeColumnPreservingWidths(columns, i);
					dispatchUpdate(ctx.region, updated, ctx.view);
				};

				const toolbarActions = toolbar.createDiv({cls: "column-toolbar-actions"});
				toolbarActions.appendChild(addBtn);
				if (columns.length > 1) buildRemoveButton(toolbarActions, deleteColumn);
				toolbarActions.appendChild(dragHandle);

				const previewEl = colEl.createDiv({cls: "column-preview markdown-rendered"});
				applyCompactPreviewSpacing(previewEl);
				let liveEdit: LiveEditHandle | null = null;

				if (colContent.length === 0) {
					previewEl.createDiv({cls: "column-empty-placeholder", text: "Click to edit"});
				} else {
					renderColumnContent(
						previewEl,
						colContent,
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
					if (isEmbeddedEditorAvailable()) {
						liveEdit = wireLivePreviewEdit({
							container,
							hostEl: colEl,
							previewEl,
							components: ctx.components,
							getContent: () => ctx.region.columns[i]!.content,
							onCommit: (nextContent) => commitEdit(i, nextContent, ctx),
							clickGuard: (target) => !!target.closest(".columns-nested"),
							blurDelay: 200,
							editState: {view: ctx.view, region: ctx.region, regionSource: ctx.source, key: editKey([], i)},
							onNavigate: (dir) => {
								const next = i + dir;
								const nextCol = ctx.region.columns[next];
								if (!nextCol) return null;
								// Columns holding nested blocks have no single editor.
								if (findColumnRegions(nextCol.content).length > 0) return null;
								return {key: editKey([], next), value: nextCol.content};
							},
						});
					} else {
						const textarea = colEl.createEl("textarea", {cls: "column-editor"});
						textarea.value = col.content;
						textarea.spellcheck = false;
						textarea.placeholder = "Type here";

						const suggest = new ColumnEditorSuggest(textarea, plugin.app);
						const slashSuggest = createSlashSuggest(textarea);
						const tpSuggest = new ThirdPartySuggestBridge(textarea, plugin.app);
						ctx.suggests.push(suggest);
						wireTopLevelEditToggle(container, previewEl, textarea, i, suggest, slashSuggest, tpSuggest, ctx);

						const iState = getInteractionState(ctx.view);
						if (iState.activeEdit && iState.activeEdit.regionFrom === ctx.region.from && iState.activeEdit.key === `c${i}`) {
							restoreEditState(textarea, ctx.view);
						}
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
						editColumn: liveEdit ? () => liveEdit?.enterEdit() : undefined,
						addColumn: () => {
							const updated = insertColumnAfter(columns, i);
							dispatchUpdate(ctx.region, updated, ctx.view);
						},
						addChild: () => {
							const nextContent = addChildColumnToContent(col.content);
							commitEdit(i, nextContent, ctx);
						},
						deleteColumn,
					},
					undefined,
					container,
					ctx.region.layout,
					(nextLayout) => {
						refreshRegionPosition(ctx.region);
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
				colEl.createDiv({cls: "column-render-error", text: "Failed to render column"});
			}
		}
	}
}
