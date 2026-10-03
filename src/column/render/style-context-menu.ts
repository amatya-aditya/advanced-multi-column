import {setIcon} from "obsidian";
import type {ColumnBackgroundOption, StyleColorOption} from "../../settings";
import type {ColumnData, ColumnLayout, ColumnStyleData, SeparatorLineStyle} from "../core/types";
import {applyColumnStyle, applyContainerStyle} from "../core/column-style";
import {getPluginInstance} from "../core/plugin-ref";
import {getColumnElements, groupColumns} from "./column-renderer";

interface SelectOption<T extends string> {
	value: T;
	label: string;
}

type StylePatch = {
	[K in keyof ColumnStyleData]?: ColumnStyleData[K] | undefined;
};

const CLEAR_STYLE_PATCH: StylePatch = {
	background: undefined,
	borderColor: undefined,
	textColor: undefined,
	showBorder: undefined,
	leftBorder: undefined,
	horizontalDividers: undefined,
	separator: undefined,
	separatorColor: undefined,
	separatorStyle: undefined,
	separatorWidth: undefined,
	separatorCustomChar: undefined,
};

export interface ColumnContextActions {
	editColumn?: () => void;
	addColumn?: () => void;
	addChild?: () => void;
	deleteColumn?: () => void;
}

export interface ColumnStyleContextMenuData {
	columnIndex: number;
	columns: ColumnData[];
	onChange: (
		nextColumns: ColumnData[],
		nextContainerStyle: ColumnStyleData | undefined,
	) => void;
	containerStyle?: ColumnStyleData;
	layout?: ColumnLayout;
	onLayoutChange?: (nextLayout: ColumnLayout | undefined) => void;
	parentIndex?: number;
	actions?: ColumnContextActions;
	containerEl?: HTMLElement;
	selectedIndices?: Set<number>;
}

interface PopoverRenderState {
	columns: ColumnData[];
	containerStyle?: ColumnStyleData;
	layout?: ColumnLayout;
}

/**
 * Values a style field takes when it is not written in the marker. Fields
 * equal to their default are dropped, so markers stay minimal and keep
 * following the defaults (and the global Appearance settings) later.
 */
type StyleDefaults = Pick<
	Required<ColumnStyleData>,
	"background" | "borderColor" | "textColor"
> & Partial<Pick<Required<ColumnStyleData>, "separatorColor" | "separatorStyle" | "separatorWidth" | "separatorCustomChar">>;

/** How an unstyled column renders. */
const COLUMN_DEFAULTS: Required<StyleDefaults> = {
	background: "transparent",
	borderColor: "gray",
	textColor: "text",
	separatorColor: "gray",
	separatorStyle: "solid",
	separatorWidth: 1,
	separatorCustomChar: "|",
};

/** How an unstyled block renders: the global Appearance settings. */
function containerDefaults(): StyleDefaults {
	const s = getPluginInstance().settings;
	return {
		background: s.containerBackground,
		borderColor: s.containerBorderColor,
		textColor: s.containerTextColor,
	};
}

const BACKGROUND_OPTION_ITEMS: ReadonlyArray<SelectOption<ColumnBackgroundOption>> = [
	{value: "transparent", label: "Transparent"},
	{value: "primary", label: "Primary"},
	{value: "secondary", label: "Secondary"},
	{value: "alt", label: "Muted"},
	{value: "accent-soft", label: "Accent tint"},
	{value: "red-soft", label: "Red tint"},
	{value: "orange-soft", label: "Orange tint"},
	{value: "yellow-soft", label: "Yellow tint"},
	{value: "green-soft", label: "Green tint"},
	{value: "cyan-soft", label: "Cyan tint"},
	{value: "blue-soft", label: "Blue tint"},
	{value: "pink-soft", label: "Pink tint"},
];

const STYLE_COLOR_OPTION_ITEMS: ReadonlyArray<SelectOption<StyleColorOption>> = [
	{value: "gray", label: "Gray"},
	{value: "accent", label: "Accent"},
	{value: "muted", label: "Muted text"},
	{value: "text", label: "Normal text"},
	{value: "secondary", label: "Secondary"},
	{value: "red", label: "Red"},
	{value: "orange", label: "Orange"},
	{value: "yellow", label: "Yellow"},
	{value: "green", label: "Green"},
	{value: "cyan", label: "Cyan"},
	{value: "blue", label: "Blue"},
	{value: "pink", label: "Pink"},
];

const SEPARATOR_STYLE_ITEMS: ReadonlyArray<SelectOption<SeparatorLineStyle>> = [
	{value: "solid", label: "Solid"},
	{value: "dashed", label: "Dashed"},
	{value: "dotted", label: "Dotted"},
	{value: "double", label: "Double"},
	{value: "custom", label: "Character"},
];

