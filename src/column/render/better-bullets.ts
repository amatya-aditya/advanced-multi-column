import type {App} from "obsidian";

/**
 * Better Bullets compatibility.
 *
 * Better Bullets replaces list bullets with symbols of its own, but only in
 * the editor (it is a CodeMirror extension). A column that is not being
 * edited is rendered markdown, so its lists kept the theme's dots and only
 * showed the symbols while the column was edited. This gives rendered
 * columns in live preview the same symbol per level, read from Better
 * Bullets' settings: each bullet item is tagged with its level, and a
 * generated stylesheet sets that level's symbol and style on its marker.
 *
 * Not covered: Better Bullets' text rules (styling or numbering by pattern).
 */

const PLUGIN_ID = "better-bullets";
const ROOT_CLASS = "amc-better-bullets";
const LEVEL_ATTR = "data-amc-bullet-level";
/** About 1ch: the gap Better Bullets leaves between the symbol and the text. */
const EN_SPACE = String.fromCharCode(0x2002);
/** Lists Better Bullets leaves alone in the editor (see applyBetterBullets). */
const UNSTYLED_LISTS = "blockquote, .callout, .internal-embed, .markdown-embed";

interface BulletLevel {
	symbol: string;
	css: string;
}

interface BulletSettings {
	/** "hierarchy": by how many levels of children an item has; "indent": by depth. */
	levelType: "hierarchy" | "indent";
	levels: BulletLevel[];
}

/** Better Bullets' settings, or null when it is not enabled (or they look different). */
function bulletSettings(app: App): BulletSettings | null {
	const plugins = (app as App & {plugins?: {enabledPlugins?: Set<string>; plugins?: Record<string, unknown>}}).plugins;
	if (!plugins?.enabledPlugins?.has(PLUGIN_ID)) return null;
	const settings = (plugins.plugins?.[PLUGIN_ID] as {settings?: unknown} | undefined)?.settings;
	if (typeof settings !== "object" || settings === null) return null;
	const {levelType, hierarchy} = settings as {levelType?: unknown; hierarchy?: unknown};
	if (!Array.isArray(hierarchy)) return null;
	const levels = hierarchy
		.filter((l): l is {symbol: unknown; css?: unknown} => typeof l === "object" && l !== null)
		.map((l) => ({
			symbol: typeof l.symbol === "string" ? l.symbol : "",
			css: typeof l.css === "string" ? l.css : "",
		}));
	if (levels.length === 0) return null;
	return {levelType: levelType === "indent" ? "indent" : "hierarchy", levels};
}

/** Levels of children below a list item (0 for an item without children), as Better Bullets counts them. */
function childLevels(li: HTMLLIElement, cache: Map<HTMLLIElement, number>): number {
	const known = cache.get(li);
	if (known !== undefined) return known;
	let levels = 0;
	for (const list of Array.from(li.children)) {
		if (list.tagName !== "UL" && list.tagName !== "OL") continue;
		for (const child of Array.from(list.children)) {
			if (child instanceof HTMLLIElement) levels = Math.max(levels, childLevels(child, cache) + 1);
		}
	}
	cache.set(li, levels);
	return levels;
}

/** Nesting depth of a list item inside `root` (0 at the top). */
function depthOf(li: HTMLElement, root: HTMLElement): number {
	let depth = 0;
	for (let el = li.parentElement; el && el !== root; el = el.parentElement) {
		if (el.tagName === "LI") depth++;
	}
	return depth;
}

/** Characters that could end the generated rule; Better Bullets' CSS is a list of declarations. */
function safeDeclarations(css: string): string {
	return css.replace(/[{}<>]/g, "").trim();
}

function cssString(text: string): string {
	return `"${text.replace(/\\/g, "\\\\").replace(/"/g, "\\\"").replace(/\n/g, " ")}"`;
}

/**
 * Marker rules for each level; the last level also covers deeper ones (as in
 * Better Bullets). As in the editor, the symbol has the text's color (not
 * the theme's muted marker color) and about 1ch (an en space) before the text.
 */
function buildStyles(settings: BulletSettings): string {
	return settings.levels.map((level, i) => {
		const declarations = safeDeclarations(level.css);
		return `.${ROOT_CLASS} li[${LEVEL_ATTR}="${i}"]::marker {\n`
			+ `\tcontent: ${cssString(`${level.symbol}${EN_SPACE}`)};\n`
			+ "\tcolor: inherit;\n"
			+ (declarations ? `\t${declarations}${declarations.endsWith(";") ? "" : ";"}\n` : "")
			+ "}";
	}).join("\n");
}

/** Receives the generated stylesheet whenever Better Bullets' settings change. */
let styleSink: ((css: string) => void) | null = null;
let lastStyles = "";

export function setBulletStyleSink(sink: ((css: string) => void) | null): void {
	styleSink = sink;
	lastStyles = "";
}

/**
 * Give the bullet items of rendered markdown in `root` Better Bullets'
 * symbols. Does nothing when Better Bullets is not enabled. Numbered lists
 * keep their numbers and tasks their checkboxes, as in Better Bullets.
 */
export function applyBetterBullets(app: App, root: HTMLElement): void {
	const settings = bulletSettings(app);
	const styles = settings ? buildStyles(settings) : "";
	if (styles !== lastStyles) {
		lastStyles = styles;
		styleSink?.(styles);
	}
	if (!settings) {
		root.removeClass(ROOT_CLASS);
		return;
	}
	root.addClass(ROOT_CLASS);
	const last = settings.levels.length - 1;
	const cache = new Map<HTMLLIElement, number>();
	for (const li of Array.from(root.querySelectorAll<HTMLLIElement>("ul > li"))) {
		if (li.hasClass("task-list-item")) continue;
		// Better Bullets only styles lines that start with a list marker: lists
		// in callouts and quotes (lines starting with ">") keep their bullets in
		// the editor, and embedded notes are rendered like reading view.
		const outside = li.closest(UNSTYLED_LISTS);
		if (outside && root.contains(outside)) continue;
		const level = settings.levelType === "indent" ? depthOf(li, root) : childLevels(li, cache);
		li.setAttribute(LEVEL_ATTR, String(Math.min(level, last)));
	}
}
