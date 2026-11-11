import {normalizePreset, type ColumnPreset} from "./presets";

const START_RE = /^%%\s*col-start(?:\s*:(.*?))?\s*%%$/;
const BREAK_RE = /^%%\s*col-break(?:\s*:(.*?))?\s*%%$/;
const END_RE = /^%%\s*col-end\s*%%$/;

/** A half-open range of character offsets that must not be parsed as markup. */
export interface SourceRange {
	from: number;
	to: number;
}

export interface FindColumnRegionsOptions {
	/**
	 * Returns true when a position is inside fenced/indented code, inline code,
	 * raw HTML or math. Live preview supplies a Lezer `syntaxTree` predicate;
	 * reading view and nested-string parsing fall back to the text scanner.
	 */
	isIgnoredPosition?: (pos: number) => boolean;
	/** Disable the built-in fenced-code/HTML/math scanner (default: enabled). */
	ignoreCode?: boolean;
}

/** Whether a line is one of this plugin's column markers (start, break or end). */
export function isColumnMarkerLine(line: string): boolean {
	const trimmed = line.trim();
	return START_RE.test(trimmed) || BREAK_RE.test(trimmed) || END_RE.test(trimmed);
}

const BACKGROUND_OPTION_VALUES = [
	"transparent",
	"primary",
	"secondary",
	"alt",
	"accent-soft",
	"red-soft",
	"orange-soft",
	"yellow-soft",
	"green-soft",
	"cyan-soft",
	"blue-soft",
	"pink-soft",
] as const;

const STYLE_COLOR_OPTION_VALUES = [
	"gray",
	"accent",
	"muted",
	"text",
	"secondary",
	"red",
	"orange",
	"yellow",
	"green",
	"cyan",
	"blue",
	"pink",
] as const;

type ColumnBackgroundOption = (typeof BACKGROUND_OPTION_VALUES)[number];
type StyleColorOption = (typeof STYLE_COLOR_OPTION_VALUES)[number];

type SeparatorLineStyle = "solid" | "dashed" | "dotted" | "double" | "custom";

type ColumnStyleData = {
	background?: ColumnBackgroundOption;
	borderColor?: StyleColorOption;
	textColor?: StyleColorOption;
	showBorder?: boolean;
	leftBorder?: boolean;
	horizontalDividers?: boolean;
	separator?: boolean;
	separatorColor?: StyleColorOption;
	separatorStyle?: SeparatorLineStyle;
	separatorWidth?: number;
	separatorCustomChar?: string;
	preset?: ColumnPreset;
	maxHeight?: number;
	fold?: boolean;
};

type ColumnData = {
	content: string;
	widthPercent: number;
	style?: ColumnStyleData;
	stacked?: number;
};

type ColumnLayout = "row" | "stack";

type ColumnRegion = {
	from: number;
	to: number;
	columns: ColumnData[];
	containerStyle?: ColumnStyleData;
	layout?: ColumnLayout;
	mocId?: string;
	virtual?: boolean;
	lineStart: number;
	lineEnd: number;
	columnLineRanges: [number, number][];
	columnContentRanges: [number, number][];
};

const BACKGROUND_OPTIONS: ReadonlySet<string> = new Set(BACKGROUND_OPTION_VALUES);
const STYLE_COLOR_OPTIONS: ReadonlySet<string> = new Set(STYLE_COLOR_OPTION_VALUES);

function isBackgroundOption(value: string): value is ColumnBackgroundOption {
	return BACKGROUND_OPTIONS.has(value);
}

function isStyleColorOption(value: string): value is StyleColorOption {
	return STYLE_COLOR_OPTIONS.has(value);
}

const SEPARATOR_STYLE_OPTIONS: ReadonlySet<string> = new Set(["solid", "dashed", "dotted", "double", "custom"]);

function isSeparatorStyle(value: string): value is SeparatorLineStyle {
	return SEPARATOR_STYLE_OPTIONS.has(value);
}

function parseBoolean(value: string): boolean | null {
	switch (value.toLowerCase()) {
		case "1":
		case "true":
		case "yes":
		case "on":
			return true;
		case "0":
		case "false":
		case "no":
		case "off":
			return false;
		default:
			return null;
	}
}

