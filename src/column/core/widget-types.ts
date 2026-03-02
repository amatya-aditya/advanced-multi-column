import type {ColumnData} from "./types";

export interface ColumnContextActions {
	addColumn?: () => void;
	addChild?: () => void;
}

export interface ContainerPathEntry {
	columnIndex: number;
	regionIndex: number;
}

export type ContainerPath = ContainerPathEntry[];

export interface ActiveEditState {
	regionFrom: number;
	columnIndex: number;
	cursorStart: number;
	cursorEnd: number;
	scrollTop: number;
	value: string;
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
	".mod-slider",
	".slider",
	".markdown-embed",
	".internal-embed",
	".media-embed",
	".image-embed",
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
