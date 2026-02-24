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

type ColumnStyleData = {
	background?: ColumnBackgroundOption;
	borderColor?: StyleColorOption;
	textColor?: StyleColorOption;
	showBorder?: boolean;
	horizontalDividers?: boolean;
};

type ColumnData = {
	content: string;
	widthPercent: number;
	style?: ColumnStyleData;
};

type ColumnRegion = {
	from: number;
	to: number;
	columns: ColumnData[];
	containerStyle?: ColumnStyleData;
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
		}
	}
	return style && Object.keys(style).length > 0 ? style : undefined;
}

function parseBreakPayload(payload: string | undefined): {
	width: number;
	style?: ColumnStyleData;
} {
	if (!payload) return {width: 0};
	const tokens = payload
		.split(",")
		.map((token) => token.trim())
		.filter((token) => token.length > 0);
	if (tokens.length === 0) return {width: 0};

	let width = 0;
	let firstTokenHandled = false;
	const styleTokens: string[] = [];

	for (const token of tokens) {
		if (!firstTokenHandled) {
			firstTokenHandled = true;
			if (/^\d+$/.test(token)) {
				width = parseInt(token, 10);
				continue;
			}
			if (token.startsWith("w:")) {
				const maybeWidth = parseInt(token.slice(2), 10);
				if (Number.isFinite(maybeWidth) && maybeWidth > 0) {
					width = maybeWidth;
					continue;
				}
			}
		}
		styleTokens.push(token);
	}

	const style = parseStyleTokens(styleTokens);
	if (!style) return {width};
	return {width, style};
}

function parseStartPayload(payload: string | undefined): ColumnStyleData | undefined {
	if (!payload) return undefined;
	const tokens = payload
		.split(",")
		.map((token) => token.trim())
		.filter((token) => token.length > 0);
	if (tokens.length === 0) return undefined;
	return parseStyleTokens(tokens);
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
	return tokens;
}

function serializeBreakPayload(column: ColumnData): string {
	const tokens: string[] = [];
	if (column.widthPercent > 0) {
		tokens.push(String(Math.round(column.widthPercent)));
	}
	tokens.push(...serializeStyleTokens(column.style));
	return tokens.length > 0 ? `:${tokens.join(",")}` : "";
}

function serializeStartPayload(style: ColumnStyleData | undefined): string {
	const tokens = serializeStyleTokens(style);
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
	let columns: {lines: string[]; width: number; style?: ColumnStyleData; lineStart: number}[] = [];
	let curLines: string[] = [];
	let curWidth = 0;
	let curStyle: ColumnStyleData | undefined;
	let curLineStart = -1;
	let nestedDepth = 0;
	let containerStyle: ColumnStyleData | undefined;

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
				containerStyle = parseStartPayload(startMatch[1]);
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
							lineStart: curLineStart,
						});
					}
					seenFirstBreak = true;
					curLines = [];
					const parsedBreak = parseBreakPayload(breakMatch[1]);
					curWidth = parsedBreak.width;
					curStyle = parsedBreak.style;
					curLineStart = i + 1; // content starts on the next line
				} else if (END_RE.test(trimmed) && nestedDepth === 0) {
					if (seenFirstBreak) {
						columns.push({
							lines: curLines,
							width: curWidth,
							style: curStyle,
							lineStart: curLineStart,
						});
					}

					if (columns.length > 0) {
						const columnLineRanges: [number, number][] = columns.map((column) => {
							const start = column.lineStart;
							const end = start + column.lines.length - 1;
							return [start, Math.max(start, end)];
						});

						regions.push({
							from: regionStartOffset,
							to: offset + line.length,
							columns: columns.map((column) => ({
								content: column.lines.join("\n").trim(),
								widthPercent: column.width,
								style: column.style,
							})),
							containerStyle,
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
					nestedDepth = 0;
					containerStyle = undefined;
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
): string {
	const parts: string[] = [`%% col-start${serializeStartPayload(containerStyle)} %%`];
	for (const col of columns) {
		parts.push(`%% col-break${serializeBreakPayload(col)} %%`);
		parts.push(col.content);
	}
	parts.push("%% col-end %%");
	return parts.join("\n");
}