function parseStyleTokens(
	tokens: ReadonlyArray<string>,
): ColumnStyleData | undefined {
	let style: ColumnStyleData | undefined;
	for (const token of tokens) {
		const sep = token.indexOf(":");
		if (sep <= 0) continue;

		const key = token.slice(0, sep).trim().toLowerCase();
		const rawValue = token.slice(sep + 1).trim();
		if (!rawValue) continue;

		if (!style) style = {};

		switch (key) {
			case "b":
				if (isBackgroundOption(rawValue)) style.background = rawValue;
				break;
			case "bc":
				if (isStyleColorOption(rawValue)) style.borderColor = rawValue;
				break;
			case "t":
			case "tc":
				if (isStyleColorOption(rawValue)) style.textColor = rawValue;
				break;
			case "sb": {
				const parsed = parseBoolean(rawValue);
				if (parsed !== null) style.showBorder = parsed;
				break;
			}
			case "h":
			case "hd": {
				const parsed = parseBoolean(rawValue);
				if (parsed !== null) style.horizontalDividers = parsed;
				break;
			}
			case "sep": {
				const parsed = parseBoolean(rawValue);
				if (parsed !== null) style.separator = parsed;
				break;
			}
			case "sc":
				if (isStyleColorOption(rawValue)) style.separatorColor = rawValue;
				break;
			case "ss":
				if (isSeparatorStyle(rawValue)) style.separatorStyle = rawValue;
				break;
			case "sw": {
				const w = parseInt(rawValue, 10);
				if (Number.isFinite(w) && w >= 1 && w <= 8) style.separatorWidth = w;
				break;
			}
			case "sx":
				if (rawValue.length > 0 && rawValue.length <= 3) style.separatorCustomChar = rawValue;
				break;
			case "lb": {
				const parsed = parseBoolean(rawValue);
				if (parsed !== null) style.leftBorder = parsed;
				break;
			}
			case "preset": {
				const preset = normalizePreset(rawValue);
				if (preset) style.preset = preset;
				break;
			}
			case "mh": {
				const height = parseInt(rawValue, 10);
				if (Number.isFinite(height) && height >= 80 && height <= 4000) {
					style.maxHeight = height;
				}
				break;
			}
			case "fold": {
				const parsed = parseBoolean(rawValue);
				if (parsed !== null) style.fold = parsed;
				break;
			}
		}
	}
	return style && Object.keys(style).length > 0 ? style : undefined;
}

function parseBreakPayload(payload: string | undefined): {
	width: number;
	style?: ColumnStyleData;
	stacked?: number;
} {
	if (!payload) return {width: 0};
	const tokens = payload
		.split(",")
		.map((token) => token.trim())
		.filter((token) => token.length > 0);
	if (tokens.length === 0) return {width: 0};

	let width = 0;
	let stacked: number | undefined;
	let firstTokenHandled = false;
	const styleTokens: string[] = [];

	for (const token of tokens) {
		if (!firstTokenHandled) {
			firstTokenHandled = true;
			if (/^\d+$/.test(token)) {
				width = Math.max(0, Math.min(100, parseInt(token, 10)));
				continue;
			}
			if (token.startsWith("w:")) {
				const maybeWidth = parseInt(token.slice(2), 10);
				if (Number.isFinite(maybeWidth) && maybeWidth > 0) {
					width = Math.max(0, Math.min(100, maybeWidth));
					continue;
				}
			}
		}
		if (token.startsWith("stk:")) {
			const raw = token.slice(4);
			// Support boolean values for backward compatibility
			const boolVal = parseBoolean(raw);
			if (boolVal !== null) {
				stacked = boolVal ? 1 : 0;
			} else {
				// Numeric stack group ID
				const numVal = parseInt(raw, 10);
				if (Number.isFinite(numVal) && numVal >= 0) {
					stacked = numVal;
				}
			}
			continue;
		}
		styleTokens.push(token);
	}

	const style = parseStyleTokens(styleTokens);
	const result: {width: number; style?: ColumnStyleData; stacked?: number} = {width};
	if (style) result.style = style;
	if (stacked && stacked > 0) result.stacked = stacked;
	return result;
}

const LAYOUT_VALUES: ReadonlySet<string> = new Set(["row", "stack"]);

function isColumnLayout(value: string): value is ColumnLayout {
	return LAYOUT_VALUES.has(value);
}

