// Every palette entry is a CSS variable with the built-in value as fallback,
// so themes and snippets can recolor the palette, e.g.
// `body { --amc-bg-red-soft: #f3d6d6; --amc-color-red: #c24; }`.
export const BACKGROUND_CSS = {
	transparent: "var(--amc-bg-transparent, transparent)",
	primary: "var(--amc-bg-primary, var(--background-primary))",
	secondary: "var(--amc-bg-secondary, var(--background-secondary))",
	alt: "var(--amc-bg-alt, var(--background-primary-alt))",
	"accent-soft": "var(--amc-bg-accent-soft, color-mix(in srgb, var(--interactive-accent) 14%, transparent))",
	"red-soft": "var(--amc-bg-red-soft, rgba(239, 68, 68, 0.14))",
	"orange-soft": "var(--amc-bg-orange-soft, rgba(245, 158, 11, 0.14))",
	"yellow-soft": "var(--amc-bg-yellow-soft, rgba(234, 179, 8, 0.14))",
	"green-soft": "var(--amc-bg-green-soft, rgba(34, 197, 94, 0.14))",
	"cyan-soft": "var(--amc-bg-cyan-soft, rgba(6, 182, 212, 0.14))",
	"blue-soft": "var(--amc-bg-blue-soft, rgba(59, 130, 246, 0.14))",
	"pink-soft": "var(--amc-bg-pink-soft, rgba(236, 72, 153, 0.14))",
} as const;

/** Solid/opaque colors that correspond to each soft background – used for
 *  the left-border accent stripe so it reads like an Obsidian callout. */
export const HEADER_BORDER_CSS: Record<string, string> = {
	"accent-soft": "var(--amc-stripe-accent-soft, var(--interactive-accent))",
	"red-soft": "var(--amc-stripe-red-soft, #ef4444)",
	"orange-soft": "var(--amc-stripe-orange-soft, #f59e0b)",
	"yellow-soft": "var(--amc-stripe-yellow-soft, #eab308)",
	"green-soft": "var(--amc-stripe-green-soft, #22c55e)",
	"cyan-soft": "var(--amc-stripe-cyan-soft, #06b6d4)",
	"blue-soft": "var(--amc-stripe-blue-soft, #3b82f6)",
	"pink-soft": "var(--amc-stripe-pink-soft, #ec4899)",
	secondary: "var(--amc-stripe-secondary, var(--background-modifier-border))",
	alt: "var(--amc-stripe-alt, var(--background-modifier-border))",
	primary: "var(--amc-stripe-primary, var(--background-modifier-border))",
};

export const COLOR_CSS = {
	gray: "var(--amc-color-gray, var(--background-modifier-border))",
	accent: "var(--amc-color-accent, var(--interactive-accent))",
	muted: "var(--amc-color-muted, var(--text-muted))",
	text: "var(--amc-color-text, var(--text-normal))",
	secondary: "var(--amc-color-secondary, var(--background-secondary))",
	red: "var(--amc-color-red, #ef4444)",
	orange: "var(--amc-color-orange, #f59e0b)",
	yellow: "var(--amc-color-yellow, #eab308)",
	green: "var(--amc-color-green, #22c55e)",
	cyan: "var(--amc-color-cyan, #06b6d4)",
	blue: "var(--amc-color-blue, #3b82f6)",
	pink: "var(--amc-color-pink, #ec4899)",
} as const;

type ColumnBackgroundOption = keyof typeof BACKGROUND_CSS;
type StyleColorOption = keyof typeof COLOR_CSS;

type SeparatorLineStyle = "solid" | "dashed" | "dotted" | "double" | "custom";

const SEPARATOR_STYLE_VALUES = new Set<string>(["solid", "dashed", "dotted", "double", "custom"]);

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
};

const COLUMN_STYLE_VAR_KEYS = [
	"--columns-col-bg",
	"--columns-col-text",
	"--columns-col-border-color",
	"--columns-col-border-width",
	"--columns-col-horizontal-width",
	"--columns-col-sep-color",
	"--columns-col-sep-width",
	"--columns-col-sep-style",
] as const;

const CONTAINER_STYLE_VAR_KEYS = [
	"--columns-block-bg",
	"--columns-block-text",
	"--columns-block-border-color",
	"--columns-block-border-width",
	"--columns-block-horizontal-width",
] as const;

function hasOwnKey<T extends object>(obj: T, key: PropertyKey): key is keyof T {
	return Object.prototype.hasOwnProperty.call(obj, key);
}