const SEPARATOR_WIDTH_ITEMS: ReadonlyArray<SelectOption<string>> = [
	{value: "1", label: "1 px"},
	{value: "2", label: "2 px"},
	{value: "3", label: "3 px"},
	{value: "4", label: "4 px"},
	{value: "5", label: "5 px"},
	{value: "6", label: "6 px"},
	{value: "8", label: "8 px"},
];

type LayoutOption = "row" | "stack";

const LAYOUT_OPTION_ITEMS: ReadonlyArray<SelectOption<LayoutOption>> = [
	{value: "row", label: "Side by side"},
	{value: "stack", label: "Stacked"},
];

type PopoverTab = "column" | "block";

/** Last tab used; the menu re-opens on it. */
let activeTab: PopoverTab = "column";

let activePopover: HTMLDivElement | null = null;
let cleanupActivePopover: (() => void) | null = null;
let pendingFlush: (() => void) | null = null;

function cloneStyle(style: ColumnStyleData | undefined): ColumnStyleData | undefined {
	if (!style) return undefined;
	return {...style};
}

function cloneColumns(columns: ColumnData[]): ColumnData[] {
	return columns.map((col) => ({
		...col,
		style: cloneStyle(col.style),
	}));
}

function closeActivePopover(): void {
	if (pendingFlush) {
		pendingFlush();
		pendingFlush = null;
	}
	if (cleanupActivePopover) {
		cleanupActivePopover();
		cleanupActivePopover = null;
	}
	if (activePopover) {
		activePopover.remove();
		activePopover = null;
	}
}

function flushPending(): void {
	if (!pendingFlush) return;
	pendingFlush();
	pendingFlush = null;
}

// ── UI building blocks ──────────────────────────────────────
// Native Obsidian controls (toggle, dropdown, clickable icons) keep the menu
// consistent with the rest of the app's settings UI.

function stopMouse(el: HTMLElement): void {
	el.addEventListener("click", (evt) => evt.stopPropagation());
	el.addEventListener("mousedown", (evt) => evt.stopPropagation());
}

function createRow(parent: HTMLElement, label: string, cls = ""): HTMLElement {
	const row = parent.createDiv({cls: `amc-menu-row ${cls}`.trim()});
	row.createSpan({cls: "amc-menu-label", text: label});
	return row.createDiv({cls: "amc-menu-controls"});
}

function createToggle(parent: HTMLElement, label: string, checked: boolean, onChange: () => void): void {
	const toggle = parent.createDiv({cls: "checkbox-container amc-menu-toggle"});
	toggle.toggleClass("is-enabled", checked);
	toggle.setAttribute("role", "switch");
	toggle.setAttribute("aria-checked", String(checked));
	toggle.setAttribute("aria-label", label);
	toggle.tabIndex = 0;
	const input = toggle.createEl("input", {type: "checkbox"});
	input.checked = checked;
	input.tabIndex = -1;
	const fire = (evt: Event) => {
		evt.preventDefault();
		evt.stopPropagation();
		onChange();
	};
	toggle.addEventListener("click", fire);
	toggle.addEventListener("keydown", (evt) => {
		if (evt.key === "Enter" || evt.key === " ") fire(evt);
	});
}

function createDropdown<T extends string>(
	parent: HTMLElement,
	config: {
		label: string;
		value: T;
		options: ReadonlyArray<SelectOption<T>>;
		onChange: (value: T) => void;
		disabled?: boolean;
	},
): void {
	const select = parent.createEl("select", {cls: "dropdown amc-menu-dropdown"});
	select.setAttribute("aria-label", config.label);
	for (const item of config.options) {
		select.createEl("option", {value: item.value, text: item.label});
	}
	select.value = config.value;
	select.disabled = !!config.disabled;
	stopMouse(select);
	select.addEventListener("change", () => {
		const selected = config.options.find((item) => item.value === select.value);
		if (selected) config.onChange(selected.value);
	});
}

function createSegmented<T extends string>(
	parent: HTMLElement,
	config: {
		value: T;
		options: ReadonlyArray<SelectOption<T>>;
		onChange: (value: T) => void;
		cls?: string;
	},
): void {
	const group = parent.createDiv({cls: `amc-menu-segmented ${config.cls ?? ""}`.trim()});
	group.setAttribute("role", "tablist");
	for (const item of config.options) {
		const button = group.createEl("button", {text: item.label});
		button.type = "button";
		button.setAttribute("role", "tab");
		button.setAttribute("aria-selected", String(item.value === config.value));
		button.toggleClass("is-active", item.value === config.value);
		button.addEventListener("click", (evt) => {
			evt.preventDefault();
			evt.stopPropagation();
			if (item.value !== config.value) config.onChange(item.value);
		});
	}
}