function parseStartPayload(payload: string | undefined): {
	containerStyle?: ColumnStyleData;
	layout?: ColumnLayout;
	mocId?: string;
	virtual?: boolean;
} {
	if (!payload) return {};
	const tokens = payload
		.split(",")
		.map((token) => token.trim())
		.filter((token) => token.length > 0);
	if (tokens.length === 0) return {};

	let layout: ColumnLayout | undefined;
	let mocId: string | undefined;
	let virtual: boolean | undefined;
	const styleTokens: string[] = [];
	for (const token of tokens) {
		if (token.startsWith("l:")) {
			const value = token.slice(2).trim();
			if (isColumnLayout(value)) layout = value;
		} else if (token.startsWith("moc:")) {
			const value = token.slice(4).trim();
			if (/^[\w-]+$/.test(value)) mocId = value;
		} else if (token === "v:1" || token === "virtual:1" || token === "v:true") {
			virtual = true;
		} else if (token === "v:0" || token === "virtual:0" || token === "v:false") {
			virtual = false;
		} else {
			styleTokens.push(token);
		}
	}
	const containerStyle = parseStyleTokens(styleTokens);
	return {containerStyle, layout, mocId, virtual};
}

function serializeStyleTokens(style: ColumnStyleData | undefined): string[] {
	const tokens: string[] = [];
	if (style?.background) tokens.push(`b:${style.background}`);
	if (style?.borderColor) tokens.push(`bc:${style.borderColor}`);
	if (style?.textColor) tokens.push(`t:${style.textColor}`);
	if (style?.showBorder !== undefined) tokens.push(`sb:${style.showBorder ? "1" : "0"}`);
	if (style?.horizontalDividers !== undefined) {
		tokens.push(`hd:${style.horizontalDividers ? "1" : "0"}`);
	}
	if (style?.separator !== undefined) tokens.push(`sep:${style.separator ? "1" : "0"}`);
	if (style?.separatorColor) tokens.push(`sc:${style.separatorColor}`);
	if (style?.separatorStyle) tokens.push(`ss:${style.separatorStyle}`);
	if (style?.separatorWidth !== undefined) tokens.push(`sw:${style.separatorWidth}`);
	if (style?.separatorCustomChar) tokens.push(`sx:${style.separatorCustomChar}`);
	if (style?.leftBorder !== undefined) tokens.push(`lb:${style.leftBorder ? "1" : "0"}`);
	if (style?.preset) tokens.push(`preset:${style.preset}`);
	if (style?.maxHeight !== undefined) tokens.push(`mh:${style.maxHeight}`);
	if (style?.fold !== undefined) tokens.push(`fold:${style.fold ? "1" : "0"}`);
	return tokens;
}

function serializeBreakPayload(column: ColumnData): string {
	const tokens: string[] = [];
	if (column.widthPercent > 0) {
		tokens.push(String(Math.round(column.widthPercent)));
	}
	if (column.stacked && column.stacked > 0) {
		tokens.push(`stk:${column.stacked}`);
	}
	tokens.push(...serializeStyleTokens(column.style));
	return tokens.length > 0 ? `:${tokens.join(",")}` : "";
}

function serializeStartPayload(
	style: ColumnStyleData | undefined,
	layout?: ColumnLayout,
	mocId?: string,
	virtual?: boolean,
): string {
	const tokens: string[] = [];
	if (mocId) tokens.push(`moc:${mocId}`);
	if (virtual) tokens.push("v:1");
	if (layout && layout !== "row") tokens.push(`l:${layout}`);
	tokens.push(...serializeStyleTokens(style));
	return tokens.length > 0 ? `:${tokens.join(",")}` : "";
}

// ── Code / math / HTML exclusion for string-based parsing ─────────────
//
// Live preview hands the parser a Lezer predicate (see core/lezer-guard), but
// reading view, nested column content and unit tests only have a string. This
// scanner reproduces the blocks that can contain a marker-like line:
// frontmatter, fenced code, block math, HTML blocks and HTML comments.
// Indented code is deliberately left alone: users indent markers inside
// list items, and those have always worked.

const FRONTMATTER_RE = /^---\s*$/;
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;
const BLOCK_MATH_RE = /^\s*\$\$\s*$/;
const HTML_BLOCK_RE = /^ {0,3}<(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:\s|>|$)/i;
const HTML_RAW_RE = /^ {0,3}<(?:script|pre|style|textarea)(?:\s|>|$)/i;
const HTML_CLOSE_RE = /^ {0,3}<\/(?:script|pre|style|textarea)\s*>/i;

