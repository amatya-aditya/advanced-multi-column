/**
 * Scroll mapping for reading views showing the AMC column layer.
 *
 * Obsidian stores and restores the reading-view scroll position as a source
 * line, converted to pixels through the heights of its own rendered sections.
 * With columns active those sections are hidden (zero height) and the note is
 * drawn by AMC's wrapper outside them, so Obsidian's conversion lands in the
 * wrong place: the view jumps whenever it re-applies the position (pane
 * resize, switching between editing and reading, following a heading link).
 *
 * While the column layer is active, the renderer's getScroll/applyScroll are
 * answered from the wrapper instead: every top-level wrapper block records the
 * source lines it was rendered from (data-amc-line-from/to). Other views keep
 * Obsidian's own behaviour.
 */

export const ACTIVE_CLASS = "amc-reading-columns-active";
/** Set on the layer's host while another note's layer is still up (see reading-view). */
const PENDING_CLASS = "amc-rv-pending";
const LINE_FROM = "amcLineFrom";
const LINE_TO = "amcLineTo";

interface ScrollOptions {
	center?: boolean;
	highlight?: boolean;
}

interface PreviewRenderer {
	previewEl: HTMLElement;
	getScroll: (this: PreviewRenderer) => number | null;
	applyScroll: (this: PreviewRenderer, line: number, options?: ScrollOptions) => boolean;
}

interface Block {
	el: HTMLElement;
	from: number;
	to: number;
	top: number;
	height: number;
}

/** Tag a wrapper block with the (0-based, inclusive) source lines it shows. */
export function tagSourceLines(el: Element | null, from: number, to: number): void {
	if (!(el instanceof HTMLElement)) return;
	el.dataset[LINE_FROM] = String(from);
	el.dataset[LINE_TO] = String(Math.max(from, to));
}

/** Map character offsets in `text` to 0-based line numbers. */
export function createLineIndex(text: string): (offset: number) => number {
	const starts = [0];
	for (let i = 0; i < text.length; i++) {
		if (text.charCodeAt(i) === 10) starts.push(i + 1);
	}
	return (offset) => {
		let lo = 0;
		let hi = starts.length - 1;
		while (lo < hi) {
			const mid = (lo + hi + 1) >> 1;
			if (starts[mid]! <= offset) lo = mid;
			else hi = mid - 1;
		}
		return lo;
	};
}

function activeBlocks(previewEl: HTMLElement): Block[] | null {
	if (!previewEl.classList.contains(ACTIVE_CLASS)) return null;
	const wrapper = previewEl.querySelector(":scope > .amc-reading-columns-host > .columns-rv-wrapper");
	if (!wrapper) return null;
	const originTop = previewEl.getBoundingClientRect().top - previewEl.scrollTop;
	const blocks: Block[] = [];
	for (const child of Array.from(wrapper.children)) {
		if (!child.instanceOf(HTMLElement)) continue;
		const from = Number(child.dataset[LINE_FROM]);
		const to = Number(child.dataset[LINE_TO]);
		if (!Number.isFinite(from) || !Number.isFinite(to)) continue;
		const rect = child.getBoundingClientRect();
		blocks.push({el: child, from, to, top: rect.top - originTop, height: rect.height});
	}
	return blocks.length > 0 ? blocks : null;
}

/** Source line (fractional) at the top of the view. */
function lineAtScroll(previewEl: HTMLElement, blocks: Block[]): number {
	const y = previewEl.scrollTop;
	let current = blocks[0]!;
	if (y < current.top) return current.from;
	for (const block of blocks) {
		if (block.top <= y) current = block;
		else break;
	}
	const span = current.to - current.from + 1;
	const fraction = current.height > 0 ? Math.min(1, (y - current.top) / current.height) : 0;
	return current.from + fraction * span;
}

/** Scroll offset showing `line` at the top (or centre) of the view. */
function scrollForLine(previewEl: HTMLElement, blocks: Block[], line: number, center: boolean): number {
	let target = blocks[blocks.length - 1]!;
	for (const block of blocks) {
		if (line <= block.to) {
			target = block;
			break;
		}
	}
	const span = target.to - target.from + 1;
	const fraction = Math.max(0, Math.min(1, (line - target.from) / span));
	let y = target.top + fraction * target.height;
	if (center) y -= previewEl.clientHeight / 2;
	return Math.max(0, y);
}

/** The column layer of another note is still up while this note's is built. */
function isLayerPending(previewEl: HTMLElement): boolean {
	if (!previewEl.classList.contains(ACTIVE_CLASS)) return false;
	const host = previewEl.querySelector(":scope > .amc-reading-columns-host");
	return !host || host.classList.contains(PENDING_CLASS);
}

interface PendingScroll {
	renderer: PreviewRenderer;
	line: number;
	options?: ScrollOptions;
}

/**
 * Scroll positions Obsidian applied while the note's layer was not built yet,
 * e.g. going back to a note restores where it was read. Applying them to the
 * previous note's layer, or to nothing, lost them.
 */