function createTextInput(
	parent: HTMLElement,
	config: {label: string; value: string; placeholder?: string; maxLength?: number; onChange: (value: string) => void},
): void {
	const input = parent.createEl("input", {type: "text", cls: "amc-menu-text-input"});
	input.setAttribute("aria-label", config.label);
	input.value = config.value;
	if (config.placeholder) input.placeholder = config.placeholder;
	if (config.maxLength) input.maxLength = config.maxLength;
	stopMouse(input);
	input.addEventListener("change", () => config.onChange(input.value));
}

function createIconAction(
	parent: HTMLElement,
	config: {label: string; icon: string; danger?: boolean; onClick: () => void},
): void {
	const button = parent.createEl("button", {cls: "clickable-icon amc-menu-icon-btn"});
	button.type = "button";
	button.setAttribute("aria-label", config.label);
	button.toggleClass("mod-warning", !!config.danger);
	setIcon(button, config.icon);
	button.addEventListener("click", (evt) => {
		evt.preventDefault();
		evt.stopPropagation();
		// Flush pending style changes before structural actions.
		flushPending();
		config.onClick();
		closeActivePopover();
	});
}

function createTextAction(
	parent: HTMLElement,
	config: {label: string; danger?: boolean; onClick: () => void},
): void {
	const button = parent.createEl("button", {cls: "amc-menu-text-btn", text: config.label});
	button.type = "button";
	button.toggleClass("mod-warning", !!config.danger);
	button.addEventListener("click", (evt) => {
		evt.preventDefault();
		evt.stopPropagation();
		config.onClick();
	});
}

function positionPopover(popover: HTMLDivElement, evt: MouseEvent): void {
	const padding = 8;
	const rect = popover.getBoundingClientRect();

	let left = evt.clientX + 2;
	let top = evt.clientY + 2;

	if (left + rect.width + padding > window.innerWidth) {
		left = window.innerWidth - rect.width - padding;
	}
	if (top + rect.height + padding > window.innerHeight) {
		top = window.innerHeight - rect.height - padding;
	}

	popover.style.left = `${Math.max(padding, left)}px`;
	popover.style.top = `${Math.max(padding, top)}px`;
}

function normalizeStyle(
	style: ColumnStyleData | undefined,
	defaults: StyleDefaults,
): ColumnStyleData | undefined {
	if (!style) return undefined;

	const next: ColumnStyleData = {};
	const differs = <K extends keyof StyleDefaults>(key: K): boolean =>
		style[key] !== undefined && style[key] !== defaults[key];
	if (differs("background")) next.background = style.background;
	if (differs("borderColor")) next.borderColor = style.borderColor;
	if (differs("textColor")) next.textColor = style.textColor;
	if (style.showBorder !== undefined) next.showBorder = style.showBorder;
	if (style.leftBorder !== undefined) next.leftBorder = style.leftBorder;
	if (style.horizontalDividers !== undefined) {
		next.horizontalDividers = style.horizontalDividers;
	}
	if (style.separator !== undefined) next.separator = style.separator;
	if (differs("separatorColor")) next.separatorColor = style.separatorColor;
	if (differs("separatorStyle")) next.separatorStyle = style.separatorStyle;
	if (differs("separatorWidth")) next.separatorWidth = style.separatorWidth;
	if (differs("separatorCustomChar")) next.separatorCustomChar = style.separatorCustomChar;

	if (Object.keys(next).length === 0) return undefined;
	return next;
}

function patchStyleData(
	currentStyle: ColumnStyleData | undefined,
	patch: StylePatch,
	defaults: StyleDefaults,
): ColumnStyleData | undefined {
	const style: ColumnStyleData = {...(currentStyle ?? {})};
	let changed = false;

	for (const key of Object.keys(patch) as Array<keyof ColumnStyleData>) {
		const nextValue = patch[key];
		if (nextValue === undefined) {
			if (style[key] !== undefined) {
				delete style[key];
				changed = true;
			}
			continue;
		}
		switch (key) {
			case "background":
				if (style.background === nextValue) break;
				style.background = nextValue as ColumnBackgroundOption;
				changed = true;
				break;
			case "borderColor":
				if (style.borderColor === nextValue) break;
				style.borderColor = nextValue as StyleColorOption;
				changed = true;
				break;
			case "textColor":
				if (style.textColor === nextValue) break;
				style.textColor = nextValue as StyleColorOption;
				changed = true;
				break;
			case "showBorder":
				if (style.showBorder === nextValue) break;
				style.showBorder = nextValue as boolean;
				changed = true;
				break;
			case "horizontalDividers":
				if (style.horizontalDividers === nextValue) break;
				style.horizontalDividers = nextValue as boolean;
				changed = true;
				break;
			case "separator":
				if (style.separator === nextValue) break;
				style.separator = nextValue as boolean;
				changed = true;
				break;
			case "separatorColor":
				if (style.separatorColor === nextValue) break;
				style.separatorColor = nextValue as StyleColorOption;
				changed = true;
				break;
			case "separatorStyle":
				if (style.separatorStyle === nextValue) break;
				style.separatorStyle = nextValue as ColumnStyleData["separatorStyle"];
				changed = true;
				break;
			case "separatorWidth":
				if (style.separatorWidth === nextValue) break;
				style.separatorWidth = nextValue as number;
				changed = true;
				break;
			case "separatorCustomChar":
				if (style.separatorCustomChar === nextValue) break;
				style.separatorCustomChar = nextValue as string;
				changed = true;
				break;
			case "leftBorder":
				if (style.leftBorder === nextValue) break;
				style.leftBorder = nextValue as boolean;
				changed = true;
				break;
		}
	}

	if (!changed) return currentStyle;
	return normalizeStyle(style, defaults);
}

