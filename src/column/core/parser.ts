const START_RE = /^%%\s*col-start(?:\s*:(.*?))?\s*%%$/;
const BREAK_RE = /^%%\s*col-break(?:\s*:(.*?))?\s*%%$/;
const END_RE = /^%%\s*col-end\s*%%$/;

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
	horizontalDividers?: boolean;
	separator?: boolean;
	separatorColor?: StyleColorOption;
	separatorStyle?: SeparatorLineStyle;
	separatorWidth?: number;
	separatorCustomChar?: string;
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
	lineStart: number;
	lineEnd: number;
	columnLineRanges: [number, number][];
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
} {
	if (!payload) return {};
	const tokens = payload
		.split(",")
		.map((token) => token.trim())
		.filter((token) => token.length > 0);
	if (tokens.length === 0) return {};

	let layout: ColumnLayout | undefined;
	const styleTokens: string[] = [];
	for (const token of tokens) {
		if (token.startsWith("l:")) {
			const value = token.slice(2).trim();
			if (isColumnLayout(value)) layout = value;
		} else {
			styleTokens.push(token);
		}
	}
	const containerStyle = parseStyleTokens(styleTokens);
	return {containerStyle, layout};
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

function serializeStartPayload(style: ColumnStyleData | undefined, layout?: ColumnLayout): string {
	const tokens: string[] = [];
	if (layout && layout !== "row") tokens.push(`l:${layout}`);
	tokens.push(...serializeStyleTokens(style));
	return tokens.length > 0 ? `:${tokens.join(",")}` : "";
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
 */
export function findColumnRegions(doc: string): ColumnRegion[] {
	const regions: ColumnRegion[] = [];
	const lines = doc.split("\n");
	let offset = 0;

	let inRegion = false;
	let regionStartOffset = -1;
	let regionStartLine = -1;
	let seenFirstBreak = false;
	let columns: {lines: string[]; width: number; style?: ColumnStyleData; stacked?: number; lineStart: number}[] = [];
	let curLines: string[] = [];
	let curWidth = 0;
	let curStyle: ColumnStyleData | undefined;
	let curStacked: number | undefined;
	let curLineStart = -1;
	let nestedDepth = 0;
	let containerStyle: ColumnStyleData | undefined;
	let regionLayout: ColumnLayout | undefined;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]!;
		const trimmed = line.trim();

		if (!inRegion) {
			const startMatch = trimmed.match(START_RE);
			if (startMatch) {
				inRegion = true;
				regionStartOffset = offset;
				regionStartLine = i;
				seenFirstBreak = false;
				columns = [];
				curLines = [];
				curWidth = 0;
				curStyle = undefined;
				curLineStart = -1;
				nestedDepth = 0;
				const startParsed = parseStartPayload(startMatch[1]);
				containerStyle = startParsed.containerStyle;
				regionLayout = startParsed.layout;
			}
		} else {
			// Nested blocks inside a column should stay as column content
			// and must not be treated as top-level breaks/ends.
			if (seenFirstBreak && START_RE.test(trimmed)) {
				nestedDepth += 1;
				curLines.push(line);
			} else if (seenFirstBreak && END_RE.test(trimmed) && nestedDepth > 0) {
				nestedDepth -= 1;
				curLines.push(line);
			} else {
				const breakMatch = nestedDepth === 0 ? trimmed.match(BREAK_RE) : null;
				if (breakMatch) {
					if (seenFirstBreak) {
						columns.push({
							lines: curLines,
							width: curWidth,
							style: curStyle,
							stacked: curStacked,
							lineStart: curLineStart,
						});
					}
					seenFirstBreak = true;
					curLines = [];
					const parsedBreak = parseBreakPayload(breakMatch[1]);
					curWidth = parsedBreak.width;
					curStyle = parsedBreak.style;
					curStacked = parsedBreak.stacked;
					curLineStart = i + 1; // content starts on the next line
				} else if (END_RE.test(trimmed) && nestedDepth === 0) {
					if (seenFirstBreak) {
						columns.push({
							lines: curLines,
							width: curWidth,
							style: curStyle,
							stacked: curStacked,
							lineStart: curLineStart,
						});
					}

					if (columns.length > 0) {
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

						regions.push({
							from: regionStartOffset,
							to: offset + line.length,
							columns: clampedColumns.map((column) => ({
								content: column.lines.join("\n").trim(),
								widthPercent: column.width,
								style: column.style,
								...(column.stacked && column.stacked > 0 ? {stacked: column.stacked} : {}),
							})),
							containerStyle,
							layout: regionLayout,
							lineStart: regionStartLine,
							lineEnd: i,
							columnLineRanges,
						});
					}

					inRegion = false;
					seenFirstBreak = false;
					columns = [];
					curLines = [];
					curStyle = undefined;
					curStacked = undefined;
					nestedDepth = 0;
					containerStyle = undefined;
					regionLayout = undefined;
				} else if (seenFirstBreak) {
					curLines.push(line);
				}
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
): string {
	const parts: string[] = [`%% col-start${serializeStartPayload(containerStyle, layout)} %%`];
	for (const col of columns) {
		parts.push(`%% col-break${serializeBreakPayload(col)} %%`);
		parts.push(col.content);
	}
	parts.push("%% col-end %%");
	return parts.join("\n");
}