const pendingScrolls = new WeakMap<HTMLElement, PendingScroll>();

/** The line a scroll position waiting for the note's layer will show, if any. */
export function pendingScrollLine(previewEl: HTMLElement): number | null {
	return pendingScrolls.get(previewEl)?.line ?? null;
}

/**
 * Lines past a scroll target that are rendered with it, so the view is full
 * (also when the target is centred).
 */
export const FILL_MARGIN_LINES = 150;

/** Renders a layer's not yet rendered blocks up to a line (see buildWrapper). */
const layerFillers = new WeakMap<HTMLElement, (line: number) => void>();

export function setLayerFiller(previewEl: HTMLElement, fill: ((line: number) => void) | null): void {
	if (fill) layerFillers.set(previewEl, fill);
	else layerFillers.delete(previewEl);
}

/** Blocks of the layer the view scrolls to: rendered first, so it lands on them and not on placeholders. */
function fillTo(previewEl: HTMLElement, line: number): void {
	layerFillers.get(previewEl)?.(line + FILL_MARGIN_LINES);
}

/** Apply a deferred scroll position once the note's layer is mounted. */
export function applyPendingScroll(previewEl: HTMLElement): boolean {
	const pending = pendingScrolls.get(previewEl);
	if (!pending) return false;
	fillTo(previewEl, pending.line);
	const blocks = activeBlocks(previewEl);
	if (!blocks) return false;
	pendingScrolls.delete(previewEl);
	previewEl.scrollTop = scrollForLine(previewEl, blocks, pending.line, !!pending.options?.center);
	return true;
}

/**
 * The note has no columns after all: let Obsidian apply the deferred position.
 * Its sections were hidden until now and are measured over the next frames,
 * so a position that cannot be applied yet is retried for a few frames.
 */
export function releasePendingScroll(previewEl: HTMLElement): void {
	const pending = pendingScrolls.get(previewEl);
	if (!pending) return;
	pendingScrolls.delete(previewEl);
	let tries = 0;
	const attempt = () => {
		if (pending.renderer.applyScroll(pending.line, pending.options) || ++tries >= RELEASE_SCROLL_TRIES) return;
		previewEl.win.requestAnimationFrame(attempt);
	};
	attempt();
}

const RELEASE_SCROLL_TRIES = 10;

let patchedProto: (PreviewRenderer & Record<string, unknown>) | null = null;
let originalGetScroll: PreviewRenderer["getScroll"] | null = null;
let originalApplyScroll: PreviewRenderer["applyScroll"] | null = null;

function isPreviewRenderer(value: unknown): value is PreviewRenderer {
	const r = value as Partial<PreviewRenderer> | null;
	return !!r
		&& r.previewEl instanceof HTMLElement
		&& typeof r.getScroll === "function"
		&& typeof r.applyScroll === "function";
}

/**
 * Patch the reading-view renderer class (once) so AMC column views map
 * scroll positions through the column layer. Safe to call repeatedly.
 */
export function installReadingScrollMapping(renderer: unknown): void {
	if (patchedProto || !isPreviewRenderer(renderer)) return;
	const proto = Object.getPrototypeOf(renderer) as PreviewRenderer & Record<string, unknown>;
	if (typeof proto.getScroll !== "function" || typeof proto.applyScroll !== "function") return;

	const getScroll = proto.getScroll;
	const applyScroll = proto.applyScroll;
	originalGetScroll = getScroll;
	originalApplyScroll = applyScroll;
	patchedProto = proto;

	proto.getScroll = function (this: PreviewRenderer): number | null {
		// The layer on screen belongs to another note (or none is built yet):
		// report the deferred position, never a line of the other note.
		// Obsidian reads the position and applies it again while it renders.
		if (isLayerPending(this.previewEl)) return pendingScrolls.get(this.previewEl)?.line ?? null;
		const blocks = activeBlocks(this.previewEl);
		return blocks ? lineAtScroll(this.previewEl, blocks) : getScroll.call(this);
	};
	proto.applyScroll = function (this: PreviewRenderer, line: number, options?: ScrollOptions): boolean {
		if (typeof line !== "number" || Number.isNaN(line)) return applyScroll.call(this, line, options);
		if (isLayerPending(this.previewEl)) {
			pendingScrolls.set(this.previewEl, {renderer: this, line, options});
			return true;
		}
		fillTo(this.previewEl, line);
		const blocks = activeBlocks(this.previewEl);
		if (!blocks) return applyScroll.call(this, line, options);
		this.previewEl.scrollTop = scrollForLine(this.previewEl, blocks, line, !!options?.center);
		return true;
	};
}

/** Restore Obsidian's own scroll methods (plugin unload). */
export function uninstallReadingScrollMapping(): void {
	if (!patchedProto) return;
	if (originalGetScroll) patchedProto.getScroll = originalGetScroll;
	if (originalApplyScroll) patchedProto.applyScroll = originalApplyScroll;
	patchedProto = null;
	originalGetScroll = null;
	originalApplyScroll = null;
}