function patchColumnStyle(column: ColumnData, patch: StylePatch): ColumnData {
	const nextStyle = patchStyleData(column.style, patch, COLUMN_DEFAULTS);
	if (nextStyle === column.style) return column;
	return {
		...column,
		style: nextStyle,
	};
}

function getTargetIndices(menuData: ColumnStyleContextMenuData): Set<number> {
	if (menuData.selectedIndices && menuData.selectedIndices.size > 0) {
		return menuData.selectedIndices;
	}
	return new Set([menuData.columnIndex]);
}

/**
 * Special-case "unstack subset" behavior:
 * If selected stacked columns are a contiguous run within a larger stack
 * group, split them into their own separate stack group.
 *
 * Example:
 *   1 | (3,4,5,6,7 stacked:1) + unstack(6,7)
 * becomes
 *   1 | (3,4,5 stacked:1) | (6,7 stacked:2)
 */
function splitStackGroup(
	columns: ColumnData[],
	indices: Set<number>,
): ColumnData[] | null {
	if (indices.size < 1) return null;

	const selected = [...indices].sort((a, b) => a - b);
	// Must be contiguous
	for (let i = 1; i < selected.length; i++) {
		if (selected[i]! !== selected[i - 1]! + 1) return null;
	}

	const first = selected[0]!;
	const stackId = columns[first]?.stacked;
	if (!stackId || stackId <= 0) return null;

	// All selected must belong to the same stack group
	for (const idx of selected) {
		if (columns[idx]?.stacked !== stackId) return null;
	}

	// There must be at least one non-selected column remaining in the group
	const hasRemaining = columns.some(
		(col, idx) => !indices.has(idx) && col.stacked === stackId,
	);
	if (!hasRemaining) return null;

	// Find next available stack ID
	let maxStackId = 0;
	for (const col of columns) {
		if (col.stacked && col.stacked > maxStackId) maxStackId = col.stacked;
	}
	const newStackId = maxStackId + 1;

	return columns.map((col, idx) => {
		if (indices.has(idx)) {
			return {...col, stacked: newStackId, widthPercent: 0};
		}
		return col;
	});
}

function applyStylePatch(
	columns: ColumnData[],
	indices: Set<number>,
	patch: StylePatch,
): ColumnData[] {
	if (columns.length === 0) return columns;

	let changedAny = false;
	const next = columns.map((column, idx) => {
		if (!indices.has(idx)) return column;
		const updated = patchColumnStyle(column, patch);
		if (updated !== column) changedAny = true;
		return updated;
	});

	return changedAny ? next : columns;
}

function markDirty(
	menuData: ColumnStyleContextMenuData,
	state: PopoverRenderState,
): void {
	pendingFlush = () => {
		menuData.onChange(state.columns, state.containerStyle);
	};
}

function applyLiveColumnStyle(
	menuData: ColumnStyleContextMenuData,
	state: PopoverRenderState,
): void {
	if (!menuData.containerEl) return;
	const items = getColumnElements(menuData.containerEl);
	const indices = getTargetIndices(menuData);
	for (const idx of indices) {
		const colEl = items[idx];
		if (colEl) {
			applyColumnStyle(colEl, state.columns[idx]?.style);
		}
	}
}

function applyLiveContainerStyle(
	menuData: ColumnStyleContextMenuData,
	state: PopoverRenderState,
): void {
	if (!menuData.containerEl) return;
	applyContainerStyle(menuData.containerEl, state.containerStyle);
}

