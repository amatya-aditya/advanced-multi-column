import {createMocTemplate, MocTemplate} from "./moc/types";

export type StyleTargetMode = "all" | "specific";
export type ColumnBackgroundOption =
	| "transparent"
	| "primary"
	| "secondary"
	| "alt"
	| "accent-soft"
	| "red-soft"
	| "orange-soft"
	| "yellow-soft"
	| "green-soft"
	| "cyan-soft"
	| "blue-soft"
	| "pink-soft";
export type DividerLineStyle = "solid" | "dashed" | "dotted" | "double";
export type StyleColorOption =
	| "gray"
	| "accent"
	| "muted"
	| "text"
	| "secondary"
	| "red"
	| "orange"
	| "yellow"
	| "green"
	| "cyan"
	| "blue"
	| "pink";

export interface HeaderTypeConfig {
	id: string;
	icon: string;
	background: ColumnBackgroundOption;
	textColor: StyleColorOption;
	fontSize: number;
	fontWeight: number;
}

export const BUILTIN_HEADER_IDS = new Set(["note", "info", "tip", "warning", "danger"]);

export const DEFAULT_HEADER_TYPES: HeaderTypeConfig[] = [
	{id: "note", icon: "pencil", background: "blue-soft", textColor: "blue", fontSize: 0.85, fontWeight: 600},
	{id: "info", icon: "info", background: "cyan-soft", textColor: "cyan", fontSize: 0.85, fontWeight: 600},
	{id: "tip", icon: "lightbulb", background: "green-soft", textColor: "green", fontSize: 0.85, fontWeight: 600},
	{id: "warning", icon: "triangle-alert", background: "orange-soft", textColor: "orange", fontSize: 0.85, fontWeight: 600},
	{id: "danger", icon: "zap", background: "red-soft", textColor: "red", fontSize: 0.85, fontWeight: 600},
];

export interface ColumnsPluginSettings {
	defaultColumnCount: number;
	minColumnWidthPercent: number;
	showDragHandles: boolean;
	enableLivePreview: boolean;
	enableReadingView: boolean;
	foldNotePropertiesByDefault: boolean;
	enableSlashSuggest: boolean;
	inheritStyleOnAdd: boolean;
	styleTargetMode: StyleTargetMode;
	styleTargetColumnIndex: number;
	containerBackground: ColumnBackgroundOption;
	showContainerBorder: boolean;
	containerBorderWidthPx: number;
	containerBorderColor: StyleColorOption;
	containerCornerRadiusPx: number;
	containerTextColor: StyleColorOption;
	verticalDividerWidthPx: number;
	verticalDividerStyle: DividerLineStyle;
	verticalDividerColor: StyleColorOption;
	enableHeaders: boolean;
	headerTypes: HeaderTypeConfig[];
	stackOnNarrowScreens: boolean;
	narrowBreakpointPx: number;
	/** MOC features: menus, commands, Edit MOC and automatic updates. */
	enableMoc: boolean;
	mocTemplates: MocTemplate[];
	/** Notes that contain MOC blocks (kept in sync automatically). */
	mocNotes: string[];
}

export const DEFAULT_SETTINGS: ColumnsPluginSettings = {
	defaultColumnCount: 2,
	minColumnWidthPercent: 10,
	showDragHandles: true,
	enableLivePreview: true,
	enableReadingView: true,
	foldNotePropertiesByDefault: false,
	enableSlashSuggest: true,
	inheritStyleOnAdd: true,
	styleTargetMode: "all",
	styleTargetColumnIndex: 1,
	containerBackground: "primary",
	showContainerBorder: true,
	containerBorderWidthPx: 1,
	containerBorderColor: "gray",
	containerCornerRadiusPx: 8,
	containerTextColor: "text",
	verticalDividerWidthPx: 1,
	verticalDividerStyle: "solid",
	verticalDividerColor: "gray",
	enableHeaders: true,
	headerTypes: [...DEFAULT_HEADER_TYPES],
	stackOnNarrowScreens: true,
	narrowBreakpointPx: 480,
	enableMoc: true,
	mocTemplates: [{...createMocTemplate("moc-1", "This folder")}],
	mocNotes: [],
};

// ── Option maps ──────────────────────────────────────────────────────

export const STYLE_TARGET_OPTIONS: Record<StyleTargetMode, string> = {
	all: "All columns",
	specific: "Specific column",
};

export const BACKGROUND_OPTIONS: Record<ColumnBackgroundOption, string> = {
	transparent: "Transparent",
	primary: "Primary",
	secondary: "Secondary",
	alt: "Muted",
	"accent-soft": "Accent tint",
	"red-soft": "Red tint",
	"orange-soft": "Orange tint",
	"yellow-soft": "Yellow tint",
	"green-soft": "Green tint",
	"cyan-soft": "Cyan tint",
	"blue-soft": "Blue tint",
	"pink-soft": "Pink tint",
};

export const DIVIDER_STYLE_OPTIONS: Record<DividerLineStyle, string> = {
	solid: "Solid",
	dashed: "Dashed",
	dotted: "Dotted",
	double: "Double",
};

export const STYLE_COLOR_OPTIONS: Record<StyleColorOption, string> = {
	gray: "Gray",
	accent: "Accent",
	muted: "Muted text",
	text: "Normal text",
	secondary: "Secondary",
	red: "Red",
	orange: "Orange",
	yellow: "Yellow",
	green: "Green",
	cyan: "Cyan",
	blue: "Blue",
	pink: "Pink",
};
