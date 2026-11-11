/**
 * Named style presets, written as `preset:<name>` in a column marker:
 *
 *   %% col-start:preset:apple-bento %%
 *   %% col-break:50,preset:soft-mint %%
 *
 * A preset only supplies the CSS custom properties a column or container
 * already reads (`--columns-col-*` / `--columns-block-*`). Explicit tokens in
 * the same marker are applied as inline properties afterwards and therefore
 * still win, so `preset:soft-blue,b:transparent` means "soft blue, but no
 * background".
 *
 * The visual definitions live in styles/apple.css; this module is intentionally
 * dependency-free so the parser and the popover can share it.
 */

export const COLUMN_PRESET_IDS = [
	"apple-card",
	"apple-bento",
	"glass-panel",
	"soft-blue",
	"soft-mint",
	"soft-amber",
	"soft-rose",
	"soft-purple",
	"minimal-flush",
] as const;

export type ColumnPreset = (typeof COLUMN_PRESET_IDS)[number];

export type PresetScope = "column" | "container" | "both";

export interface ColumnPresetInfo {
	id: ColumnPreset;
	label: string;
	description: string;
	scope: PresetScope;
	/** CSS class added to the rendered column/container. */
	className: string;
}

export const COLUMN_PRESETS: ReadonlyArray<ColumnPresetInfo> = [
	{
		id: "apple-card",
		label: "Apple Card",
		description: "Pure white card, hairline border, soft shadow and a 12px radius.",
		scope: "both",
		className: "amc-preset-apple-card",
	},
	{
		id: "apple-bento",
		label: "Apple Bento",
		description: "Warm alabaster canvas with elevated inner cards.",
		scope: "both",
		className: "amc-preset-apple-bento",
	},
	{
		id: "glass-panel",
		label: "Glass Panel",
		description: "Frosted translucent surface with a specular hairline border.",
		scope: "both",
		className: "amc-preset-glass-panel",
	},
	{
		id: "soft-blue",
		label: "Soft Blue",
		description: "Apple HIG pastel blue callout card.",
		scope: "both",
		className: "amc-preset-soft-blue",
	},
	{
		id: "soft-mint",
		label: "Soft Mint",
		description: "Apple HIG pastel mint callout card.",
		scope: "both",
		className: "amc-preset-soft-mint",
	},
	{
		id: "soft-amber",
		label: "Soft Amber",
		description: "Apple HIG pastel amber callout card.",
		scope: "both",
		className: "amc-preset-soft-amber",
	},
	{
		id: "soft-rose",
		label: "Soft Rose",
		description: "Apple HIG pastel rose callout card.",
		scope: "both",
		className: "amc-preset-soft-rose",
	},
	{
		id: "soft-purple",
		label: "Soft Purple",
		description: "Apple HIG pastel purple callout card.",
		scope: "both",
		className: "amc-preset-soft-purple",
	},
	{
		id: "minimal-flush",
		label: "Minimal Flush",
		description: "Borderless, transparent columns; only the hairline divider remains.",
		scope: "both",
		className: "amc-preset-minimal-flush",
	},
];

const PRESET_BY_ID = new Map<string, ColumnPresetInfo>(
	COLUMN_PRESETS.map((preset) => [preset.id, preset]),
);

/** Friendly aliases accepted in markers but never written back. */
const PRESET_ALIASES: Readonly<Record<string, ColumnPreset>> = {
	card: "apple-card",
	bento: "apple-bento",
	glass: "glass-panel",
	"mint-card": "soft-mint",
	"blue-card": "soft-blue",
	"amber-card": "soft-amber",
	"rose-card": "soft-rose",
	"purple-card": "soft-purple",
	"minimal": "minimal-flush",
};

export function isColumnPreset(value: string): value is ColumnPreset {
	return PRESET_BY_ID.has(value);
}

/** Canonical preset for a marker value (`mint-card` → `soft-mint`). */
export function normalizePreset(value: string): ColumnPreset | undefined {
	if (isColumnPreset(value)) return value;
	return PRESET_ALIASES[value];
}

export function columnPresetInfo(preset: ColumnPreset | undefined): ColumnPresetInfo | undefined {
	return preset ? PRESET_BY_ID.get(preset) : undefined;
}

/** Class to add for a parsed preset, or "" when unset/unknown. */
export function columnPresetClass(preset: string | undefined): string {
	if (!preset || !isColumnPreset(preset)) return "";
	return PRESET_BY_ID.get(preset)!.className;
}

/** Options for the style popover's preset dropdown. */
export function presetOptions(scope: "column" | "container"): ReadonlyArray<{value: string; label: string}> {
	return [
		{value: "", label: "None"},
		...COLUMN_PRESETS.filter((preset) => preset.scope === "both" || preset.scope === scope)
			.map((preset) => ({value: preset.id, label: preset.label})),
	];
}