function patchStylesAndRerender(
	menuData: ColumnStyleContextMenuData,
	state: PopoverRenderState,
	patch: StylePatch,
): void {
	const indices = getTargetIndices(menuData);
	const updated = applyStylePatch(
		state.columns,
		indices,
		patch,
	);
	if (updated === state.columns) return;
	state.columns = updated;
	markDirty(menuData, state);
	applyLiveColumnStyle(menuData, state);
	if (activePopover) {
		renderPopoverContent(activePopover, menuData, state);
	}
}


function patchContainerStyleAndRerender(
	menuData: ColumnStyleContextMenuData,
	state: PopoverRenderState,
	patch: StylePatch,
): void {
	const updated = patchStyleData(state.containerStyle, patch, containerDefaults());
	if (updated === state.containerStyle) return;
	state.containerStyle = updated;
	markDirty(menuData, state);
	applyLiveContainerStyle(menuData, state);
	if (activePopover) {
		renderPopoverContent(activePopover, menuData, state);
	}
}

function clearAllStylesAndRerender(
	menuData: ColumnStyleContextMenuData,
	state: PopoverRenderState,
): void {
	const clearedColumns = clearStylesRecursively(state.columns);
	const containerChanged = state.containerStyle !== undefined;
	if (!clearedColumns.changed && !containerChanged) return;
	state.columns = clearedColumns.columns;
	state.containerStyle = undefined;
	pendingFlush = null; // avoid double-dispatch in closeActivePopover
	menuData.onChange(clearedColumns.columns, undefined);
	closeActivePopover();
}

function clearStylesRecursively(columns: ColumnData[]): {
	columns: ColumnData[];
	changed: boolean;
} {
	let changed = false;
	const nextColumns = columns.map((column) => {
		let columnChanged = false;
		let nextColumn: ColumnData = column;

		if (column.style !== undefined) {
			nextColumn = {...nextColumn, style: undefined};
			columnChanged = true;
		}

		const clearedContent = stripMarkerStylesFromContent(column.content);
		if (clearedContent.changed) {
			if (!columnChanged) {
				nextColumn = {...nextColumn};
			}
			nextColumn.content = clearedContent.content;
			columnChanged = true;
		}

		if (columnChanged) {
			changed = true;
			return nextColumn;
		}

		return column;
	});

	return {
		columns: changed ? nextColumns : columns,
		changed,
	};
}

function extractBreakWidthToken(payload: string): string | null {
	const tokens = payload
		.split(",")
		.map((token) => token.trim())
		.filter((token) => token.length > 0);
	for (const token of tokens) {
		if (/^\d+$/.test(token)) {
			return String(parseInt(token, 10));
		}
		const widthMatch = token.match(/^w\s*:\s*(\d+)$/i);
		if (widthMatch) {
			return String(parseInt(widthMatch[1]!, 10));
		}
	}
	return null;
}

function stripMarkerStylesFromContent(content: string): {
	content: string;
	changed: boolean;
} {
	let changed = false;
	const startRe = /^(\s*%%\s*col-start)(?:\s*:(.*?))?(\s*%%\s*)$/gm;
	const breakRe = /^(\s*%%\s*col-break)(?:\s*:(.*?))?(\s*%%\s*)$/gm;

	let nextContent = content.replace(
		startRe,
		(
			full: string,
			prefix: string,
			payload: string | undefined,
			suffix: string,
		) => {
		if (!payload) return full;
		changed = true;
		return `${prefix}${suffix}`;
		},
	);

	nextContent = nextContent.replace(
		breakRe,
		(
			full: string,
			prefix: string,
			payload: string | undefined,
			suffix: string,
		) => {
		if (!payload) return full;
		const width = extractBreakWidthToken(payload);
		changed = true;
		return width ? `${prefix}:${width}${suffix}` : `${prefix}${suffix}`;
		},
	);

	return {
		content: changed ? nextContent : content,
		changed,
	};
}

// ── Effective (rendered) values ─────────────────────────────
// The menu shows what the block actually looks like: values written in the
// markers, falling back to how unstyled columns render and to the global
// Appearance settings (container look, vertical dividers).

/** Whether the global vertical divider is drawn after `index`. */
function hasGlobalDividerAfter(state: PopoverRenderState, index: number): boolean {
	const s = getPluginInstance().settings;
	if (s.verticalDividerWidthPx <= 0 || state.layout === "stack") return false;
	if (s.styleTargetMode === "specific" && index !== s.styleTargetColumnIndex - 1) return false;
	const groups = groupColumns(state.columns);
	const groupIndex = groups.findIndex((g) => g.indices.includes(index));
	const group = groups[groupIndex];
	if (!group || groupIndex === groups.length - 1) return false;
	return group.indices[group.indices.length - 1] === index;
}

