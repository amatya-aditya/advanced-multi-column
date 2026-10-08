import {
	Component,
	MarkdownPostProcessorContext,
	MarkdownRenderChild,
	MarkdownRenderer,
	MarkdownView,
	setIcon,
	TFile,
} from "obsidian";
import {findColumnRegions} from "./core/parser";
import {NoteFootnotes} from "./core/footnotes";
import {applyNoteFootnotes, buildFootnoteSection, wireReadingFootnotes} from "./render/footnote-render";
import {applyColumnStyle, applyContainerStyle, BACKGROUND_CSS, COLOR_CSS, HEADER_BORDER_CSS} from "./core/column-style";
import {buildSeparatorElement, groupColumns, parseColumnHeader} from "./render/column-renderer";
import {addFoldControls, refreshHeadingFolds} from "./render/fold";
import type {ColumnRegion} from "./core/types";
import type ColumnsPlugin from "../main";
import {addMarkdownViewHooks, isLoadingFile} from "./view-hooks";
import {blockContext, blockKey, BlockReuse, unloadNewBlocks, unloadUntakenBlocks} from "./reading-blocks";
import type {LayerBlock} from "./reading-blocks";
import {
	applyPendingScroll,
	createLineIndex,
	FILL_MARGIN_LINES,
	installReadingScrollMapping,
	pendingScrollLine,
	releasePendingScroll,
	setLayerFiller,
	tagSourceLines,
	uninstallReadingScrollMapping,
} from "./reading-scroll";

const RV_DEBUG = false;
const RV_ACTIVE_CLASS = "amc-reading-columns-active";
const RV_HOST_CLASS = "amc-reading-columns-host";
/** Host whose layer belongs to the previous note while the next one builds. */
const RV_PENDING_CLASS = "amc-rv-pending";

interface RenderState {
	sourcePath: string;
	fingerprint: string;
	wrapper: HTMLElement;
	host: HTMLElement;
	previewEl: HTMLElement;
	/** Owns the layer's own parts (footnote list); blocks own theirs. */
	component: Component;
	blocks: LayerBlock[];
	/** Stops rendering the layer's deferred blocks (see buildWrapper). */
	stopFilling?: () => void;
	renderId: number;
	createdAt: number;
	previewObserver?: MutationObserver;
	hostObserver?: MutationObserver;
	wrapperObserver?: MutationObserver;
	sizerObserver?: MutationObserver;
}

interface ScrollSnapshot {
	el: HTMLElement;
	top: number;
	left: number;
}

type ScrollRestoreGuard = () => boolean;

function rvWarn(...args: unknown[]): void {
	if (!RV_DEBUG) return;
	console.warn("[AMC RV]", ...args);
}

function rvError(...args: unknown[]): void {
	if (!RV_DEBUG) return;
	console.error("[AMC RV]", ...args);
}

function resolveSizerForElement(
	el: HTMLElement,
	ctx: MarkdownPostProcessorContext,
	plugin: ColumnsPlugin,
): HTMLElement | null {
	const closest = el.closest(".markdown-preview-sizer");
	if (closest?.instanceOf(HTMLElement)) return closest;

	// Sections are post-processed before they are attached. The context's
	// container is the sizer they go into; for an embed or canvas card it is
	// the only way to find it (the note may not be open anywhere, or open in
	// another tab whose sizer is the wrong one).
	const container = (ctx as MarkdownPostProcessorContext & {containerEl?: unknown}).containerEl;
	if (container instanceof HTMLElement) {
		const sizer = container.closest(".markdown-preview-sizer");
		if (sizer?.instanceOf(HTMLElement)) return sizer;
	}

	const sourcePathHint = ctx.sourcePath;

	if (sourcePathHint) {
		const leaves = plugin.app.workspace.getLeavesOfType("markdown");
		for (const leaf of leaves) {
			const view = leaf.view;
			if (!(view instanceof MarkdownView)) continue;
			if (view.file?.path !== sourcePathHint) continue;

			const sizer = view.previewMode.containerEl.querySelector(".markdown-preview-sizer");
			if (sizer?.instanceOf(HTMLElement)) return sizer;
		}
	}

	return null;
}

function resolveViewForSizer(
	sizer: HTMLElement,
	plugin: ColumnsPlugin,
): MarkdownView | null {
	const leaves = plugin.app.workspace.getLeavesOfType("markdown");
	for (const leaf of leaves) {
		const view = leaf.view;
		if (!(view instanceof MarkdownView)) continue;
		if (view.previewMode.containerEl.contains(sizer)) {
			return view;
		}
	}
	return null;
}

/** The sizer of the view's own reading view (not of a note embedded in it). */
function ownSizerOf(view: MarkdownView): HTMLElement | null {
	const sizer = view.previewMode.containerEl.querySelector(":scope > .markdown-preview-view > .markdown-preview-sizer");
	return sizer?.instanceOf(HTMLElement) ? sizer : null;
}

function resolvePreviewElementForSizer(sizer: HTMLElement): HTMLElement | null {
	const preview = sizer.closest(".markdown-preview-view");
	return preview?.instanceOf(HTMLElement) ? preview : null;
}

interface CanvasFileNode {
	nodeEl?: HTMLElement;
	file?: TFile | null;
	subpath?: string;
}

/**
 * Subpath of the canvas file node that renders `nodeEl`, or null when the node
 * is not a markdown file node (text cards render the canvas JSON's text).
 */
function getCanvasNoteSubpath(plugin: ColumnsPlugin, nodeEl: Element): string | null {
	for (const leaf of plugin.app.workspace.getLeavesOfType("canvas")) {
		const canvas = (leaf.view as unknown as {canvas?: {nodes?: Map<string, CanvasFileNode>}}).canvas;
		const nodes = canvas?.nodes;
		if (!(nodes instanceof Map)) continue;
		for (const node of nodes.values()) {
			if (node.nodeEl !== nodeEl) continue;
			return node.file instanceof TFile && node.file.extension === "md" ? node.subpath ?? "" : null;
		}
	}
	return null;
}

/**
 * Rendered previews that show a whole note: reading view, plus whole-note
 * embeds and canvas file cards in any mode. Embeds of a heading or block
 * (`#subpath`) show only part of the note, so they are left to Obsidian.
 */
function isSupportedPreview(previewEl: HTMLElement, plugin: ColumnsPlugin): boolean {
	const embed = previewEl.closest(".internal-embed");
	if (embed) return !(embed.getAttribute("src") ?? "").includes("#");
	const canvasNode = previewEl.closest(".canvas-node");
	if (canvasNode) return getCanvasNoteSubpath(plugin, canvasNode) === "";
	return !!previewEl.closest(".markdown-reading-view");
}

/**
 * True for blocks the column layer renders itself. Blocks of a note embedded
 * in the layer are not: the embed is a preview of its own.
 */
function isOwnLayerContent(el: HTMLElement): boolean {
	const layer = el.closest(".columns-rv-wrapper, .columns-rv-segment, .column-preview");
	if (!layer) return false;
	const embed = el.closest(".internal-embed");
	return !embed || !layer.contains(embed);
}

function getWrapperHost(previewEl: HTMLElement): HTMLElement | null {
	const host = previewEl.querySelector(
		`:scope > .markdown-preview-sizer > .${RV_HOST_CLASS}, :scope > .${RV_HOST_CLASS}`,
	);
	return host?.instanceOf(HTMLElement) ? host : null;
}

/** Keep AMC's replacement tree outside Obsidian's virtualized sizer. The
 * sizer removes children while scrolling, so mounting the host inside it makes
 * a normal scroll look like wrapper damage and starts a recovery-render loop. */
function placeWrapperHost(
	previewEl: HTMLElement,
	sizer: HTMLElement,
	host: HTMLElement,
): void {
	const footer = previewEl.querySelector(":scope > .mod-footer");
	if (footer?.instanceOf(HTMLElement)) {
		if (host.parentElement !== previewEl || host.nextSibling !== footer) {
			previewEl.insertBefore(host, footer);
		}
		return;
	}

	if (host.parentElement !== previewEl || sizer.nextSibling !== host) {
		previewEl.insertBefore(host, sizer.nextSibling);
	}
}