function computeTextIgnoredRanges(doc: string): SourceRange[] {
	const ranges: SourceRange[] = [];
	const lines = doc.split("\n");
	let offset = 0;

	let frontmatterStart = -1;
	let fence: {char: string; length: number; start: number} | null = null;
	let mathStart = -1;
	let htmlStart = -1;
	let htmlRaw = false;
	let htmlTag = "";
	let htmlCloseAt = -1;
	let commentStart = -1;

	const push = (from: number, to: number): void => {
		if (to > from) ranges.push({from, to});
	};

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]!;
		const trimmed = line.trim();
		const lineStart = offset;
		const lineEnd = offset + line.length;

		if (i === 0 && FRONTMATTER_RE.test(trimmed)) {
			frontmatterStart = 0;
			offset += line.length + 1;
			continue;
		}
		if (frontmatterStart >= 0) {
			if (FRONTMATTER_RE.test(trimmed)) {
				push(frontmatterStart, lineEnd);
				frontmatterStart = -1;
			}
			offset += line.length + 1;
			continue;
		}

		if (commentStart >= 0) {
			if (line.includes("-->")) {
				push(commentStart, lineEnd);
				commentStart = -1;
			}
			offset += line.length + 1;
			continue;
		}

		if (fence) {
			// Closing fence: at least as long as the opener, same character,
			// with only spaces after it. A line like "```not-a-close" is still
			// inside the block.
			const closeRe = new RegExp(`^ {0,3}${fence.char}{${fence.length},}\\s*$`);
			if (closeRe.test(line)) {
				push(fence.start, lineEnd);
				fence = null;
			}
			offset += line.length + 1;
			continue;
		}

		if (mathStart >= 0) {
			if (BLOCK_MATH_RE.test(trimmed)) {
				push(mathStart, lineEnd);
				mathStart = -1;
			}
			offset += line.length + 1;
			continue;
		}

		if (htmlStart >= 0) {
			if (htmlRaw) {
				if (HTML_CLOSE_RE.test(line)) {
					push(htmlStart, lineEnd);
					htmlStart = -1;
					htmlRaw = false;
				}
			} else if (htmlCloseAt >= 0) {
				// A matching closing tag exists: blank lines inside the element
				// are content, not the end of the HTML block. This is what keeps
				// `<div>`/`<center>` blocks with blank lines from leaking their
				// inner markers into the note.
				if (lineEnd >= htmlCloseAt) {
					push(htmlStart, lineEnd);
					htmlStart = -1;
					htmlTag = "";
					htmlCloseAt = -1;
				}
			} else if (trimmed === "") {
				// Unclosed HTML block: CommonMark type 6 ends before the blank line.
				push(htmlStart, lineStart);
				htmlStart = -1;
				htmlTag = "";
			}
			offset += line.length + 1;
			continue;
		}

		if (line.includes("<!--") && !line.includes("-->", line.indexOf("<!--") + 2)) {
			commentStart = lineStart;
			offset += line.length + 1;
			continue;
		}

		const fenceMatch = line.match(FENCE_RE);
		if (fenceMatch) {
			const marker = fenceMatch[1]!;
			fence = {char: marker[0]!, length: marker.length, start: lineStart};
			offset += line.length + 1;
			continue;
		}

		if (BLOCK_MATH_RE.test(trimmed)) {
			mathStart = lineStart;
			offset += line.length + 1;
			continue;
		}

		if (HTML_RAW_RE.test(trimmed)) {
			htmlStart = lineStart;
			htmlRaw = true;
		} else if (HTML_BLOCK_RE.test(trimmed)) {
			htmlStart = lineStart;
			htmlRaw = false;
			htmlTag = trimmed.match(/^ {0,3}<\/?([a-z0-9-]+)/i)?.[1]?.toLowerCase() ?? "";
			htmlCloseAt = htmlTag
				? doc.toLowerCase().indexOf(`</${htmlTag}`, lineEnd)
				: -1;
		}

		offset += line.length + 1;
	}

	// Unterminated blocks swallow the rest of the note, as they do in renderers.
	if (frontmatterStart >= 0) push(frontmatterStart, doc.length);
	if (fence) push(fence.start, doc.length);
	if (mathStart >= 0) push(mathStart, doc.length);
	if (htmlStart >= 0) push(htmlStart, doc.length);
	if (commentStart >= 0) push(commentStart, doc.length);
	return ranges;
}