interface EffectiveColumnStyle {
	background: ColumnBackgroundOption;
	textColor: StyleColorOption;
	showBorder: boolean;
	borderColor: StyleColorOption;
	leftBorder: boolean;
	separator: boolean;
	/** The separator shown comes from the global divider setting. */
	separatorFromGlobal: boolean;
	globalDivider: boolean;
	separatorStyle: SeparatorLineStyle;
	separatorColor: StyleColorOption;
	separatorWidth: number;
	separatorCustomChar: string;
}

function effectiveColumnStyle(state: PopoverRenderState, index: number): EffectiveColumnStyle {
	const s = getPluginInstance().settings;
	const style = state.columns[index]?.style ?? {};
	const globalDivider = hasGlobalDividerAfter(state, index);
	const separatorFromGlobal = style.separator === undefined && globalDivider;
	return {
		background: style.background ?? COLUMN_DEFAULTS.background,
		textColor: style.textColor ?? COLUMN_DEFAULTS.textColor,
		showBorder: style.showBorder ?? style.borderColor !== undefined,
		borderColor: style.borderColor ?? COLUMN_DEFAULTS.borderColor,
		leftBorder: style.leftBorder ?? false,
		separator: style.separator ?? globalDivider,
		separatorFromGlobal,
		globalDivider,
		separatorStyle: style.separatorStyle
			?? (separatorFromGlobal ? s.verticalDividerStyle : COLUMN_DEFAULTS.separatorStyle),
		separatorColor: style.separatorColor
			?? (separatorFromGlobal ? s.verticalDividerColor : COLUMN_DEFAULTS.separatorColor),
		separatorWidth: style.separatorWidth
			?? (separatorFromGlobal ? s.verticalDividerWidthPx : COLUMN_DEFAULTS.separatorWidth),
		separatorCustomChar: style.separatorCustomChar ?? COLUMN_DEFAULTS.separatorCustomChar,
	};
}

interface EffectiveContainerStyle {
	background: ColumnBackgroundOption;
	textColor: StyleColorOption;
	showBorder: boolean;
	borderColor: StyleColorOption;
	globalBorder: boolean;
}

function effectiveContainerStyle(state: PopoverRenderState): EffectiveContainerStyle {
	const s = getPluginInstance().settings;
	const style = state.containerStyle ?? {};
	const globalBorder = s.showContainerBorder && s.containerBorderWidthPx > 0;
	return {
		background: style.background ?? s.containerBackground,
		textColor: style.textColor ?? s.containerTextColor,
		showBorder: style.showBorder ?? (style.borderColor !== undefined || globalBorder),
		borderColor: style.borderColor ?? s.containerBorderColor,
		globalBorder,
	};
}

function widthOptions(current: number): ReadonlyArray<SelectOption<string>> {
	if (SEPARATOR_WIDTH_ITEMS.some((item) => item.value === String(current))) return SEPARATOR_WIDTH_ITEMS;
	return [...SEPARATOR_WIDTH_ITEMS, {value: String(current), label: `${current} px`}]
		.sort((a, b) => Number(a.value) - Number(b.value));
}

// ── Popover ─────────────────────────────────────────────────

function toggleStacked(
	menuData: ColumnStyleContextMenuData,
	state: PopoverRenderState,
	indices: Set<number>,
	allStacked: boolean,
): void {
	if (allStacked) {
		const split = splitStackGroup(state.columns, indices);
		state.columns = split ?? state.columns.map((col, idx) =>
			indices.has(idx) ? {...col, stacked: undefined} : col,
		);
	} else {
		const usedIds = new Set(
			state.columns
				.filter((col) => col.stacked && col.stacked > 0)
				.map((col) => col.stacked!),
		);
		let nextId = 1;
		while (usedIds.has(nextId)) nextId++;
		state.columns = state.columns.map((col, idx) =>
			indices.has(idx) ? {...col, stacked: nextId} : col,
		);
	}
	pendingFlush = null;
	menuData.onChange(state.columns, state.containerStyle);
	closeActivePopover();
}

