import {App, setIcon} from "obsidian";

/**
 * Heading and list folding for markdown the plugin renders itself.
 *
 * Column content (and, in reading view, the whole note) is rendered with
 * MarkdownRenderer, which leaves out the fold indicators Obsidian adds to its
 * own sections. They are added here, honoring the "Fold heading" and "Fold
 * indent" editor settings.
 */

/** Elements whose blocks a heading folds: a column, or the reading-view layer. */
const FOLD_SCOPE_SELECTOR = ".column-preview, .column-inline-edit-preview, .columns-rv-wrapper";
/** Render target inside a fold scope; its blocks belong to the scope's sequence. */
const FOLD_PART_CLASS = "amc-fold-part";
const FOLD_HIDDEN_CLASS = "amc-fold-hidden";
const COLLAPSED_CLASS = "is-collapsed";
const HEADING_TAGS = new Set(["H1", "H2", "H3", "H4", "H5", "H6"]);

function isFoldEnabled(app: App, key: "foldHeading" | "foldIndent"): boolean {
	const getConfig = (app.vault as unknown as {getConfig?: (key: string) => unknown}).getConfig;
	return getConfig?.call(app.vault, key) !== false;
}

function headingLevel(el: Element): number {
	return HEADING_TAGS.has(el.tagName) ? Number(el.tagName.slice(1)) : 0;
}

function createIndicator(cls: string, onToggle: (indicator: HTMLElement) => void): HTMLElement {
	const indicator = createSpan({cls: `${cls} collapse-indicator collapse-icon`});
	setIcon(indicator, "right-triangle");
	indicator.addEventListener("click", (evt) => {
		evt.preventDefault();
		evt.stopPropagation();
		onToggle(indicator);
	});
	return indicator;
}

/** Top-level blocks of a scope in document order, looking through render targets. */
function scopeBlocks(scope: Element): Element[] {
	const blocks: Element[] = [];
	for (const child of Array.from(scope.children)) {
		if (child.classList.contains(FOLD_PART_CLASS)) blocks.push(...Array.from(child.children));
		else blocks.push(child);
	}
	return blocks;
}

/** Re-apply the heading folds of a scope after its blocks changed. */
export function refreshHeadingFolds(scope: Element): void {
	applyHeadingFolds(scope);
}

/** Hide everything under a collapsed heading, up to the next heading of the same or a higher level. */
function applyHeadingFolds(scope: Element): void {
	let hideBelow = 0;
	for (const block of scopeBlocks(scope)) {
		const level = headingLevel(block);
		if (hideBelow > 0 && (level === 0 || level > hideBelow)) {
			block.classList.add(FOLD_HIDDEN_CLASS);
			continue;
		}
		hideBelow = 0;
		block.classList.remove(FOLD_HIDDEN_CLASS);
		if (level > 0 && block.classList.contains(COLLAPSED_CLASS)) hideBelow = level;
	}
}

/**
 * Add fold indicators to the blocks MarkdownRenderer just rendered into `el`.
 * Headings fold the rest of their column (or, outside columns, of the note);
 * list items fold their sub-lists.
 */
export function addFoldControls(app: App, el: HTMLElement): void {
	if (!el.matches(FOLD_SCOPE_SELECTOR)) el.classList.add(FOLD_PART_CLASS);

	if (isFoldEnabled(app, "foldHeading")) {
		for (const heading of Array.from(el.children)) {
			if (!headingLevel(heading) || heading.querySelector(":scope > .collapse-indicator")) continue;
			heading.prepend(createIndicator("heading-collapse-indicator", (indicator) => {
				const collapsed = heading.classList.toggle(COLLAPSED_CLASS);
				indicator.classList.toggle(COLLAPSED_CLASS, collapsed);
				const scope = heading.closest(FOLD_SCOPE_SELECTOR) ?? heading.parentElement;
				if (scope) applyHeadingFolds(scope);
			}));
		}
	}

	if (isFoldEnabled(app, "foldIndent")) {
		for (const li of Array.from(el.querySelectorAll("li"))) {
			// Embedded notes render (and fold) on their own.
			const embed = li.closest(".internal-embed");
			if (embed && el.contains(embed)) continue;
			if (!li.querySelector(":scope > ul, :scope > ol")) continue;
			if (li.querySelector(":scope > .collapse-indicator")) continue;
			const indicator = createIndicator("list-collapse-indicator", (target) => {
				const collapsed = li.classList.toggle(COLLAPSED_CLASS);
				target.classList.toggle(COLLAPSED_CLASS, collapsed);
			});
			const bullet = li.querySelector(":scope > .list-bullet");
			if (bullet) bullet.after(indicator);
			else li.prepend(indicator);
		}
	}
}
