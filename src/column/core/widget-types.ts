import type {ColumnData} from "./types";

export interface ColumnContextActions {
	editColumn?: () => void;
	editMoc?: () => void;
	addColumn?: () => void;
	addChild?: () => void;
	deleteColumn?: () => void;
}

export interface ContainerPathEntry {
	columnIndex: number;
	regionIndex: number;
}

export type ContainerPath = ContainerPathEntry[];

export interface ActiveEditState {
	/**
	 * Note the edit belongs to. The editor view outlives a note switch in its
	 * tab, so offsets and keys alone can match a block in the next note.
	 */
	filePath: string;
	regionFrom: number;
	/** Source text of the block when editing started (see live-edit). */
	regionSource?: string;
	/** Identifies the editor inside the block, e.g. "c0" or "c1/0.0/c2/s1". */
	key: string;
	cursorStart: number;
	cursorEnd: number;
	scrollTop: number;
	value: string;
	/** The editor wiring that currently owns this state. */
	owner?: object;
	/** Set when the owning editor was destroyed by a rebuild. */
	orphaned?: boolean;
}

export interface ActiveDragState {
	sourceRegionFrom: number;
	sourcePath: ContainerPath;
	sourceIndex: number;
	dropHandled: boolean;
}

export const BLOCK_LANGUAGE_PREVIEW_SELECTOR = [
	".el-pre",
	"pre",
	"[class*='block-language-']",
].join(",");

export const INTERACTIVE_PREVIEW_SELECTOR = [
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
	// Heading and list fold toggles (see render/fold).
	".collapse-indicator",
	// Collapsible callout headers toggle their fold instead of opening the editor.
	".callout.is-collapsible > .callout-title",
	".mod-slider",
	".slider",
	".markdown-embed",
	".internal-embed",
	".media-embed",
	BLOCK_LANGUAGE_PREVIEW_SELECTOR,
].join(",");

export function isSameStyle(a: ColumnData["style"], b: ColumnData["style"]): boolean {
	return (
		a?.background === b?.background &&
		a?.borderColor === b?.borderColor &&
		a?.textColor === b?.textColor &&
		a?.showBorder === b?.showBorder &&
		a?.horizontalDividers === b?.horizontalDividers
	);
}

export function isInteractivePreviewTarget(
	target: HTMLElement,
	scopeEl?: HTMLElement,
): boolean {
	const interactive = target.closest(INTERACTIVE_PREVIEW_SELECTOR);
	if (!interactive) return false;
	// Plain image embeds have nothing to interact with; clicking them must
	// still open the column editor (image-only columns were uneditable).
	if (interactive.classList.contains("image-embed") && !target.closest("a")) return false;
	if (!scopeEl) return true;
	return scopeEl.contains(interactive);
}

export function isBlockLanguagePreviewTarget(
	target: HTMLElement,
	scopeEl: HTMLElement,
): boolean {
	const block = target.closest(BLOCK_LANGUAGE_PREVIEW_SELECTOR);
	if (!block) return false;
	return scopeEl.contains(block);
}