function renderColumnTab(
	body: HTMLElement,
	menuData: ColumnStyleContextMenuData,
	state: PopoverRenderState,
	indices: Set<number>,
	index: number,
): void {
	const eff = effectiveColumnStyle(state, index);
	const patch = (p: StylePatch) => patchStylesAndRerender(menuData, state, p);

	createDropdown(createRow(body, "Background"), {
		label: "Background",
		value: eff.background,
		options: BACKGROUND_OPTION_ITEMS,
		onChange: (value) => patch({background: value}),
	});
	createDropdown(createRow(body, "Text color"), {
		label: "Text color",
		value: eff.textColor,
		options: STYLE_COLOR_OPTION_ITEMS,
		onChange: (value) => patch({textColor: value}),
	});

	const border = createRow(body, "Border");
	createDropdown(border, {
		label: "Border color",
		value: eff.borderColor,
		options: STYLE_COLOR_OPTION_ITEMS,
		disabled: !eff.showBorder,
		onChange: (value) => patch({borderColor: value, showBorder: true}),
	});
	createToggle(border, "Border", eff.showBorder, () => patch({showBorder: !eff.showBorder}));

	createToggle(createRow(body, "Accent stripe"), "Accent stripe", eff.leftBorder, () =>
		patch({leftBorder: eff.leftBorder ? undefined : true}),
	);

	const allStacked = [...indices].every((i) => (state.columns[i]?.stacked ?? 0) > 0);
	createToggle(createRow(body, "Stacked"), "Stacked", allStacked, () =>
		toggleStacked(menuData, state, indices, allStacked),
	);

	// A separator is drawn after a column, so the last column has none.
	const isLast = indices.size === 1 && index === state.columns.length - 1;
	if (isLast) return;

	const col = state.columns[index];
	const next = state.columns[index + 1];
	const below = state.layout === "stack" || (!!col?.stacked && col.stacked === next?.stacked);
	const sepLabel = below ? "Separator below" : "Separator after";
	createToggle(createRow(body, sepLabel, "amc-menu-row-group"), sepLabel, eff.separator, () => {
		if (eff.separator) {
			// An explicit "off" is only needed to hide the global divider.
			patch({separator: eff.globalDivider ? false : undefined});
		} else {
			patch({separator: eff.globalDivider ? undefined : true});
		}
	});
	if (!eff.separator) return;

	// Editing a globally drawn divider pins its current look on this column.
	const sepPatch = (p: StylePatch) => patch(eff.separatorFromGlobal
		? {
			separator: true,
			separatorStyle: eff.separatorStyle,
			separatorColor: eff.separatorColor,
			separatorWidth: eff.separatorWidth,
			...p,
		}
		: {separator: true, ...p});

	const options = createRow(body, "Line", "amc-menu-row-sub");
	createDropdown(options, {
		label: "Separator style",
		value: eff.separatorStyle,
		options: SEPARATOR_STYLE_ITEMS,
		onChange: (value) => sepPatch({separatorStyle: value}),
	});
	createDropdown(options, {
		label: "Separator color",
		value: eff.separatorColor,
		options: STYLE_COLOR_OPTION_ITEMS,
		onChange: (value) => sepPatch({separatorColor: value}),
	});
	if (eff.separatorStyle !== "custom") {
		createDropdown(options, {
			label: "Separator width",
			value: String(eff.separatorWidth),
			options: widthOptions(eff.separatorWidth),
			onChange: (value) => sepPatch({separatorWidth: parseInt(value, 10)}),
		});
	} else {
		createTextInput(options, {
			label: "Separator character",
			value: eff.separatorCustomChar,
			placeholder: "|",
			maxLength: 3,
			onChange: (value) => sepPatch({separatorCustomChar: value || undefined}),
		});
	}
}

function renderBlockTab(
	body: HTMLElement,
	menuData: ColumnStyleContextMenuData,
	state: PopoverRenderState,
): void {
	const eff = effectiveContainerStyle(state);
	const patch = (p: StylePatch) => patchContainerStyleAndRerender(menuData, state, p);

	if (menuData.onLayoutChange) {
		createSegmented(createRow(body, "Layout"), {
			value: state.layout ?? "row",
			options: LAYOUT_OPTION_ITEMS,
			cls: "amc-menu-layout",
			onChange: (value) => {
				const nextLayout = value === "row" ? undefined : value;
				state.layout = nextLayout;
				flushPending();
				menuData.onLayoutChange?.(nextLayout);
				closeActivePopover();
			},
		});
	}

	createDropdown(createRow(body, "Background"), {
		label: "Block background",
		value: eff.background,
		options: BACKGROUND_OPTION_ITEMS,
		onChange: (value) => patch({background: value}),
	});
	createDropdown(createRow(body, "Text color"), {
		label: "Block text color",
		value: eff.textColor,
		options: STYLE_COLOR_OPTION_ITEMS,
		onChange: (value) => patch({textColor: value}),
	});

	const border = createRow(body, "Border");
	createDropdown(border, {
		label: "Block border color",
		value: eff.borderColor,
		options: STYLE_COLOR_OPTION_ITEMS,
		disabled: !eff.showBorder,
		onChange: (value) => patch({borderColor: value}),
	});
	createToggle(border, "Block border", eff.showBorder, () => {
		const nextShow = !eff.showBorder;
		// Matching the global setting again means "follow the global setting".
		const followsGlobal = nextShow === eff.globalBorder && state.containerStyle?.borderColor === undefined;
		patch({showBorder: followsGlobal ? undefined : nextShow});
	});
}