function ensureWrapperHost(
	previewEl: HTMLElement,
	sizer: HTMLElement,
): HTMLElement {
	const existing = getWrapperHost(previewEl);
	if (existing) {
		placeWrapperHost(previewEl, sizer, existing);
		return existing;
	}

	const host = previewEl.createDiv({cls: RV_HOST_CLASS});
	placeWrapperHost(previewEl, sizer, host);
	return host;
}

/* The backlinks footer (.mod-footer) is one of Obsidian's virtual sections and
 * is re-inserted into the sizer on every virtual-display update, so it is never
 * moved: CSS shows it after the AMC host instead (the sizer is display:contents
 * and the footer is ordered last). Moving it fought Obsidian on every scroll and
 * made the view jump. */

function isScrollableElement(el: HTMLElement): boolean {
	const style = window.getComputedStyle(el);
	const overflowY = style.overflowY;
	const overflowX = style.overflowX;
	const canScrollY = (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay")
		&& el.scrollHeight > el.clientHeight + 1;
	const canScrollX = (overflowX === "auto" || overflowX === "scroll" || overflowX === "overlay")
		&& el.scrollWidth > el.clientWidth + 1;
	return canScrollY || canScrollX;
}

function captureScrollSnapshot(fromEl: HTMLElement): ScrollSnapshot[] {
	const snapshots: ScrollSnapshot[] = [];
	const leafContent = fromEl.closest(".workspace-leaf-content");
	const stopAt = leafContent?.instanceOf(HTMLElement) ? leafContent : null;
	let current: HTMLElement | null = fromEl;
	while (current) {
		if (isScrollableElement(current)) {
			snapshots.push({
				el: current,
				top: current.scrollTop,
				left: current.scrollLeft,
			});
		}
		if (current === stopAt) break;
		current = current.parentElement;
	}
	return snapshots;
}

function restoreScrollSnapshot(
	snapshots: ScrollSnapshot[],
	shouldRestore: ScrollRestoreGuard,
): void {
	if (!shouldRestore()) return;
	for (const snap of snapshots) {
		if (!shouldRestore()) break;
		if (!snap.el.isConnected) continue;
		snap.el.scrollTop = snap.top;
		snap.el.scrollLeft = snap.left;
	}
}

function restoreScrollSnapshotStable(
	snapshots: ScrollSnapshot[],
	shouldRestore: ScrollRestoreGuard,
): void {
	// Stop restoring as soon as the user scrolls: snapping back to the old
	// position would fight their scroll direction.
	let userScrolled = false;
	const onUserScroll = () => {
		userScrolled = true;
	};
	const events = ["wheel", "touchmove", "keydown", "mousedown"] as const;
	for (const snap of snapshots) {
		for (const type of events) snap.el.addEventListener(type, onUserScroll, {passive: true});
	}
	const guard = () => !userScrolled && shouldRestore();
	const cleanup = () => {
		for (const snap of snapshots) {
			for (const type of events) snap.el.removeEventListener(type, onUserScroll);
		}
	};
	restoreScrollSnapshot(snapshots, guard);
	window.requestAnimationFrame(() => {
		restoreScrollSnapshot(snapshots, guard);
		window.requestAnimationFrame(() => {
			restoreScrollSnapshot(snapshots, guard);
			cleanup();
		});
	});
}

/** Move any legacy relocated .mod-footer back into Obsidian's sizer. */
function restoreFooter(previewEl: HTMLElement, sizer: HTMLElement): void {
	const footer = previewEl.querySelector(":scope > .mod-footer");
	if (footer?.instanceOf(HTMLElement)) {
		sizer.appendChild(footer);
	}
}

const RV_HIDDEN_CLASS = "amc-rv-hidden";

const SIZER_PADDING_VAR = "--amc-sizer-padding-top";

/**
 * While columns are active the sizer is `display: contents` (see layout.css),
 * so its own top padding no longer applies. Banner plugins set it to start
 * the note below the banner (Pixel Banner's content start position), and
 * themes may set it too. Carry it over to a spacer at the top of the preview.
 * An inline value is copied as written, so a `var()` in it keeps updating.
 */
function carrySizerPadding(sizer: HTMLElement): void {
	const previewEl = sizer.parentElement;
	if (!previewEl) return;
	const value = sizer.style.paddingTop || sizer.win.getComputedStyle(sizer).paddingTop;
	if (previewEl.style.getPropertyValue(SIZER_PADDING_VAR) !== value) {
		previewEl.setCssProps({[SIZER_PADDING_VAR]: value});
	}
}

/**
 * Sections of Obsidian's own render that the column layer replaces: the
 * note's content (el-* divs) and the pusher. The frontmatter section stays:
 * the layer never renders frontmatter, and banner plugins attach to that
 * section (Banners turns it into the banner's wrapper).
 */
function isReplacedSection(el: HTMLElement): boolean {
	if (el.classList.contains("markdown-preview-pusher")) return true;
	const cls = el.className;
	return (cls.startsWith("el-") || cls.includes(" el-")) && !el.classList.contains("mod-frontmatter");
}

/** Hide el-* content divs and the pusher inside the sizer, preserving
 *  metadata containers, banner plugin elements, inline titles, etc. */
function hideSizerContent(sizer: HTMLElement): void {
	for (const child of Array.from(sizer.children)) {
		if (child.instanceOf(HTMLElement) && isReplacedSection(child)) child.classList.add(RV_HIDDEN_CLASS);
	}
	carrySizerPadding(sizer);
}

/** Restore hidden elements when tearing down. */
function restoreSizerContent(sizer: HTMLElement): void {
	const hidden = sizer.querySelectorAll<HTMLElement>(`:scope > .${RV_HIDDEN_CLASS}`);
	for (let i = 0; i < hidden.length; i++) {
		hidden[i]!.classList.remove(RV_HIDDEN_CLASS);
	}
	if (sizer.classList.contains("markdown-preview-sizer")) {
		sizer.parentElement?.setCssProps({[SIZER_PADDING_VAR]: ""});
	}
}

function disconnectObservers(state: RenderState): void {
	state.previewObserver?.disconnect();
	state.hostObserver?.disconnect();
	state.wrapperObserver?.disconnect();
	state.sizerObserver?.disconnect();
}

function teardownSizer(
	sizer: HTMLElement,
	states: WeakMap<HTMLElement, RenderState>,
	reason = "teardown",
): void {
	const state = states.get(sizer);
	if (state) {
		disconnectObservers(state);
		state.stopFilling?.();
		setLayerFiller(state.previewEl, null);
		state.component.unload();
		unloadUntakenBlocks(state.blocks, null);
		state.wrapper.remove();
		state.host.classList.remove(RV_PENDING_CLASS);
		restoreFooter(state.previewEl, sizer);
		restoreSizerContent(sizer);
		state.previewEl.classList.remove(RV_ACTIVE_CLASS);
		releasePendingScroll(state.previewEl);
		if (!state.host.hasChildNodes()) {
			state.host.remove();
		}
		states.delete(sizer);
		rvWarn("teardown wrapper", {
			reason,
			renderId: state.renderId,
			sourcePath: state.sourcePath,
			sizerChildren: sizer.children.length,
			hostConnected: state.host.isConnected,
			hostChildren: state.host.children.length,
		});
		return;
	}

	// No state for this sizer — the file may have changed (e.g. navigation)
	// while the old host/wrapper from a previous file still lingers on the
	// previewEl.  Clean up the stale artefacts so the new file renders normally.
	const previewEl = resolvePreviewElementForSizer(sizer);
	if (!previewEl) return;
	if (!previewEl.classList.contains(RV_ACTIVE_CLASS)) return;

	getWrapperHost(previewEl)?.remove();
	restoreFooter(previewEl, sizer);
	restoreSizerContent(sizer);
	previewEl.classList.remove(RV_ACTIVE_CLASS);
	releasePendingScroll(previewEl);
	rvWarn("teardown stale preview", {reason});
}

function textFingerprint(sourcePath: string, text: string, regions: ColumnRegion[]): string {
	// Two independent 32-bit hashes keep the fingerprint compact while still
	// detecting same-length edits such as GUI width/style changes. The previous
	// length/first/last fingerprint treated many real edits as unchanged.
	let hashA = 0x811c9dc5;
	let hashB = 0x9e3779b9;
	for (let i = 0; i < text.length; i++) {
		const code = text.charCodeAt(i);
		hashA = Math.imul(hashA ^ code, 0x01000193);
		hashB = Math.imul(hashB ^ code, 0x85ebca6b);
	}
	return (
		`${sourcePath}\u0000${text.length}\u0000${regions.length}`
		+ `\u0000${(hashA >>> 0).toString(16)}${(hashB >>> 0).toString(16)}`
	);
}

/** A render waits up to HEADER_WAIT_TRIES × HEADER_WAIT_MS for the note's header. */
const HEADER_WAIT_TRIES = 20;
const HEADER_WAIT_MS = 25;

/** Longest a new layer waits for its markdown renders before it is shown. */
const LAYER_RENDER_WAIT_MS = 40;

/**
 * Markdown renders still running for a layer. The DOM of the layer is built
 * synchronously, in order, with an empty element per markdown block; the
 * blocks then render in parallel instead of one after another, which made
 * opening a note with many columns slow.
 */
type RenderTasks = Promise<unknown>[] & {
	/** The note's footnotes, when the whole note is rendered (see buildWrapper). */
	footnotes?: NoteFootnotes | null;
};

function renderMarkdownInto(
	plugin: ColumnsPlugin,
	component: Component,
	el: HTMLElement,
	markdown: string,
	sourcePath: string,
	tasks: RenderTasks,
): void {
	const footnotes = tasks.footnotes;
	if (!footnotes) {
		tasks.push(
			MarkdownRenderer.render(plugin.app, markdown, el, sourcePath, component)
				.then(() => addFoldControls(plugin.app, el)),
		);
		return;
	}
	// Pieces are located in source order, so do it before rendering starts.
	const piece = footnotes.locate(markdown);
	tasks.push(
		MarkdownRenderer.render(plugin.app, footnotes.prepare(markdown), el, sourcePath, component)
			.then(() => {
				applyNoteFootnotes(el, footnotes, piece, "reading");
				addFoldControls(plugin.app, el);
			}),
	);
}

function renderMarkdownSegment(
	plugin: ColumnsPlugin,
	component: Component,
	parent: HTMLElement,
	markdown: string,
	sourcePath: string,
	tasks: RenderTasks,
): HTMLElement | null {
	if (markdown.trim().length === 0) return null;

	const host = parent.createDiv({cls: "columns-rv-segment"});
	renderMarkdownInto(plugin, component, host, markdown, sourcePath, tasks);
	return host;
}

export async function renderColumnsRegion(
	plugin: ColumnsPlugin,
	component: Component,
	parent: HTMLElement,
	region: ColumnRegion,
	sourcePath: string,
): Promise<void> {
	const tasks: RenderTasks = [];
	buildColumnsRegion(plugin, component, parent, region, sourcePath, 0, tasks);
	await Promise.all(tasks);
}

function buildColumnsRegion(
	plugin: ColumnsPlugin,
	component: Component,
	parent: HTMLElement,
	region: ColumnRegion,
	sourcePath: string,
	depth: number,
	tasks: RenderTasks,
): void {
	if (depth > 8) return;

	const containerEl = parent.createDiv({cls: "columns-container columns-ui columns-reading"});
	const isContainerStacked = region.layout === "stack";
	if (isContainerStacked) containerEl.classList.add("columns-stacked");
	applyContainerStyle(containerEl, region.containerStyle);
	if (depth > 0) containerEl.classList.add("columns-nested");

	const groups = isContainerStacked
		? [{indices: region.columns.map((_, i) => i), isStack: true}]
		: groupColumns(region.columns);

	for (let gi = 0; gi < groups.length; gi++) {
		const group = groups[gi]!;

		// `sep:0` on the column before this group hides the global divider.
		let hideDividerBefore = false;
		if (gi > 0) {
			const prevGroup = groups[gi - 1]!;
			const prevCol = region.columns[prevGroup.indices[prevGroup.indices.length - 1]!]!;
			buildSeparatorElement(containerEl, prevCol);
			hideDividerBefore = prevCol.style?.separator === false;
		}

		let groupParent: HTMLElement;
		if (group.isStack && !isContainerStacked && group.indices.length > 0) {
			const stackGroupEl = containerEl.createDiv({cls: "columns-stack-group"});
			stackGroupEl.toggleClass("amc-no-divider-before", hideDividerBefore);
			const maxWidth = Math.max(...group.indices.map((idx) => region.columns[idx]!.widthPercent));
			if (maxWidth > 0) {
				const sepTotal = (groups.length - 1) * 8;
				const shrink = sepTotal / groups.length;
				// Shrinkable: reading columns also have side margins the basis omits.
				stackGroupEl.style.flex = `0 1 calc(${maxWidth}% - ${shrink.toFixed(1)}px)`;
			}
			groupParent = stackGroupEl;
		} else {
			groupParent = containerEl;
		}

		for (let gi2 = 0; gi2 < group.indices.length; gi2++) {
			const ci = group.indices[gi2]!;
			const col = region.columns[ci]!;

			if (gi2 > 0 && group.isStack) {
				buildSeparatorElement(groupParent, region.columns[group.indices[gi2 - 1]!]!);
			}

			const colEl = groupParent.createDiv({cls: "column-item"});
			colEl.dataset.colIndex = String(ci);
			if (gi2 === 0 && groupParent === containerEl) colEl.toggleClass("amc-no-divider-before", hideDividerBefore);
			applyColumnStyle(colEl, col.style);

			if (group.isStack) {
				// Stacked: full width via CSS
			} else if (!isContainerStacked && col.widthPercent > 0) {
				const sepTotal = (groups.length - 1) * 8;
				const shrink = sepTotal / groups.length;
				// Shrinkable: reading columns also have side margins the basis omits.
				colEl.style.flex = `0 1 calc(${col.widthPercent}% - ${shrink.toFixed(1)}px)`;
			}

			let colContent = col.content;
			if (plugin.settings.enableHeaders) {
				const headerParsed = parseColumnHeader(col.content);
				if (headerParsed) {
					const config = plugin.settings.headerTypes.find((h) => h.id === headerParsed.type);
					if (config) {
						const headerEl = colEl.createDiv({cls: "column-header"});
						headerEl.style.background = BACKGROUND_CSS[config.background] ?? "transparent";
						headerEl.style.color = COLOR_CSS[config.textColor] ?? "var(--text-muted)";
						headerEl.style.fontSize = `${config.fontSize ?? 0.85}em`;
						headerEl.style.fontWeight = String(config.fontWeight ?? 600);

						const iconEl = headerEl.createSpan({cls: "column-header-icon"});
						setIcon(iconEl, config.icon);

						if (headerParsed.title) {
							headerEl.createSpan({
								cls: "column-header-title",
								text: headerParsed.title,
							});
						}

						// Set left-border accent color from header background
						const borderColor = HEADER_BORDER_CSS[config.background];
						if (borderColor) {
							colEl.style.setProperty("--columns-left-border-color", borderColor);
						}

						colContent = headerParsed.restContent;
					}
				}
			}

			const previewEl = colEl.createDiv({cls: "column-preview markdown-rendered"});

			if (colContent.trim().length > 0) {
				buildColumnContent(
					plugin, component, previewEl, colContent, sourcePath, depth + 1, tasks,
				);
			}
		}
	}
}

/** Build a column's content, recursively handling nested column regions. */
function buildColumnContent(
	plugin: ColumnsPlugin,
	component: Component,
	parent: HTMLElement,
	content: string,
	sourcePath: string,
	depth: number,
	tasks: RenderTasks,
): void {
	const nested = depth > 8 ? [] : findColumnRegions(content);
	if (nested.length === 0) {
		renderMarkdownInto(plugin, component, parent, content, sourcePath, tasks);
		return;
	}

	const sorted = [...nested].sort((a, b) => a.from - b.from);
	let cursor = 0;
	for (const region of sorted) {
		if (region.from > cursor) {
			const text = content.slice(cursor, region.from).trim();
			if (text) renderMarkdownInto(plugin, component, parent.createDiv(), text, sourcePath, tasks);
		}
		buildColumnsRegion(plugin, component, parent, region, sourcePath, depth, tasks);
		cursor = region.to;
	}

	if (cursor < content.length) {
		const text = content.slice(cursor).trim();
		if (text) renderMarkdownInto(plugin, component, parent.createDiv(), text, sourcePath, tasks);
	}
}

/** Skip past frontmatter (--- ... ---) and return the char offset where content starts. */
function getFrontmatterEnd(text: string): number {
	if (!text.startsWith("---")) return 0;
	const close = text.indexOf("\n---", 3);
	if (close === -1) return 0;
	// Move past the closing --- and its newline
	const end = text.indexOf("\n", close + 4);
	return end === -1 ? close + 4 : end + 1;
}

interface BuiltLayer {
	wrapper: HTMLElement;
	/** Top-level blocks in order; empty when built without reuse. */
	blocks: LayerBlock[];
	/** Move the blocks taken over from the previous layer into place (at mount). */
	adopt(): void;
	/** Render the deferred blocks up to a source line now (in source order). */
	fill: (line: number) => void;
	/** Render the remaining deferred blocks in the background; returns a stop function. */
	fillInBackground: (win: Window) => () => void;
}

/** Time a background slice of deferred blocks may take before it yields. */
const FILL_SLICE_MS = 12;

/** Estimated height of a deferred block per source line, until it is rendered. */
const DEFERRED_EM_PER_LINE = 1.5;

/**
 * A block rendered after the layer is shown (see buildWrapper's
 * `renderThroughLine`). Its placeholder holds its place and estimated height.
 */
interface DeferredBlock {
	block: LayerBlock;
	from: number;
	to: number;
	render: (owner: Component, parent: HTMLElement) => HTMLElement | null;
}

/**
 * Build the note's column layer. With `reuse` (reading view), every top-level
 * block gets its own component, and blocks unchanged since the previous build
 * are taken over: they are moved in by adopt(), when the layers are swapped,
 * so the layer on screen never loses them while this one builds.
 *
 * With `renderThroughLine`, only the blocks starting up to that source line
 * are rendered now; the rest get placeholders and are rendered by fill() and
 * fillInBackground(). Rendering a long note in one go froze Obsidian for half
 * a second before anything showed. The deferred blocks come after the
 * rendered ones, so they render in source order, as footnotes require.
 */
async function buildWrapper(
	plugin: ColumnsPlugin,
	sourcePath: string,
	text: string,
	regions: ColumnRegion[],
	component: Component,
	reuse?: BlockReuse,
	renderThroughLine?: number,
): Promise<BuiltLayer> {
	const wrapper = createDiv({cls: "columns-rv-wrapper"});
	wrapper.dataset.columnsSourcePath = sourcePath;

	// Every top-level block records its source lines so scroll positions
	// (stored by Obsidian as lines) map onto this layer — see reading-scroll.
	const lineOf = createLineIndex(text);
	const tasks: RenderTasks = [];
	tasks.footnotes = NoteFootnotes.parse(text);
	const context = blockContext(plugin, tasks.footnotes);
	const blocks: LayerBlock[] = [];
	const adoptions: {placeholder: HTMLElement; block: LayerBlock; from: number; to: number}[] = [];
	const deferred: DeferredBlock[] = [];

	const addBlock = (
		kind: "text" | "columns",
		source: string,
		from: number,
		to: number,
		render: (owner: Component, parent: HTMLElement) => HTMLElement | null,
	): void => {
		if (!reuse) {
			tagSourceLines(render(component, wrapper), from, to);
			return;
		}
		const key = blockKey(kind, source, context);
		const reused = reuse.take(key);
		if (reused) {
			adoptions.push({placeholder: wrapper.createDiv(), block: reused, from, to});
			blocks.push(reused);
			return;
		}
		const owner = new Component();
		owner.load();
		// Once one block is deferred, all later ones are: they render in order.
		if (renderThroughLine !== undefined && (from > renderThroughLine || deferred.length > 0)) {
			const placeholder = wrapper.createDiv({cls: "amc-rv-deferred"});
			placeholder.style.height = `${(to - from + 1) * DEFERRED_EM_PER_LINE}em`;
			tagSourceLines(placeholder, from, to);
			const block: LayerBlock = {key, el: placeholder, component: owner, pending: true};
			blocks.push(block);
			deferred.push({block, from, to, render});
			return;
		}
		const el = render(owner, wrapper);
		if (!el) {
			owner.unload();
			return;
		}
		tagSourceLines(el, from, to);
		blocks.push({key, el, component: owner});
	};
	const addText = (markdown: string, from: number, to: number): void => {
		if (markdown.trim().length === 0) return;
		addBlock("text", markdown, from, to, (owner, parent) =>
			renderMarkdownSegment(plugin, owner, parent, markdown, sourcePath, tasks));
	};

	let cursor = getFrontmatterEnd(text);
	for (const region of regions) {
		addText(text.slice(cursor, region.from), lineOf(cursor), lineOf(Math.max(cursor, region.from - 1)));
		addBlock("columns", text.slice(region.from, region.to), region.lineStart, region.lineEnd, (owner, parent) => {
			buildColumnsRegion(plugin, owner, parent, region, sourcePath, 0, tasks);
			const container = parent.lastElementChild;
			return container instanceof HTMLElement ? container : null;
		});
		cursor = region.to;
	}
	addText(text.slice(cursor), lineOf(cursor), lineOf(text.length));
	// Each piece above was rendered on its own, so the note's footnote list
	// is built here, as Obsidian does at the end of a note.
	if (tasks.footnotes) {
		const footnoteTasks = buildFootnoteSection(wrapper, tasks.footnotes, (el, markdown) =>
			MarkdownRenderer.render(plugin.app, markdown, el, sourcePath, component));
		tasks.push(...footnoteTasks);
		wireReadingFootnotes(wrapper, plugin.app, sourcePath);
	}
	// Text is rendered synchronously; what the promises wait for is mostly
	// slow embeds and other plugins' post-processors. Wait briefly so the
	// layer usually appears complete, but never hold the whole note back for
	// one slow block: it finishes in place, as in Obsidian's own view.
	await Promise.race([
		Promise.all(tasks),
		new Promise((resolve) => window.setTimeout(resolve, LAYER_RENDER_WAIT_MS)),
	]);

	// Keep internal links working even when the wrapper is rebuilt outside
	// Obsidian's normal rendered block sequence.
	wrapper.addEventListener("click", (evt) => {
		const target = evt.target as HTMLElement;
		const link = target.closest("a.internal-link");
		if (!(link instanceof HTMLAnchorElement)) return;
		evt.preventDefault();
		const href = link.dataset.href ?? link.getAttr("href");
		if (!href) return;
		void plugin.app.workspace.openLinkText(
			href,
			sourcePath,
			evt.ctrlKey || evt.metaKey,
		);
	});

	let next = 0;
	const renderNext = (): void => {
		const {block, from, to, render} = deferred[next++]!;
		const el = render(block.component, createDiv());
		block.pending = false;
		if (!el) return;
		block.el.replaceWith(el);
		block.el = el;
		tagSourceLines(el, from, to);
	};

	return {
		wrapper,
		blocks,
		adopt: () => {
			for (const {placeholder, block, from, to} of adoptions) {
				placeholder.replaceWith(block.el);
				tagSourceLines(block.el, from, to);
			}
			// A folded heading hides the blocks after it; the set of blocks changed.
			if (adoptions.length > 0) refreshHeadingFolds(wrapper);
		},
		fill: (line) => {
			const start = next;
			while (next < deferred.length && deferred[next]!.from <= line) renderNext();
			if (next > start) refreshHeadingFolds(wrapper);
		},
		fillInBackground: (win) => {
			let timer: number | null = null;
			const slice = (): void => {
				timer = null;
				const end = performance.now() + FILL_SLICE_MS;
				const start = next;
				while (next < deferred.length && performance.now() < end) renderNext();
				if (next > start) refreshHeadingFolds(wrapper);
				if (next < deferred.length) timer = win.setTimeout(slice, 0);
			};
			if (next < deferred.length) timer = win.setTimeout(slice, 0);
			return () => {
				if (timer !== null) win.clearTimeout(timer);
				timer = null;
			};
		},
	};
}

/**
 * Replace a whole note rendered into `el` in one piece (no virtualized sizer)
 * with the column layout. Children `keep` accepts stay in place.
 */
function renderNoteInPlace(
	plugin: ColumnsPlugin,
	el: HTMLElement,
	ctx: MarkdownPostProcessorContext,
	keep: (node: Element) => boolean,
): Promise<void> | null {
	const file = plugin.app.vault.getAbstractFileByPath(ctx.sourcePath);
	if (!(file instanceof TFile)) return null;

	return (async () => {
		const text = await plugin.app.vault.cachedRead(file);
		if (!text.includes("col-start")) return;
		const regions = findColumnRegions(text);
		if (regions.length === 0) return;

		const child = new MarkdownRenderChild(el);
		ctx.addChild(child);
		const {wrapper} = await buildWrapper(plugin, ctx.sourcePath, text, regions, child);
		for (const node of Array.from(el.children)) {
			if (!keep(node)) node.remove();
		}
		el.appendChild(wrapper);
	})().catch((error) => {
		rvError("in-place render failed", error);
	});
}

/**
 * PDF export: replace the exported note body with the column layout. The
 * exporter awaits `ctx.promises` before printing, so the async render lands
 * in the PDF.
 */
function renderForExport(
	plugin: ColumnsPlugin,
	el: HTMLElement,
	ctx: MarkdownPostProcessorContext,
): void {
	const promises = (ctx as MarkdownPostProcessorContext & {promises?: Promise<unknown>[]}).promises;
	// Keep the optional note-title heading the exporter adds; the note body
	// itself is wrapped in divs (and bare <hr>s).
	const task = renderNoteInPlace(plugin, el, ctx, (node) => node.tagName === "H1");
	if (task) promises?.push(task);
}

/**
 * Preview of a whole note embedded in markdown rendered on its own, such as
 * a column or the column layer itself. Obsidian renders such an embed in one
 * piece, without the sizer a reading view or a top-level embed has.
 */
function isUnsizedEmbedPreview(el: HTMLElement): boolean {
	if (!el.classList.contains("markdown-preview-view")) return false;
	if (el.querySelector(":scope > .markdown-preview-sizer")) return false;
	const embed = el.closest(".internal-embed");
	return !!embed && !(embed.getAttribute("src") ?? "").includes("#");
}

export function registerReadingView(plugin: ColumnsPlugin): () => void {
	const states = new WeakMap<HTMLElement, RenderState>();
	const timers = new WeakMap<HTMLElement, {id: number; due: number}>();
	const renderTokens = new WeakMap<HTMLElement, number>();
	const sourceReads = new Map<string, Promise<string | null>>();
	const sourceHints = new WeakMap<HTMLElement, string>();
	const retryCounts = new WeakMap<HTMLElement, number>();
	const activeSizers = new Set<HTMLElement>();
	const buildTimes = new WeakMap<HTMLElement, {fingerprint: string; time: number}[]>();
	const suppressedSizers = new WeakSet<HTMLElement>();
	/** Times a render waited for the note's header (see renderSizer). */
	const headerWaits = new WeakMap<HTMLElement, number>();
	// One entry per sizer while a wrapper build is in flight.  Renders whose
	// fingerprint matches the in-flight build coalesce into it instead of
	// invalidating it — otherwise frequent async re-renders (e.g. Dataview
	// inline queries refreshing during index churn) can starve every build
	// and the wrapper never mounts.
	const inFlightBuilds = new WeakMap<HTMLElement, {token: number; fingerprint: string}>();
	let renderIdSeq = 0;

	// Safety net: an idle note must never rebuild continuously.  Legitimate
	// rebuilds (edits, navigation) change the fingerprint, so only repeated
	// rebuilds of the *same* content within the window count as a loop.
	const BUILD_WINDOW_MS = 10_000;
	const MAX_SAME_CONTENT_BUILDS = 5;

	const shouldSuppressBuild = (sizer: HTMLElement, fingerprint: string): boolean => {
		const now = Date.now();
		const entries = (buildTimes.get(sizer) ?? []).filter((e) => now - e.time < BUILD_WINDOW_MS);
		const sameContent = entries.filter((e) => e.fingerprint === fingerprint);
		if (sameContent.length >= MAX_SAME_CONTENT_BUILDS) {
			buildTimes.set(sizer, entries);
			if (!suppressedSizers.has(sizer)) {
				suppressedSizers.add(sizer);
				console.warn(
					"[Advanced Multi Column] Reading view columns were rebuilt "
					+ `${sameContent.length} times within ${BUILD_WINDOW_MS / 1000}s `
					+ "without a content change; suspending further rebuilds to break the loop.",
				);
			}
			return true;
		}
		suppressedSizers.delete(sizer);
		entries.push({fingerprint, time: now});
		buildTimes.set(sizer, entries);
		return false;
	};

	const invalidateRenderToken = (sizer: HTMLElement): void => {
		const current = renderTokens.get(sizer) ?? 0;
		renderTokens.set(sizer, current + 1);
		inFlightBuilds.delete(sizer);
	};

	const sizerSnapshot = (sizer: HTMLElement, state?: RenderState) => {
		const previewEl = state?.previewEl ?? resolvePreviewElementForSizer(sizer);
		const host = state?.host ?? (previewEl ? getWrapperHost(previewEl) : null);
		return {
			renderId: state?.renderId,
			sourcePath: state?.sourcePath ?? sourceHints.get(sizer) ?? "",
			sizerConnected: sizer.isConnected,
			sizerChildren: sizer.children.length,
			previewConnected: previewEl?.isConnected ?? false,
			previewActiveClass: previewEl?.classList.contains(RV_ACTIVE_CLASS) ?? false,
			hostConnected: host?.isConnected ?? false,
			hostChildren: host?.children.length ?? 0,
			wrapperConnected: state?.wrapper.isConnected ?? false,
			wrapperParentMatches: state ? state.wrapper.parentElement === state.host : false,
			hostParentMatches: state ? state.host.parentElement === state.previewEl : false,
		};
	};

	function scheduleRender(
		sizer: HTMLElement,
		sourcePath: string,
		reason: string,
		delayMs = 50,
	): void {
		sourceHints.set(sizer, sourcePath);
		const due = Date.now() + delayMs;
		const existingTimer = timers.get(sizer);
		rvWarn("schedule render", {
			reason,
			sourcePath,
			hadPendingTimer: existingTimer !== undefined,
			sizerChildren: sizer.children.length,
		});
		// A render already due sooner stays: a later request (e.g. the
		// layout-change that follows opening a note) must not postpone it.
		// The render reads the latest source hint when it runs.
		if (existingTimer && existingTimer.due <= due) return;
		if (existingTimer) window.clearTimeout(existingTimer.id);

		const id = window.setTimeout(() => {
			timers.delete(sizer);
			void renderSizer(sizer, reason);
		}, delayMs);
		timers.set(sizer, {id, due});
	}

	function handleWrapperDisappearance(
		sizer: HTMLElement,
		state: RenderState,
		reason: string,
	): void {
		rvError("wrapper disappeared", {
			reason,
			...sizerSnapshot(sizer, state),
		});
		// Always disconnect this state's observers — even when a newer state
		// has replaced it, stale observers must not keep firing.
		state.previewObserver?.disconnect();
		state.hostObserver?.disconnect();
		state.wrapperObserver?.disconnect();
		state.sizerObserver?.disconnect();
		if (states.get(sizer) !== state) return;

		state.component.unload();
		unloadUntakenBlocks(state.blocks, null);
		states.delete(sizer);
		// Detach the old render tree so it can be garbage collected instead
		// of lingering as a detached DOM subtree.
		state.wrapper.remove();
		state.previewEl.classList.remove(RV_ACTIVE_CLASS);
		if (!state.host.hasChildNodes()) {
			state.host.remove();
		}

		const retries = retryCounts.get(sizer) ?? 0;
		if (retries >= 5) {
			rvError("max retries reached, giving up", {reason, retries});
			return;
		}
		retryCounts.set(sizer, retries + 1);
		scheduleRender(sizer, state.sourcePath, `recover:${reason}`);
	}

	function installLifecycleObservers(
		sizer: HTMLElement,
		state: RenderState,
	): void {
		state.previewObserver?.disconnect();
		state.hostObserver?.disconnect();
		state.wrapperObserver?.disconnect();
		state.sizerObserver?.disconnect();

		// Watch sizer for newly added children (scroll virtualization, mode switch)
		// and hide el-* / pusher elements that Obsidian adds after our initial render.
		// The AMC host deliberately remains a sibling of the sizer so those virtual
		// DOM mutations cannot remove it and trigger a recovery-render loop.
		const sizerObserver = new MutationObserver((mutations) => {
			// Banner plugins set the sizer's top padding after it rendered.
			if (mutations.some((m) => m.type === "attributes")) carrySizerPadding(sizer);
			if (mutations.every((m) => m.type === "attributes")) return;
			for (const mutation of mutations) {
				for (const node of Array.from(mutation.addedNodes)) {
					if (node.instanceOf(HTMLElement) && isReplacedSection(node)) node.classList.add(RV_HIDDEN_CLASS);
				}
			}
			if (!state.host.isConnected || state.host.parentElement !== state.previewEl) {
				handleWrapperDisappearance(sizer, state, "sizer-observer");
				return;
			}
			placeWrapperHost(state.previewEl, sizer, state.host);
		});
		sizerObserver.observe(sizer, {childList: true, attributes: true, attributeFilter: ["style"]});

		const previewObserver = new MutationObserver((mutations) => {
			for (const mutation of mutations) {
				if (mutation.type === "attributes" && mutation.attributeName === "class") {
					if (!state.previewEl.classList.contains(RV_ACTIVE_CLASS) && state.wrapper.isConnected) {
						rvWarn("active class removed while wrapper is still connected", {
							...sizerSnapshot(sizer, state),
						});
					}
				}
				if (mutation.type === "childList") {
					for (const removed of Array.from(mutation.removedNodes)) {
						if (removed === state.host) {
							rvError("host removed via preview childList mutation", {
								...sizerSnapshot(sizer, state),
							});
						}
					}
				}
			}

			if (
				!state.host.isConnected
				|| state.host.parentElement !== state.previewEl
				|| !state.wrapper.isConnected
				|| state.wrapper.parentElement !== state.host
			) {
				handleWrapperDisappearance(sizer, state, "preview-observer");
			}
		});
		previewObserver.observe(state.previewEl, {
			childList: true,
			attributes: true,
			attributeFilter: ["class", "style"],
		});

		const hostObserver = new MutationObserver((mutations) => {
			for (const mutation of mutations) {
				if (mutation.type === "childList") {
					for (const removed of Array.from(mutation.removedNodes)) {
						if (removed === state.wrapper) {
							rvError("wrapper removed via host childList mutation", {
								...sizerSnapshot(sizer, state),
							});
						}
					}
				}
				if (mutation.type === "attributes") {
					rvWarn("host attributes changed", {
						attribute: mutation.attributeName,
						...sizerSnapshot(sizer, state),
					});
				}
			}

			if (!state.wrapper.isConnected || state.wrapper.parentElement !== state.host) {
				handleWrapperDisappearance(sizer, state, "host-observer");
			}
		});
		hostObserver.observe(state.host, {
			childList: true,
			attributes: true,
			attributeFilter: ["class", "style", "hidden"],
		});

		const wrapperObserver = new MutationObserver((mutations) => {
			for (const mutation of mutations) {
				if (mutation.type !== "attributes") continue;
				rvWarn("wrapper attributes changed", {
					attribute: mutation.attributeName,
					...sizerSnapshot(sizer, state),
				});
			}
			if (!state.wrapper.isConnected || state.wrapper.parentElement !== state.host) {
				handleWrapperDisappearance(sizer, state, "wrapper-observer");
			}
		});
		wrapperObserver.observe(state.wrapper, {
			attributes: true,
			attributeFilter: ["class", "style", "hidden"],
		});

		state.previewObserver = previewObserver;
		state.hostObserver = hostObserver;
		state.wrapperObserver = wrapperObserver;
		state.sizerObserver = sizerObserver;
		rvWarn("lifecycle observers attached", sizerSnapshot(sizer, state));
	}

	const readSource = async (
		sourcePath: string,
		fallbackText: string,
	): Promise<string> => {
		if (!sourcePath) return fallbackText;

		const pending = sourceReads.get(sourcePath);
		if (pending) {
			const text = await pending;
			return text ?? fallbackText;
		}

		const read = (async () => {
			const file = plugin.app.vault.getAbstractFileByPath(sourcePath);
			if (!(file instanceof TFile)) return null;
			try {
				return await plugin.app.vault.cachedRead(file);
			} catch {
				return null;
			}
		})();

		// Race with a 10s timeout to prevent hanging promises
		const withTimeout = Promise.race([
			read,
			new Promise<null>((resolve) => window.window.setTimeout(() => resolve(null), 10_000)),
		]);

		sourceReads.set(sourcePath, withTimeout);
		try {
			const text = await withTimeout;
			return text ?? fallbackText;
		} finally {
			sourceReads.delete(sourcePath);
		}
	};

	async function renderSizer(
		sizer: HTMLElement,
		reason: string,
	): Promise<void> {
		activeSizers.add(sizer);
		const token = (renderTokens.get(sizer) ?? 0) + 1;
		renderTokens.set(sizer, token);

		rvWarn("render start", {
			reason,
			token,
			sourceHint: sourceHints.get(sizer) ?? "",
			sizerConnected: sizer.isConnected,
			sizerChildren: sizer.children.length,
		});

		if (!sizer.isConnected) {
			rvWarn("render skipped: sizer disconnected", {token});
			return;
		}
		const previewEl = resolvePreviewElementForSizer(sizer);
		if (!previewEl) {
			rvWarn("render skipped: no preview element for sizer", {token});
			return;
		}
		if (!isSupportedPreview(previewEl, plugin)) {
			invalidateRenderToken(sizer);
			teardownSizer(sizer, states, "render skipped: not in reading view");
			return;
		}
		const view = resolveViewForSizer(sizer, plugin);
		let mountedState: RenderState | null = null;
		const shouldRestoreScroll = (): boolean => {
			if (!plugin.settings.enableReadingView) return false;
			if (!sizer.isConnected) return false;
			// After a successful mount, restore as long as that render is still
			// the current one.  Coalesced renders bump the token, so the token
			// alone would wrongly cancel the restore.
			if (mountedState) {
				if (states.get(sizer) !== mountedState) return false;
			} else if (renderTokens.get(sizer) !== token) {
				return false;
			}
			if (!previewEl.isConnected) return false;
			if (!isSupportedPreview(previewEl, plugin)) return false;
			return true;
		};
		if (!plugin.settings.enableReadingView) {
			invalidateRenderToken(sizer);
			teardownSizer(sizer, states, "settings disabled");
			return;
		}

		const sourcePath = sourceHints.get(sizer) || view?.file?.path || "";

		if (view && ownSizerOf(view) === sizer) {
			// Another note is loading: view.file names it, but the view's data
			// is still the previous note's. Building now would lay out the old
			// text (and the next build would redo it) while slowing the load
			// down; the build starts once the note has loaded (afterFileLoad).
			if (isLoadingFile(view)) return;
			// The pane shows the editor, not reading view: build when it
			// switches to reading view (layout-change), not on every note
			// opened or changed while editing.
			if (view.getMode() !== "preview") {
				prepareHiddenLayer(view);
				return;
			}
			// Opening a note re-renders the note's header (inline title,
			// properties). Columns laid out before it is back jumped down when
			// it appeared, and the build held it up. Reading view always has
			// the header element (empty when both are off); wait a little.
			if (!sizer.querySelector(":scope > .mod-header")) {
				const waits = headerWaits.get(sizer) ?? 0;
				if (waits < HEADER_WAIT_TRIES) {
					headerWaits.set(sizer, waits + 1);
					scheduleRender(sizer, sourcePath, "await-header", HEADER_WAIT_MS);
					return;
				}
			}
			headerWaits.delete(sizer);
		}

		if (!view && !sourcePath) {
			// No view and no source hint — retry after a short delay
			// (workspace may not be fully initialized on first load)
			const retries = retryCounts.get(sizer) ?? 0;
			if (retries < 5) {
				retryCounts.set(sizer, retries + 1);
				rvWarn("render deferred: no view or source path, retrying", {token, retries});
				scheduleRender(sizer, "", `retry-no-view:${retries}`);
			} else {
				rvWarn("render skipped: no view or source path after retries", {token});
			}
			return;
		}

		installReadingScrollMapping((view?.previewMode as {renderer?: unknown} | undefined)?.renderer);
		// The note's own view has the latest text (edits not yet saved); embeds
		// and other notes are read from the vault.
		const liveText = view && view.file?.path === sourcePath ? view.getViewData() : null;
		const text = liveText ?? await readSource(sourcePath, view?.getViewData() ?? "");

		if (!sizer.isConnected || renderTokens.get(sizer) !== token) {
			rvWarn("render aborted: stale token or disconnected sizer", {
				token,
				sizerConnected: sizer.isConnected,
				currentToken: renderTokens.get(sizer) ?? 0,
			});
			return;
		}

		const regions = text.includes("col-start") ? findColumnRegions(text) : [];
		if (regions.length === 0) {
			// On first load the vault/view may not be ready yet, yielding empty text.
			// Retry only that case; ordinary non-column notes should not be reparsed.
			const retries = retryCounts.get(sizer) ?? 0;
			if (text.trim().length === 0 && retries < 2 && sourcePath) {
				retryCounts.set(sizer, retries + 1);
				rvWarn("render found no regions, retrying", {sourcePath, retries});
				scheduleRender(sizer, sourcePath, `retry-no-regions:${retries}`);
			} else {
				retryCounts.delete(sizer);
				rvWarn("render found no marker regions", {sourcePath});
				// Kill any pending build so it cannot mount columns for
				// content that no longer has any.
				inFlightBuilds.delete(sizer);
				teardownSizer(sizer, states, "no regions");
			}
			return;
		}

		const fingerprint = textFingerprint(sourcePath, text, regions);
		const existing = states.get(sizer);
		if (
			existing
			&& existing.fingerprint === fingerprint
			&& existing.wrapper.isConnected
			&& existing.host.isConnected
			&& existing.host.parentElement === existing.previewEl
			&& existing.wrapper.parentElement === existing.host
		) {
			if (!existing.previewEl.classList.contains(RV_ACTIVE_CLASS)) {
				rvWarn("wrapper connected but active class missing; restoring class", {
					...sizerSnapshot(sizer, existing),
				});
			}
			existing.previewEl.classList.add(RV_ACTIVE_CLASS);
			existing.host.classList.remove(RV_PENDING_CLASS);
			applyPendingScroll(existing.previewEl);
			hideSizerContent(sizer);
			rvWarn("render reused existing wrapper", sizerSnapshot(sizer, existing));
			return;
		}

		const flying = inFlightBuilds.get(sizer);
		if (flying && flying.fingerprint === fingerprint) {
			rvWarn("render coalesced into in-flight build", {token, fingerprint});
			return;
		}

		if (shouldSuppressBuild(sizer, fingerprint)) {
			rvWarn("render suppressed: too many rebuilds", sizerSnapshot(sizer, existing));
			// Re-check after the window has cleared so a legitimate change made
			// during suppression is still rendered eventually.  If nothing
			// changed, the fingerprint reuse path exits without a rebuild.
			scheduleRender(sizer, sourcePath, "retry-after-suppression", BUILD_WINDOW_MS);
			return;
		}

		// Keep the current layer on screen while the new one builds and swap
		// them in one step: tearing it down first showed the raw note text
		// until the build finished. Another note's layer is hidden meanwhile.
		const previous = existing?.host.isConnected && existing.previewEl === previewEl ? existing : null;
		if (existing && !previous) teardownSizer(sizer, states, "refresh");
		if (previous) {
			disconnectObservers(previous);
			if (previous.sourcePath !== sourcePath) previous.host.classList.add(RV_PENDING_CLASS);
		}

		const host = previous?.host ?? ensureWrapperHost(previewEl, sizer);

		const component = new Component();
		component.load();
		const renderId = ++renderIdSeq;
		let scrollSnapshot: ScrollSnapshot[] = [];
		inFlightBuilds.set(sizer, {token, fingerprint});
		// Another build of the same note: take over its unchanged blocks.
		const reuse = new BlockReuse(previous?.sourcePath === sourcePath ? previous.blocks : []);
		// A note opened in the pane shows its first screen (or where it is
		// restored to) right away, and the rest of it is rendered afterwards.
		// A rebuild of the note on screen renders all of it: it reuses most
		// blocks, and its scroll position is kept in pixels.
		const renderThroughLine = view && ownSizerOf(view) === sizer && previous?.sourcePath !== sourcePath
			? (pendingScrollLine(previewEl) ?? 0) + FILL_MARGIN_LINES
			: undefined;
		let built: BuiltLayer | null = null;

		try {
			built = await buildWrapper(plugin, sourcePath, text, regions, component, reuse, renderThroughLine);
			const {wrapper} = built;

			// Drop only if a different build superseded this one (or the view
			// went away) — same-fingerprint renders coalesced instead.
			if (!sizer.isConnected || inFlightBuilds.get(sizer)?.token !== token) {
				component.unload();
				unloadNewBlocks(built.blocks, reuse);
				rvWarn("render result dropped: stale after async build", {
					renderId,
					token,
					sizerConnected: sizer.isConnected,
				});
				return;
			}
			inFlightBuilds.delete(sizer);

			// Recovery renders must not force a scroll position captured after the
			// DOM was damaged. That position may already be stale and was the source
			// of the repeated scrollbar jumps in the old remount loop.
			// Capture it before the old layer goes: without it the page is
			// briefly empty, the browser resets the scroll to the top, and that
			// was restored (reading view jumped to the top on every save).
			if (!reason.startsWith("recover:")) {
				scrollSnapshot = captureScrollSnapshot(previewEl);
			}
			if (previous && states.get(sizer) === previous) {
				previous.stopFilling?.();
				previous.component.unload();
				unloadUntakenBlocks(previous.blocks, reuse);
				states.delete(sizer);
			}
			while (host.firstChild) {
				host.removeChild(host.firstChild);
			}
			host.classList.remove(RV_PENDING_CLASS);
			wrapper.dataset.columnsRenderId = String(renderId);
			previewEl.classList.add(RV_ACTIVE_CLASS);
			host.appendChild(wrapper);
			built.adopt();
			// Re-hide in case anything was added between observer batches
			hideSizerContent(sizer);
			// A footer moved out by an older version goes back to Obsidian.
			restoreFooter(previewEl, sizer);
			placeWrapperHost(previewEl, sizer, host);
			const state: RenderState = {
				sourcePath,
				fingerprint,
				wrapper,
				host,
				previewEl,
				component,
				blocks: built.blocks,
				renderId,
				createdAt: Date.now(),
			};
			states.set(sizer, state);
			mountedState = state;
			setLayerFiller(previewEl, built.fill);
			// A position Obsidian applied while this layer was being built (e.g.
			// going back to the note) wins over keeping the current scroll.
			if (!applyPendingScroll(previewEl) && scrollSnapshot.length > 0) {
				restoreScrollSnapshotStable(scrollSnapshot, shouldRestoreScroll);
			}
			state.stopFilling = built.fillInBackground(previewEl.win);
			retryCounts.delete(sizer);
			installLifecycleObservers(sizer, state);
			rvWarn("rendered wrapper", {
				renderId,
				sourcePath,
				regions: regions.length,
				columnsContainers: wrapper.querySelectorAll(".columns-container").length,
				sizerChildren: sizer.children.length,
			});
		} catch (error) {
			if (inFlightBuilds.get(sizer)?.token === token) {
				inFlightBuilds.delete(sizer);
			}
			component.unload();
			if (built) unloadNewBlocks(built.blocks, reuse);
			teardownSizer(sizer, states, "render failed");
			previewEl.classList.remove(RV_ACTIVE_CLASS);
			restoreSizerContent(sizer);
			if (scrollSnapshot.length > 0) {
				restoreScrollSnapshotStable(scrollSnapshot, shouldRestoreScroll);
			}
			rvError("render failed", {
				renderId,
				sourcePath,
				error,
			});
		}
	}

	plugin.registerMarkdownPostProcessor(
		(el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
			// Ignore renders inside our own containers.  This must also match
			// containers that are no longer attached to a wrapper: when a
			// stale build is dropped and its component unloaded, pending
			// async post-processors (Dataview, Meta Bind, ...) still fire for
			// the detached column elements.  Scheduling from those would make
			// every rebuild trigger the next one — an infinite remount loop.
			// A note embedded in the layer is its own preview, though, and
			// lays out its own columns.
			if (isOwnLayerContent(el)) return;

			// PDF export renders the whole note into one element outside any view.
			if (el.closest(".print")) {
				if (plugin.settings.enableReadingView) renderForExport(plugin, el, ctx);
				return;
			}

			if (isUnsizedEmbedPreview(el)) {
				if (plugin.settings.enableReadingView) void renderNoteInPlace(plugin, el, ctx, () => false);
				return;
			}

			const sizer = resolveSizerForElement(el, ctx, plugin);
			if (!sizer?.instanceOf(HTMLElement)) return;
			const previewEl = resolvePreviewElementForSizer(sizer);
			if (!previewEl?.instanceOf(HTMLElement)) return;
			if (!isSupportedPreview(previewEl, plugin)) return;

			if (!plugin.settings.enableReadingView) {
				teardownSizer(sizer, states, "settings disabled in postprocessor");
				return;
			}

			const sourcePath = ctx.sourcePath ?? "";
			const existing = states.get(sizer);
			if (existing) {
				if (!existing.wrapper.isConnected || existing.wrapper.parentElement !== existing.host) {
					rvError("postprocessor detected missing wrapper", sizerSnapshot(sizer, existing));
				} else if (!existing.previewEl.classList.contains(RV_ACTIVE_CLASS)) {
					rvWarn("postprocessor detected wrapper without active class", sizerSnapshot(sizer, existing));
				}
			}

			// Another note is now shown in this pane: hide the previous note's
			// columns right away and build the new ones without the debounce
			// (the build reads the whole note, not the section being rendered).
			const switched = !existing || existing.sourcePath !== sourcePath;
			if (existing && switched) existing.host.classList.add(RV_PENDING_CLASS);
			scheduleRender(sizer, sourcePath, "postprocessor", switched ? 0 : 50);
		},
	);

	/** Note a sizer currently shows: the view's file for a reading view's own
	 * sizer (it changes when another note opens in the pane), else the path the
	 * sizer was rendered from (embeds, canvas cards). */
	const currentPathForSizer = (sizer: HTMLElement): string => {
		const view = resolveViewForSizer(sizer, plugin);
		if (view?.file && view.previewMode.containerEl.querySelector(".markdown-preview-sizer") === sizer) {
			return view.file.path;
		}
		return states.get(sizer)?.sourcePath ?? sourceHints.get(sizer) ?? "";
	};

	const rescheduleForPath = (path: string | null, reason: string) => {
		for (const sizer of activeSizers) {
			if (!sizer.isConnected) {
				activeSizers.delete(sizer);
				continue;
			}
			// Re-render the note the sizer shows now. Using the path of the
			// previous render rebuilt the old note after a note switch, because
			// opening a note also fires layout-change.
			const sizerPath = currentPathForSizer(sizer);
			if (path === null || sizerPath === path) scheduleRender(sizer, sizerPath, reason, 150);
		}
	};
	plugin.registerEvent(plugin.app.vault.on("modify", (file) => rescheduleForPath(file.path, "file-modified")));
	// Switching a pane from editing to reading shows the editor's latest text.
	plugin.registerEvent(plugin.app.workspace.on("layout-change", () => rescheduleForPath(null, "layout-change")));

	/**
	 * The view's note has columns but reading view has no layer for it yet:
	 * it was just opened, or the pane shows the editor (the layer is built when
	 * reading view is shown). Hide Obsidian's own rendering of reading view
	 * now, so it shows an empty note until the columns are built, never the
	 * note without columns, and scroll positions applied meanwhile are kept
	 * for the columns (see reading-scroll).
	 */
	const prepareHiddenLayer = (view: MarkdownView): void => {
		const sizer = ownSizerOf(view);
		const previewEl = sizer?.parentElement;
		const path = view.file?.path;
		if (!sizer || !previewEl || !path || !plugin.settings.enableReadingView) return;
		const state = states.get(sizer);
		if (state?.sourcePath === path) return;
		if (!view.getViewData().includes("col-start")) {
			if (state) state.host.classList.add(RV_PENDING_CLASS);
			return;
		}
		const host = state?.host ?? ensureWrapperHost(previewEl, sizer);
		host.classList.add(RV_PENDING_CLASS);
		previewEl.classList.add(RV_ACTIVE_CLASS);
		hideSizerContent(sizer);
		activeSizers.add(sizer);
		sourceHints.set(sizer, path);
	};

	/** Reading view is shown and its columns are not ready: build them now. */
	const renderShownReadingViews = (): void => {
		for (const leaf of plugin.app.workspace.getLeavesOfType("markdown")) {
			const view = leaf.view;
			if (!(view instanceof MarkdownView) || !view.file || view.getMode() !== "preview") continue;
			const sizer = ownSizerOf(view);
			if (!sizer || !activeSizers.has(sizer)) continue;
			const state = states.get(sizer);
			if (state?.sourcePath === view.file.path && !state.host.classList.contains(RV_PENDING_CLASS)) continue;
			scheduleRender(sizer, view.file.path, "reading-view-shown", 0);
		}
	};
	plugin.registerEvent(plugin.app.workspace.on("layout-change", renderShownReadingViews));

	addMarkdownViewHooks(plugin, {
		// Another note opens in the pane: hide the previous note's columns at
		// once. They stayed on screen under the new note's title until the new
		// note's sections rendered.
		beforeFileChange: (view, next) => {
			const sizer = ownSizerOf(view);
			const state = sizer ? states.get(sizer) : undefined;
			if (state && state.sourcePath !== next?.path) state.host.classList.add(RV_PENDING_CLASS);
		},
		// Build the new note's columns as soon as its text is in the view, or
		// get reading view ready for them while the pane shows the editor.
		afterFileLoad: (view) => {
			const sizer = ownSizerOf(view);
			if (!sizer || !view.file) return;
			if (view.getMode() !== "preview") {
				prepareHiddenLayer(view);
			} else if (!view.getViewData().includes("col-start")) {
				// No columns: take the previous note's layer down before Obsidian
				// restores the note's scroll position, so it applies to the note.
				invalidateRenderToken(sizer);
				teardownSizer(sizer, states, "loaded a note without columns");
			} else {
				// Until the columns are built: no raw note, and the scroll
				// position Obsidian restores is kept for them.
				prepareHiddenLayer(view);
				scheduleRender(sizer, view.file.path, "file-loaded", 0);
			}
		},
	});

	// Opening another note in a pane: hide the previous note's columns before
	// the first frame of the new note, so they never show over it.
	plugin.registerEvent(
		plugin.app.workspace.on("file-open", () => {
			for (const sizer of activeSizers) {
				const state = states.get(sizer);
				if (state && sizer.isConnected && currentPathForSizer(sizer) !== state.sourcePath) {
					state.host.classList.add(RV_PENDING_CLASS);
				}
			}
		}),
	);

	// When navigating to a different file (especially one without columns),
	// the post-processor may never fire — clean up stale wrappers so the
	// old file's content doesn't linger in the new file's pane.
	plugin.registerEvent(
		plugin.app.workspace.on("active-leaf-change", () => {
			const leaves = plugin.app.workspace.getLeavesOfType("markdown");
			for (const leaf of leaves) {
				const view = leaf.view;
				if (!(view instanceof MarkdownView)) continue;
				const previewEl = view.previewMode.containerEl.querySelector(
					".markdown-preview-view",
				);
				if (!previewEl?.instanceOf(HTMLElement)) continue;
				if (!previewEl.classList.contains(RV_ACTIVE_CLASS)) continue;

				// Check if the current file's source path still matches the wrapper
				const host = getWrapperHost(previewEl);
				if (!host) continue;
				const wrapper = host.querySelector<HTMLElement>(".columns-rv-wrapper");
				const wrapperPath = wrapper?.dataset.columnsSourcePath ?? "";
				const currentPath = view.file?.path ?? "";

				if (wrapperPath && currentPath && wrapperPath !== currentPath) {
					rvWarn("stale wrapper detected on leaf change", {
						wrapperPath,
						currentPath,
					});
					// Hide the old note's columns and render the new note; the
					// render tears the layer down if the new note has none.
					const sizer = previewEl.querySelector(
						".markdown-preview-sizer",
					);
					if (sizer?.instanceOf(HTMLElement)) {
						host.classList.add(RV_PENDING_CLASS);
						scheduleRender(sizer, currentPath, "file-changed", 0);
					} else {
						// No sizer — manual cleanup
						host.remove();
						restoreSizerContent(previewEl);
						previewEl.classList.remove(RV_ACTIVE_CLASS);
					}
				}
			}
		}),
	);

	// Return cleanup function for plugin onunload
	return () => {
		for (const sizer of activeSizers) {
			teardownSizer(sizer, states, "plugin-unload");
			const timer = timers.get(sizer);
			if (timer !== undefined) {
				window.clearTimeout(timer.id);
				timers.delete(sizer);
			}
		}
		activeSizers.clear();
		sourceReads.clear();
		uninstallReadingScrollMapping();
	};
}
