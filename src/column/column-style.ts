const BACKGROUND_CSS = {
	transparent: "transparent",
	primary: "var(--background-primary)",
	secondary: "var(--background-secondary)",
	alt: "var(--background-primary-alt)",
	"accent-soft": "color-mix(in srgb, var(--interactive-accent) 14%, transparent)",
	"red-soft": "rgba(239, 68, 68, 0.14)",
	"orange-soft": "rgba(245, 158, 11, 0.14)",
	"yellow-soft": "rgba(234, 179, 8, 0.14)",
	"green-soft": "rgba(34, 197, 94, 0.14)",
	"cyan-soft": "rgba(6, 182, 212, 0.14)",
	"blue-soft": "rgba(59, 130, 246, 0.14)",
	"pink-soft": "rgba(236, 72, 153, 0.14)",
} as const;

const COLOR_CSS = {
	gray: "var(--background-modifier-border)",
	accent: "var(--interactive-accent)",
	muted: "var(--text-muted)",
	text: "var(--text-normal)",
	red: "#ef4444",
	orange: "#f59e0b",
	yellow: "#eab308",
	green: "#22c55e",
	cyan: "#06b6d4",
	blue: "#3b82f6",
	pink: "#ec4899",
} as const;

type ColumnBackgroundOption = keyof typeof BACKGROUND_CSS;
type StyleColorOption = keyof typeof COLOR_CSS;

type ColumnStyleData = {
	background?: ColumnBackgroundOption;
	borderColor?: StyleColorOption;
	textColor?: StyleColorOption;
	showBorder?: boolean;
	horizontalDividers?: boolean;
};

const COLUMN_STYLE_VAR_KEYS = [
	"--columns-col-bg",
	"--columns-col-text",
	"--columns-col-border-color",
	"--columns-col-border-width",
	"--columns-col-horizontal-width",
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

	const hasBorderSignals =
		parsed.showBorder !== undefined ||
		parsed.horizontalDividers !== undefined ||
		parsed.borderColor !== undefined;

	if (hasBorderSignals) {
		const effectiveBorderColor = COLOR_CSS[parsed.borderColor ?? "gray"];
		const showBorder = parsed.showBorder ?? parsed.borderColor !== undefined;
		const showHorizontal = parsed.horizontalDividers ?? false;

		cssProps["--columns-block-border-color"] = effectiveBorderColor;
		cssProps["--columns-block-border-width"] = showBorder ? "1px" : "0px";
		if (showHorizontal) cssProps["--columns-block-horizontal-width"] = "1px";
	}

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
}

export function applyContainerStyle(element: HTMLElement, style: unknown): void {
	applyStyleVars(
		element,
		style,
		CONTAINER_STYLE_VAR_KEYS,
		buildContainerCssProps,
	);
}
