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
		const blocks = activeBlocks(this.previewEl);
		return blocks ? lineAtScroll(this.previewEl, blocks) : getScroll.call(this);
	};
	proto.applyScroll = function (this: PreviewRenderer, line: number, options?: ScrollOptions): boolean {
		if (typeof line !== "number" || Number.isNaN(line)) return applyScroll.call(this, line, options);
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