function rangeContains(ranges: ReadonlyArray<SourceRange>, pos: number): boolean {
	for (const range of ranges) {
		if (pos >= range.from && pos <= range.to) return true;
	}
	return false;
}

interface AccumulatedColumn {
	lines: string[];
	width: number;
	style?: ColumnStyleData;
	stacked?: number;
	lineStart: number;
	contentStart: number;
	contentEnd: number;
}

/**
 * Trimmed character range of one column's content. `rawStart` is the first
 * line start after its col-break marker; `rawEnd` is the end of its last
 * content line. For an empty column both are the same insertion point.
 */
function columnContentRange(
	rawStart: number,
	rawEnd: number,
	rawText: string,
): [number, number] {
	if (rawText.trim().length === 0 || rawEnd <= rawStart) return [rawStart, rawStart];
	const leading = rawText.length - rawText.trimStart().length;
	const trailing = rawText.length - rawText.trimEnd().length;
	const from = rawStart + leading;
	const to = Math.max(from, rawEnd - trailing);
	return [from, to];
}

/**
 * Find all column regions in a document string.
 *
 * Syntax:
 *   %% col-start %%
 *   %% col-break %%       <- starts column 1
 *   content...
 *   %% col-break %%       <- starts column 2
 *   content...
 *   %% col-end %%
 *
 * Content between col-start and the FIRST col-break is ignored.
 * Marker lines inside fenced code, block math, raw HTML or frontmatter are
 * ignored. Live preview additionally passes a `syntaxTree` predicate so
 * inline code and every Lezer code node are excluded too.
 */