function renderPopoverContent(
	popover: HTMLDivElement,
	menuData: ColumnStyleContextMenuData,
	state: PopoverRenderState,
): void {
	popover.empty();
	const indices = getTargetIndices(menuData);
	const index = Math.max(0, Math.min(menuData.columnIndex, state.columns.length - 1));
	if (!state.columns[index]) {
		popover.createDiv({cls: "amc-menu-empty", text: "No columns available"});
		return;
	}

	// Header: what is being edited, plus column actions.
	const header = popover.createDiv({cls: "amc-menu-header"});
	const titles = header.createDiv({cls: "amc-menu-titles"});
	const sorted = [...indices].sort((a, b) => a - b);
	titles.createDiv({
		cls: "amc-menu-title",
		text: sorted.length > 1 ? `Columns ${sorted.map((i) => i + 1).join(", ")}` : `Column ${index + 1}`,
	});
	if (menuData.parentIndex !== undefined) {
		titles.createDiv({cls: "amc-menu-subtitle", text: `Nested in column ${menuData.parentIndex}`});
	}
	const actions = header.createDiv({cls: "amc-menu-actions"});
	const a = menuData.actions;
	if (a?.editColumn) createIconAction(actions, {label: "Edit column", icon: "pencil", onClick: a.editColumn});
	if (a?.addColumn) createIconAction(actions, {label: "Add column", icon: "plus", onClick: a.addColumn});
	if (a?.addChild) createIconAction(actions, {label: "Add nested columns", icon: "git-branch-plus", onClick: a.addChild});
	if (a?.deleteColumn) {
		createIconAction(actions, {label: "Delete column", icon: "trash-2", danger: true, onClick: a.deleteColumn});
	}

	createSegmented(popover, {
		value: activeTab,
		options: [
			{value: "column", label: sorted.length > 1 ? "Columns" : "Column"},
			{value: "block", label: menuData.parentIndex !== undefined ? "Nested block" : "Block"},
		],
		cls: "amc-menu-tabs",
		onChange: (value) => {
			activeTab = value;
			renderPopoverContent(popover, menuData, state);
		},
	});

	const body = popover.createDiv({cls: "amc-menu-body"});
	if (activeTab === "column") {
		renderColumnTab(body, menuData, state, indices, index);
	} else {
		renderBlockTab(body, menuData, state);
	}

	const footer = popover.createDiv({cls: "amc-menu-footer"});
	createTextAction(footer, {
		label: activeTab === "column" ? "Reset column" : "Reset block",
		onClick: () => {
			if (activeTab === "column") patchStylesAndRerender(menuData, state, CLEAR_STYLE_PATCH);
			else patchContainerStyleAndRerender(menuData, state, CLEAR_STYLE_PATCH);
		},
	});
	createTextAction(footer, {
		label: "Clear all styles",
		danger: true,
		onClick: () => clearAllStylesAndRerender(menuData, state),
	});
}

export function openColumnStyleContextMenu(
	evt: MouseEvent,
	menuData: ColumnStyleContextMenuData,
): void {
	evt.preventDefault();
	evt.stopPropagation();

	closeActivePopover();

	const doc = evt.doc;
	const win = evt.win;
	const popover = doc.body.createDiv({cls: "columns-style-popover"});
	popover.setAttribute("role", "dialog");
	popover.setAttribute("aria-label", "Column style settings");
	popover.addEventListener("contextmenu", (e) => {
		e.preventDefault();
		e.stopPropagation();
	});
	popover.addEventListener("mousedown", (e) => e.stopPropagation());

	const state: PopoverRenderState = {
		columns: cloneColumns(menuData.columns),
		containerStyle: cloneStyle(menuData.containerStyle),
		layout: menuData.layout,
	};

	renderPopoverContent(popover, menuData, state);
	positionPopover(popover, evt);

	const onPointerDown = (e: MouseEvent) => {
		if (!popover.contains(e.target as Node)) closeActivePopover();
	};
	const onKeyDown = (e: KeyboardEvent) => {
		if (e.key === "Escape") closeActivePopover();
	};
	const onViewportResize = () => closeActivePopover();

	win.setTimeout(() => {
		doc.addEventListener("mousedown", onPointerDown, true);
	}, 0);
	doc.addEventListener("keydown", onKeyDown, true);
	win.addEventListener("resize", onViewportResize);

	activePopover = popover;
	cleanupActivePopover = () => {
		doc.removeEventListener("mousedown", onPointerDown, true);
		doc.removeEventListener("keydown", onKeyDown, true);
		win.removeEventListener("resize", onViewportResize);
	};
}