function toStyleData(style: unknown): ColumnStyleData | null {
	if (typeof style !== "object" || style === null) return null;

	const record = style as Record<string, unknown>;
	const parsed: ColumnStyleData = {};

	const background = record.background;
	if (typeof background === "string" && hasOwnKey(BACKGROUND_CSS, background)) {
		parsed.background = background;
	}

	const borderColor = record.borderColor;
	if (typeof borderColor === "string" && hasOwnKey(COLOR_CSS, borderColor)) {
		parsed.borderColor = borderColor;
	}

	const textColor = record.textColor;
	if (typeof textColor === "string" && hasOwnKey(COLOR_CSS, textColor)) {
		parsed.textColor = textColor;
	}

	if (typeof record.showBorder === "boolean") {
		parsed.showBorder = record.showBorder;
	}

	if (typeof record.horizontalDividers === "boolean") {
		parsed.horizontalDividers = record.horizontalDividers;
	}

	if (typeof record.separator === "boolean") {
		parsed.separator = record.separator;
	}

	const separatorColor = record.separatorColor;
	if (typeof separatorColor === "string" && hasOwnKey(COLOR_CSS, separatorColor)) {
		parsed.separatorColor = separatorColor;
	}

	const separatorStyle = record.separatorStyle;
	if (typeof separatorStyle === "string" && SEPARATOR_STYLE_VALUES.has(separatorStyle)) {
		parsed.separatorStyle = separatorStyle as SeparatorLineStyle;
	}

	const separatorWidth = record.separatorWidth;
	if (typeof separatorWidth === "number" && separatorWidth >= 1 && separatorWidth <= 8) {
		parsed.separatorWidth = separatorWidth;
	}

	const separatorCustomChar = record.separatorCustomChar;
	if (typeof separatorCustomChar === "string" && separatorCustomChar.length > 0 && separatorCustomChar.length <= 3) {
		parsed.separatorCustomChar = separatorCustomChar;
	}

	if (typeof record.leftBorder === "boolean") {
		parsed.leftBorder = record.leftBorder;
	}

	return Object.keys(parsed).length > 0 ? parsed : null;
}

export function hasColumnStyle(style: unknown): boolean {
	return toStyleData(style) !== null;
}

function buildColumnCssProps(parsed: ColumnStyleData): Record<string, string> {
	const cssProps: Record<string, string> = {};

	if (parsed.background) {
		cssProps["--columns-col-bg"] = BACKGROUND_CSS[parsed.background];
	}
	if (parsed.textColor) {
		cssProps["--columns-col-text"] = COLOR_CSS[parsed.textColor];
	}

	const hasBorderSignals =
		parsed.showBorder !== undefined ||
		parsed.horizontalDividers !== undefined ||
		parsed.borderColor !== undefined;

	if (hasBorderSignals) {
		const effectiveBorderColor = COLOR_CSS[parsed.borderColor ?? "gray"];
		const showBorder = parsed.showBorder ?? parsed.borderColor !== undefined;
		const showHorizontal = parsed.horizontalDividers ?? false;

		cssProps["--columns-col-border-color"] = effectiveBorderColor;
		cssProps["--columns-col-border-width"] = showBorder ? "1px" : "0px";
		if (showHorizontal) cssProps["--columns-col-horizontal-width"] = "1px";
	}

	if (parsed.separator) {
		cssProps["--columns-col-sep-color"] = COLOR_CSS[parsed.separatorColor ?? "gray"];
		cssProps["--columns-col-sep-width"] = `${parsed.separatorWidth ?? 1}px`;
		if (parsed.separatorStyle && parsed.separatorStyle !== "custom") {
			cssProps["--columns-col-sep-style"] = parsed.separatorStyle;
		}
	}

	return cssProps;
}

function buildContainerCssProps(parsed: ColumnStyleData): Record<string, string> {
	const cssProps: Record<string, string> = {};

	if (parsed.background) {
		cssProps["--columns-block-bg"] = BACKGROUND_CSS[parsed.background];
	}
	if (parsed.textColor) {
		cssProps["--columns-block-text"] = COLOR_CSS[parsed.textColor];
	}

	// Unset color/width fall back to the global Appearance settings.
	if (parsed.borderColor) {
		cssProps["--columns-block-border-color"] = COLOR_CSS[parsed.borderColor];
	}
	const showBorder = parsed.showBorder ?? (parsed.borderColor !== undefined ? true : undefined);
	if (showBorder !== undefined) {
		cssProps["--columns-block-border-width"] = showBorder
			? "max(1px, var(--amc-container-border-width, 1px))"
			: "0px";
	}
	if (parsed.horizontalDividers) cssProps["--columns-block-horizontal-width"] = "1px";

	return cssProps;
}

function applyStyleVars(
	element: HTMLElement,
	style: unknown,
	varKeysToClear: ReadonlyArray<string>,
	cssBuilder: (parsed: ColumnStyleData) => Record<string, string>,
): void {
	const clearProps: Record<string, string> = {};
	for (const key of varKeysToClear) clearProps[key] = "";
	element.setCssProps(clearProps);

	const parsed = toStyleData(style);
	if (!parsed) {
		element.removeClass("columns-custom-style");
		return;
	}

	element.addClass("columns-custom-style");
	element.setCssProps(cssBuilder(parsed));
}

export function applyColumnStyle(element: HTMLElement, style: unknown): void {
	applyStyleVars(element, style, COLUMN_STYLE_VAR_KEYS, buildColumnCssProps);
	const parsed = toStyleData(style);
	element.classList.toggle("columns-left-border", !!parsed?.leftBorder);
}

export function applyContainerStyle(element: HTMLElement, style: unknown): void {
	applyStyleVars(
		element,
		style,
		CONTAINER_STYLE_VAR_KEYS,
		buildContainerCssProps,
	);
}