export function findColumnRegions(
	doc: string,
	options: FindColumnRegionsOptions = {},
): ColumnRegion[] {
	const regions: ColumnRegion[] = [];
	const lines = doc.split("\n");
	const ignoredRanges = !options.isIgnoredPosition && options.ignoreCode !== false
		? computeTextIgnoredRanges(doc)
		: [];
	const isIgnoredPosition = options.isIgnoredPosition;
	const isIgnored = (pos: number): boolean =>
		isIgnoredPosition ? isIgnoredPosition(pos) : rangeContains(ignoredRanges, pos);

	let offset = 0;
	let inRegion = false;
	let regionStartOffset = -1;
	let regionStartLine = -1;
	let seenFirstBreak = false;
	let columns: AccumulatedColumn[] = [];
	let curLines: string[] = [];
	let curWidth = 0;
	let curStyle: ColumnStyleData | undefined;
	let curStacked: number | undefined;
	let curLineStart = -1;
	let curContentStart = -1;
	let curContentEnd = -1;
	let nestedDepth = 0;
	let containerStyle: ColumnStyleData | undefined;
	let regionLayout: ColumnLayout | undefined;
	let regionMocId: string | undefined;
	let regionVirtual = false;

	const pushLine = (line: string, lineStart: number, lineLength: number): void => {
		curLines.push(line);
		curContentEnd = lineStart + lineLength;
	};

	const pushColumn = (): void => {
		columns.push({
			lines: curLines,
			width: curWidth,
			style: curStyle,
			stacked: curStacked,
			lineStart: curLineStart,
			contentStart: curContentStart,
			contentEnd: curContentEnd,
		});
	};

	const resetRegion = (): void => {
		inRegion = false;
		seenFirstBreak = false;
		columns = [];
		curLines = [];
		curWidth = 0;
		curStyle = undefined;
		curStacked = undefined;
		curLineStart = -1;
		curContentStart = -1;
		curContentEnd = -1;
		nestedDepth = 0;
		containerStyle = undefined;
		regionLayout = undefined;
		regionMocId = undefined;
		regionVirtual = false;
	};

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]!;
		const trimmed = line.trim();
		const lineStart = offset;
		const ignored = isIgnored(lineStart);

		if (!inRegion) {
			const startMatch = ignored ? null : trimmed.match(START_RE);
			if (startMatch) {
				inRegion = true;
				regionStartOffset = lineStart;
				regionStartLine = i;
				seenFirstBreak = false;
				columns = [];
				curLines = [];
				curWidth = 0;
				curStyle = undefined;
				curStacked = undefined;
				curLineStart = -1;
				curContentStart = -1;
				curContentEnd = -1;
				nestedDepth = 0;
				const startParsed = parseStartPayload(startMatch[1]);
				containerStyle = startParsed.containerStyle;
				regionLayout = startParsed.layout;
				regionMocId = startParsed.mocId;
				// `v:1` only means "virtual MOC" when a template is named;
				// an unrelated legacy token must not turn a normal block into
				// a link-free marker on the next edit.
				regionVirtual = startParsed.virtual === true && !!startParsed.mocId;
			}
		} else if (ignored) {
			// A marker-looking line inside code is ordinary content.
			if (seenFirstBreak) pushLine(line, lineStart, line.length);
		} else if (seenFirstBreak && START_RE.test(trimmed)) {
			// Nested blocks inside a column stay as column content and must
			// not be treated as top-level breaks/ends.
			nestedDepth += 1;
			pushLine(line, lineStart, line.length);
		} else if (seenFirstBreak && END_RE.test(trimmed) && nestedDepth > 0) {
			nestedDepth -= 1;
			pushLine(line, lineStart, line.length);
		} else {
			const breakMatch = nestedDepth === 0 ? trimmed.match(BREAK_RE) : null;
			if (breakMatch) {
				if (seenFirstBreak) pushColumn();
				seenFirstBreak = true;
				curLines = [];
				const parsedBreak = parseBreakPayload(breakMatch[1]);
				curWidth = parsedBreak.width;
				curStyle = parsedBreak.style;
				curStacked = parsedBreak.stacked;
				curLineStart = i + 1;
				curContentStart = lineStart + line.length + 1;
				curContentEnd = curContentStart;
			} else if (END_RE.test(trimmed) && nestedDepth === 0) {
				if (seenFirstBreak) pushColumn();

				if (columns.length > 0 || (regionVirtual && regionMocId)) {
					// Clamp total widths: if sum > 100%, reset all to equal
					const totalWidth = columns.reduce((sum, c) => sum + c.width, 0);
					const clampedColumns = totalWidth > 100
						? columns.map((c) => ({...c, width: 0}))
						: columns;

					const columnLineRanges: [number, number][] = clampedColumns.map((column) => {
						const start = column.lineStart;
						const end = start + column.lines.length - 1;
						return [start, Math.max(start, end)];
					});
					const columnContentRanges: [number, number][] = clampedColumns.map((column) =>
						columnContentRange(
							column.contentStart,
							column.contentEnd,
							column.lines.join("\n"),
						),
					);

					regions.push({
						from: regionStartOffset,
						to: lineStart + line.length,
						columns: clampedColumns.map((column) => ({
							content: column.lines.join("\n").trim(),
							widthPercent: column.width,
							style: column.style,
							...(column.stacked && column.stacked > 0 ? {stacked: column.stacked} : {}),
						})),
						containerStyle,
						layout: regionLayout,
						...(regionMocId ? {mocId: regionMocId} : {}),
						...(regionVirtual ? {virtual: true} : {}),
						lineStart: regionStartLine,
						lineEnd: i,
						columnLineRanges,
						columnContentRanges,
					});
				}

				resetRegion();
			} else if (seenFirstBreak) {
				pushLine(line, lineStart, line.length);
			}
		}

		offset += line.length + 1;
	}

	return regions;
}

/**
 * Serialize columns back to the marker format.
 */
export function serializeColumns(
	columns: ReadonlyArray<ColumnData>,
	containerStyle?: ColumnStyleData,
	layout?: ColumnLayout,
	mocId?: string,
	virtual?: boolean,
): string {
	if (virtual) return serializeVirtualMocMarker(mocId, containerStyle, layout);
	const parts: string[] = [`%% col-start${serializeStartPayload(containerStyle, layout, mocId)} %%`];
	for (const col of columns) {
		parts.push(`%% col-break${serializeBreakPayload(col)} %%`);
		if (col.content.trim().length > 0) {
			parts.push(col.content);
		}
	}
	parts.push("%% col-end %%");
	// Blank lines keep Obsidian comments out of adjacent HTML blocks and make
	// every rewritten marker a standalone Markdown block in Reading View.
	return parts.join("\n\n");
}

/**
 * Compact, link-free marker for a virtual MOC. The note stores only this;
 * matching links are resolved in memory at render time (`v:1`).
 */
export function serializeVirtualMocMarker(
	mocId: string | undefined,
	containerStyle?: ColumnStyleData,
	layout?: ColumnLayout,
): string {
	const payload = serializeStartPayload(containerStyle, layout, mocId, true);
	return [`%% col-start${payload} %%`, MARKER_END].join("\n\n");
}

const MARKER_END = "%% col-end %%";
