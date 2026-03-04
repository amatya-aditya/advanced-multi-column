import type {ColumnBackgroundOption, StyleColorOption} from "../../settings";
import type {ColumnData, ColumnLayout, ColumnStyleData, SeparatorLineStyle} from "../core/types";
import {applyColumnStyle, applyContainerStyle} from "../core/column-style";
import {serializeColumns} from "../core/parser";
import {getColumnElements} from "./column-renderer";

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
	horizontalDividers: undefined,
	separator: undefined,
	separatorColor: undefined,
	separatorStyle: undefined,
	separatorWidth: undefined,
	separatorCustomChar: undefined,
};

export interface ColumnContextActions {
	addColumn?: () => void;
	addChild?: () => void;
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

const DEFAULT_STYLE: Required<ColumnStyleData> = {
	background: "transparent",
	borderColor: "gray",
	textColor: "text",
	showBorder: true,
	horizontalDividers: false,
	separator: false,
	separatorColor: "gray",
	separatorStyle: "solid",
	separatorWidth: 1,
	separatorCustomChar: "|",
};

const ACTIVATION_KEYS = new Set(["Enter", " "]);

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
	{value: "custom", label: "Custom"},
];

const SEPARATOR_WIDTH_ITEMS: ReadonlyArray<SelectOption<string>> = [
	{value: "1", label: "1px"},
	{value: "2", label: "2px"},
	{value: "3", label: "3px"},
	{value: "4", label: "4px"},
	{value: "5", label: "5px"},
	{value: "6", label: "6px"},
	{value: "8", label: "8px"},
];

type LayoutOption = "row" | "stack";

const LAYOUT_OPTION_ITEMS: ReadonlyArray<SelectOption<LayoutOption>> = [
	{value: "row", label: "Row"},
	{value: "stack", label: "Stack"},
];

const collapsedSections = new Set<string>();

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

function createSectionLabel(parent: HTMLElement, text: string): void {
	const label = document.createElement("div");
	label.className = "columns-style-popover-section";
	label.textContent = text;
	parent.appendChild(label);
}

function createSectionHeader(
	parent: HTMLElement,
	config: {
		label: string;
		actionLabel?: string;
		onAction?: () => void;
	},
): void {
	const row = document.createElement("div");
	row.className = "columns-style-popover-section-inline";

	const label = document.createElement("div");
	label.className = "columns-style-popover-section";
	label.textContent = config.label;
	row.appendChild(label);

	const onAction = config.onAction;
	if (config.actionLabel && onAction) {
		const button = document.createElement("button");
		button.type = "button";
		button.className = "columns-style-popover-mini-btn";
		button.textContent = config.actionLabel;
		button.addEventListener("click", (evt) => {
			evt.preventDefault();
			evt.stopPropagation();
			onAction();
		});
		row.appendChild(button);
	}

	parent.appendChild(row);
}

function createDivider(parent: HTMLElement): void {
	const divider = document.createElement("div");
	divider.className = "columns-style-popover-divider";
	parent.appendChild(divider);
}

function createActionRow(
	parent: HTMLElement,
	config: {
		label: string;
		checked?: boolean;
		onClick: () => void;
	},
): void {
	const row = document.createElement("div");
	row.className = "columns-style-popover-row";
	row.tabIndex = 0;
	row.setAttribute("role", "checkbox");
	row.setAttribute("aria-checked", config.checked ? "true" : "false");
	if (config.checked) row.classList.add("is-checked");

	const text = document.createElement("span");
	text.className = "columns-style-popover-row-label";
	text.textContent = config.label;

	const checkbox = document.createElement("span");
	checkbox.className = "columns-style-popover-checkbox";

	const checkMark = document.createElement("span");
	checkMark.className = "columns-style-popover-checkbox-mark";
	checkMark.textContent = "\u2713";
	checkbox.appendChild(checkMark);

	row.appendChild(text);
	row.appendChild(checkbox);
	row.addEventListener("click", (evt) => {
		evt.preventDefault();
		evt.stopPropagation();
		config.onClick();
	});
	row.addEventListener("keydown", (evt) => {
		if (!ACTIVATION_KEYS.has(evt.key)) return;
		evt.preventDefault();
		evt.stopPropagation();
		config.onClick();
	});
	parent.appendChild(row);
}

function createInlineCommandButtons(
	parent: HTMLElement,
	items: ReadonlyArray<{
		label: string;
		onClick: () => void;
	}>,
): void {
	if (items.length === 0) return;

	const row = document.createElement("div");
	row.className = "columns-style-popover-inline-buttons";

	for (const item of items) {
		const button = document.createElement("button");
		button.type = "button";
		button.className = "columns-style-popover-inline-btn";
		button.textContent = item.label;
		button.addEventListener("click", (evt) => {
			evt.preventDefault();
			evt.stopPropagation();
			// Flush pending style changes before structural actions
			if (pendingFlush) {
				pendingFlush();
				pendingFlush = null;
			}
			item.onClick();
			closeActivePopover();
		});
		row.appendChild(button);
	}

	parent.appendChild(row);
}

function createSelectRow<T extends string>(
	parent: HTMLElement,
	config: {
		label: string;
		value: T;
		options: ReadonlyArray<SelectOption<T>>;
		onChange: (value: T) => void;
	},
): void {
	const row = document.createElement("div");
	row.className = "columns-style-popover-select-row";

	const selectId = `amc-select-${config.label.toLowerCase().replace(/\s+/g, "-")}-${Date.now()}`;

	const label = document.createElement("label");
	label.className = "columns-style-popover-select-label";
	label.textContent = config.label;
	label.setAttribute("for", selectId);

	const select = document.createElement("select");
	select.className = "columns-style-popover-select";
	select.id = selectId;

	for (const item of config.options) {
		const option = document.createElement("option");
		option.value = item.value;
		option.textContent = item.label;
		select.appendChild(option);
	}

	select.value = config.value;
	select.addEventListener("click", (evt) => evt.stopPropagation());
	select.addEventListener("mousedown", (evt) => evt.stopPropagation());
	select.addEventListener("change", () => {
		const selected = config.options.find((item) => item.value === select.value);
		if (!selected) return;
		config.onChange(selected.value);
	});

	row.appendChild(label);
	row.appendChild(select);
	parent.appendChild(row);
}

function createCollapsibleSection(
	parent: HTMLElement,
	config: {
		id: string;
		label: string;
		actionLabel?: string;
		onAction?: () => void;
		render: (body: HTMLElement) => void;
	},
): void {
	const wrapper = document.createElement("div");
	wrapper.className = "columns-style-popover-collapsible";
	parent.appendChild(wrapper);

	const isCollapsed = collapsedSections.has(config.id);

	const header = document.createElement("div");
	header.className = "columns-style-popover-collapsible-header";
	if (isCollapsed) header.classList.add("is-collapsed");

	const chevron = document.createElement("span");
	chevron.className = "columns-style-popover-chevron";
	chevron.textContent = isCollapsed ? "\u25B6" : "\u25BC";

	const label = document.createElement("span");
	label.className = "columns-style-popover-collapsible-label";
	label.textContent = config.label;

	header.appendChild(chevron);
	header.appendChild(label);

	const onAction = config.onAction;
	if (config.actionLabel && onAction) {
		const btn = document.createElement("button");
		btn.type = "button";
		btn.className = "columns-style-popover-mini-btn";
		btn.textContent = config.actionLabel;
		btn.addEventListener("click", (evt) => {
			evt.preventDefault();
			evt.stopPropagation();
			onAction();
		});
		header.appendChild(btn);
	}

	wrapper.appendChild(header);

	const body = document.createElement("div");
	body.className = "columns-style-popover-collapsible-body";
	if (isCollapsed) body.classList.add("is-collapsed");
	wrapper.appendChild(body);

	config.render(body);

	header.addEventListener("click", (evt) => {
		evt.preventDefault();
		evt.stopPropagation();
		const nowCollapsed = !collapsedSections.has(config.id);
		if (nowCollapsed) {
			collapsedSections.add(config.id);
			body.classList.add("is-collapsed");
			header.classList.add("is-collapsed");
			chevron.textContent = "\u25B6";
		} else {
			collapsedSections.delete(config.id);
			body.classList.remove("is-collapsed");
			header.classList.remove("is-collapsed");
			chevron.textContent = "\u25BC";
		}
	});
}

function createInlineToggleSelect<T extends string>(
	parent: HTMLElement,
	config: {
		label: string;
		checked: boolean;
		onToggle: () => void;
		selectValue: T;
		selectOptions: ReadonlyArray<SelectOption<T>>;
		onSelectChange: (value: T) => void;
	},
): void {
	const row = document.createElement("div");
	row.className = "columns-style-popover-inline-toggle-select";

	const label = document.createElement("span");
	label.className = "columns-style-popover-select-label";
	label.textContent = config.label;

	const toggle = document.createElement("span");
	toggle.className = "columns-style-popover-checkbox";
	toggle.tabIndex = 0;
	toggle.setAttribute("role", "checkbox");
	toggle.setAttribute("aria-checked", config.checked ? "true" : "false");
	if (config.checked) toggle.classList.add("is-checked");

	const checkMark = document.createElement("span");
	checkMark.className = "columns-style-popover-checkbox-mark";
	checkMark.textContent = "\u2713";
	toggle.appendChild(checkMark);

	toggle.addEventListener("click", (evt) => {
		evt.preventDefault();
		evt.stopPropagation();
		config.onToggle();
	});
	toggle.addEventListener("keydown", (evt) => {
		if (!ACTIVATION_KEYS.has(evt.key)) return;
		evt.preventDefault();
		evt.stopPropagation();
		config.onToggle();
	});

	const select = document.createElement("select");
	select.className = "columns-style-popover-select";

	for (const item of config.selectOptions) {
		const option = document.createElement("option");
		option.value = item.value;
		option.textContent = item.label;
		select.appendChild(option);
	}
	select.value = config.selectValue;
	select.addEventListener("click", (evt) => evt.stopPropagation());
	select.addEventListener("mousedown", (evt) => evt.stopPropagation());
	select.addEventListener("change", () => {
		const selected = config.selectOptions.find((item) => item.value === select.value);
		if (!selected) return;
		config.onSelectChange(selected.value);
	});

	row.appendChild(label);
	row.appendChild(toggle);
	row.appendChild(select);
	parent.appendChild(row);
}

function createTextInput(
	parent: HTMLElement,
	config: {
		label: string;
		value: string;
		placeholder?: string;
		maxLength?: number;
		onChange: (value: string) => void;
	},
): void {
	const row = document.createElement("div");
	row.className = "columns-style-popover-select-row";

	const label = document.createElement("label");
	label.className = "columns-style-popover-select-label";
	label.textContent = config.label;

	const input = document.createElement("input");
	input.type = "text";
	input.className = "columns-style-popover-text-input";
	input.value = config.value;
	if (config.placeholder) input.placeholder = config.placeholder;
	if (config.maxLength) input.maxLength = config.maxLength;

	input.addEventListener("click", (evt) => evt.stopPropagation());
	input.addEventListener("mousedown", (evt) => evt.stopPropagation());
	input.addEventListener("change", () => {
		config.onChange(input.value);
	});

	row.appendChild(label);
	row.appendChild(input);
	parent.appendChild(row);
}

interface CompactSelectDef<T extends string> {
	value: T;
	options: ReadonlyArray<SelectOption<T>>;
	onChange: (value: T) => void;
	title?: string;
}

function createCompactSelectRow<A extends string, B extends string, C extends string>(
	parent: HTMLElement,
	config: {
		label: string;
		selects: [CompactSelectDef<A>, CompactSelectDef<B>, CompactSelectDef<C>];
	},
): void {
	const row = document.createElement("div");
	row.className = "columns-style-popover-compact-row";

	const label = document.createElement("span");
	label.className = "columns-style-popover-select-label";
	label.textContent = config.label;
	row.appendChild(label);

	const selectsWrap = document.createElement("div");
	selectsWrap.className = "columns-style-popover-compact-selects";

	for (const def of config.selects) {
		const select = document.createElement("select");
		select.className = "columns-style-popover-compact-select";
		if (def.title) select.title = def.title;

		for (const item of def.options) {
			const option = document.createElement("option");
			option.value = item.value;
			option.textContent = item.label;
			select.appendChild(option);
		}
		select.value = def.value;
		select.addEventListener("click", (evt) => evt.stopPropagation());
		select.addEventListener("mousedown", (evt) => evt.stopPropagation());
		select.addEventListener("change", () => {
			const selected = def.options.find((item) => item.value === select.value);
			if (!selected) return;
			(def.onChange as (v: string) => void)(selected.value);
		});
		selectsWrap.appendChild(select);
	}

	row.appendChild(selectsWrap);
	parent.appendChild(row);
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

function readStyleValue<K extends keyof ColumnStyleData>(
	column: ColumnData,
	key: K,
	fallback: Required<ColumnStyleData>[K],
): Required<ColumnStyleData>[K] {
	const value = column.style?.[key];
	if (value === undefined) return fallback;
	return value as Required<ColumnStyleData>[K];
}

function readStyleField<K extends keyof ColumnStyleData>(
	style: ColumnStyleData | undefined,
	key: K,
	fallback: Required<ColumnStyleData>[K],
): Required<ColumnStyleData>[K] {
	const value = style?.[key];
	if (value === undefined) return fallback;
	return value as Required<ColumnStyleData>[K];
}

function normalizeStyle(style: ColumnStyleData | undefined): ColumnStyleData | undefined {
	if (!style) return undefined;

	const next: ColumnStyleData = {};
	if (style.background !== undefined && style.background !== DEFAULT_STYLE.background) {
		next.background = style.background;
	}
	if (style.borderColor !== undefined && style.borderColor !== DEFAULT_STYLE.borderColor) {
		next.borderColor = style.borderColor;
	}
	if (style.textColor !== undefined && style.textColor !== DEFAULT_STYLE.textColor) {
		next.textColor = style.textColor;
	}
	if (style.showBorder !== undefined) next.showBorder = style.showBorder;
	if (style.horizontalDividers !== undefined) {
		next.horizontalDividers = style.horizontalDividers;
	}
	if (style.separator !== undefined) next.separator = style.separator;
	if (style.separatorColor !== undefined && style.separatorColor !== DEFAULT_STYLE.separatorColor) {
		next.separatorColor = style.separatorColor;
	}
	if (style.separatorStyle !== undefined && style.separatorStyle !== DEFAULT_STYLE.separatorStyle) {
		next.separatorStyle = style.separatorStyle;
	}
	if (style.separatorWidth !== undefined && style.separatorWidth !== DEFAULT_STYLE.separatorWidth) {
		next.separatorWidth = style.separatorWidth;
	}
	if (style.separatorCustomChar !== undefined && style.separatorCustomChar !== DEFAULT_STYLE.separatorCustomChar) {
		next.separatorCustomChar = style.separatorCustomChar;
	}

	if (Object.keys(next).length === 0) return undefined;
	return next;
}

function patchStyleData(currentStyle: ColumnStyleData | undefined, patch: StylePatch): ColumnStyleData | undefined {
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
		}
	}

	if (!changed) return currentStyle;
	return normalizeStyle(style);
}

function patchColumnStyle(column: ColumnData, patch: StylePatch): ColumnData {
	const nextStyle = patchStyleData(column.style, patch);
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

function appendNestedColumnsToContent(
	content: string,
	nestedColumns: ReadonlyArray<ColumnData>,
): string {
	const trailingWhitespace = content.match(/\s*$/)?.[0] ?? "";
	const withoutTrailing = content.slice(0, content.length - trailingWhitespace.length);
	const separator = withoutTrailing.length > 0 ? "\n\n" : "";
	const nestedBlock = serializeColumns(nestedColumns);
	return `${withoutTrailing}${separator}${nestedBlock}${trailingWhitespace}`;
}

/**
 * Special-case "unstack subset" behavior:
 * If selected stacked columns are a contiguous run that has an immediate
 * stacked sibling on the left, move the selected columns into that left
 * sibling as a nested row block.
 *
 * Example:
 *   1 | (2,3,4 stacked) + unstack(3,4)
 * becomes
 *   1 | 2(with nested row: 3,4)
 */
function moveSelectedStackedColumnsToNestedRow(
	columns: ColumnData[],
	indices: Set<number>,
): ColumnData[] | null {
	if (indices.size < 2) return null;

	const selected = [...indices].sort((a, b) => a - b);
	for (let i = 1; i < selected.length; i++) {
		if (selected[i]! !== selected[i - 1]! + 1) return null;
	}

	const first = selected[0]!;
	const last = selected[selected.length - 1]!;
	if (first <= 0 || last >= columns.length) return null;

	const stackId = columns[first]?.stacked;
	if (!stackId || stackId <= 0) return null;

	for (const idx of selected) {
		if (columns[idx]?.stacked !== stackId) return null;
	}

	const hostIndex = first - 1;
	const host = columns[hostIndex];
	if (!host || host.stacked !== stackId || indices.has(hostIndex)) return null;

	// Ensure host + selected range are one contiguous stack run segment.
	for (let i = hostIndex; i <= last; i++) {
		if (columns[i]?.stacked !== stackId) return null;
	}

	const movedSet = new Set(selected);
	const nestedChildren = selected.map((idx) => {
		const col = columns[idx]!;
		return {
			...col,
			widthPercent: 0,
			stacked: undefined,
		};
	});

	const nextColumns: ColumnData[] = [];
	for (let i = 0; i < columns.length; i++) {
		if (movedSet.has(i)) continue;
		const col = columns[i]!;
		if (i === hostIndex) {
			nextColumns.push({
				...col,
				// Host becomes a regular column that contains a nested row.
				stacked: undefined,
				content: appendNestedColumnsToContent(col.content, nestedChildren),
			});
			continue;
		}
		nextColumns.push(col);
	}

	return nextColumns;
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
	const updated = patchStyleData(state.containerStyle, patch);
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

function renderPopoverContent(
	popover: HTMLDivElement,
	menuData: ColumnStyleContextMenuData,
	state: PopoverRenderState,
): void {
	const indices = getTargetIndices(menuData);
	const selectedIndex = Math.max(1, Math.min(menuData.columnIndex + 1, state.columns.length));
	const selectedColumn = state.columns[Math.max(0, selectedIndex - 1)] ?? state.columns[0];
	if (!selectedColumn) {
		popover.textContent = "";
		createSectionLabel(popover, "No columns available");
		return;
	}

	const isMultiSelect = indices.size > 1;
	const sectionLabel = isMultiSelect
		? `Columns ${[...indices].map((i) => i + 1).sort((a, b) => a - b).join(", ")}`
		: `Column ${selectedIndex}`;

	popover.textContent = "";
	createSectionHeader(popover, {
		label: "Style settings",
		actionLabel: "Clear all",
		onAction: () => clearAllStylesAndRerender(menuData, state),
	});

	if (menuData.actions?.addColumn || menuData.actions?.addChild) {
		createDivider(popover);
		createInlineCommandButtons(popover, [
			...(menuData.actions.addColumn
				? [{label: "Add column", onClick: menuData.actions.addColumn}]
				: []),
			...(menuData.actions.addChild
				? [{label: "Add child column", onClick: menuData.actions.addChild}]
				: []),
		]);
	}

	// ── Column style section ──
	createDivider(popover);
	createCollapsibleSection(popover, {
		id: "col-style",
		label: sectionLabel,
		actionLabel: "Reset",
		onAction: () => patchStylesAndRerender(menuData, state, CLEAR_STYLE_PATCH),
		render: (body) => {
			const allStacked = [...indices].every((i) => {
				const s = state.columns[i]?.stacked;
				return s !== undefined && s > 0;
			});
			createActionRow(body, {
				label: "Stacked",
				checked: allStacked,
				onClick: () => {
					if (allStacked) {
						const nestedRows = moveSelectedStackedColumnsToNestedRow(state.columns, indices);
						if (nestedRows) {
							state.columns = nestedRows;
						} else {
							// Un-stack: clear stacked flag
							state.columns = state.columns.map((col, idx) =>
								indices.has(idx)
									? {...col, stacked: undefined}
									: col,
							);
						}
					} else {
						// Stack: find next available group ID
						const usedIds = new Set(
							state.columns
								.filter((col) => col.stacked && col.stacked > 0)
								.map((col) => col.stacked!),
						);
						let nextId = 1;
						while (usedIds.has(nextId)) nextId++;
						state.columns = state.columns.map((col, idx) =>
							indices.has(idx)
								? {...col, stacked: nextId}
								: col,
						);
					}
					if (pendingFlush) {
						pendingFlush();
						pendingFlush = null;
					}
					menuData.onChange(state.columns, state.containerStyle);
					closeActivePopover();
				},
			});
			createInlineToggleSelect<StyleColorOption>(body, {
				label: "Border",
				checked: readStyleValue(selectedColumn, "showBorder", false),
				onToggle: () => {
					const current = readStyleValue(selectedColumn, "showBorder", false);
					patchStylesAndRerender(menuData, state, {showBorder: !current});
				},
				selectValue: readStyleValue(selectedColumn, "borderColor", DEFAULT_STYLE.borderColor),
				selectOptions: STYLE_COLOR_OPTION_ITEMS,
				onSelectChange: (value) => {
					patchStylesAndRerender(menuData, state, {
						borderColor: value === DEFAULT_STYLE.borderColor ? undefined : value,
					});
				},
			});
			createSelectRow<ColumnBackgroundOption>(body, {
				label: "Background",
				value: readStyleValue(selectedColumn, "background", DEFAULT_STYLE.background),
				options: BACKGROUND_OPTION_ITEMS,
				onChange: (value) => {
					patchStylesAndRerender(menuData, state, {
						background: value === DEFAULT_STYLE.background ? undefined : value,
					});
				},
			});
			createSelectRow<StyleColorOption>(body, {
				label: "Text color",
				value: readStyleValue(selectedColumn, "textColor", DEFAULT_STYLE.textColor),
				options: STYLE_COLOR_OPTION_ITEMS,
				onChange: (value) => {
					patchStylesAndRerender(menuData, state, {
						textColor: value === DEFAULT_STYLE.textColor ? undefined : value,
					});
				},
			});
		},
	});

	// ── Separator section ──
	createDivider(popover);
	createCollapsibleSection(popover, {
		id: "col-separator",
		label: "Separator",
		render: (body) => {
			createActionRow(body, {
				label: "Show separator",
				checked: readStyleValue(selectedColumn, "separator", false),
				onClick: () => {
					const current = readStyleValue(selectedColumn, "separator", false);
					patchStylesAndRerender(menuData, state, {separator: !current});
				},
			});
			createCompactSelectRow<SeparatorLineStyle, StyleColorOption, string>(body, {
				label: "Options",
				selects: [
					{
						value: readStyleValue(selectedColumn, "separatorStyle", DEFAULT_STYLE.separatorStyle),
						options: SEPARATOR_STYLE_ITEMS,
						onChange: (value) => {
							patchStylesAndRerender(menuData, state, {
								separatorStyle: value === DEFAULT_STYLE.separatorStyle ? undefined : value,
							});
						},
						title: "Line style",
					},
					{
						value: readStyleValue(selectedColumn, "separatorColor", DEFAULT_STYLE.separatorColor),
						options: STYLE_COLOR_OPTION_ITEMS,
						onChange: (value) => {
							patchStylesAndRerender(menuData, state, {
								separatorColor: value === DEFAULT_STYLE.separatorColor ? undefined : value,
							});
						},
						title: "Color",
					},
					{
						value: String(readStyleValue(selectedColumn, "separatorWidth", DEFAULT_STYLE.separatorWidth)),
						options: SEPARATOR_WIDTH_ITEMS,
						onChange: (value) => {
							const w = parseInt(value, 10);
							patchStylesAndRerender(menuData, state, {
								separatorWidth: w === DEFAULT_STYLE.separatorWidth ? undefined : w,
							});
						},
						title: "Width",
					},
				],
			});

			const currentSepStyle = readStyleValue(selectedColumn, "separatorStyle", DEFAULT_STYLE.separatorStyle);
			if (currentSepStyle === "custom") {
				createTextInput(body, {
					label: "Character",
					value: readStyleValue(selectedColumn, "separatorCustomChar", DEFAULT_STYLE.separatorCustomChar),
					placeholder: "|",
					maxLength: 3,
					onChange: (value) => {
						patchStylesAndRerender(menuData, state, {
							separatorCustomChar: value || undefined,
						});
					},
				});
			}
		},
	});

	// ── Parent style section ──
	createDivider(popover);
	createCollapsibleSection(popover, {
		id: "parent-style",
		label: menuData.parentIndex !== undefined
			? `Parent ${menuData.parentIndex}`
			: "Parent",
		actionLabel: "Reset",
		onAction: () => patchContainerStyleAndRerender(menuData, state, CLEAR_STYLE_PATCH),
		render: (body) => {
			createSelectRow<LayoutOption>(body, {
				label: "Layout",
				value: state.layout ?? "row",
				options: LAYOUT_OPTION_ITEMS,
				onChange: (value) => {
					const nextLayout = value === "row" ? undefined : value;
					state.layout = nextLayout;
					if (menuData.onLayoutChange) {
						if (pendingFlush) {
							pendingFlush();
							pendingFlush = null;
						}
						menuData.onLayoutChange(nextLayout);
						closeActivePopover();
					}
				},
			});
			createInlineToggleSelect<StyleColorOption>(body, {
				label: "Border",
				checked: readStyleField(state.containerStyle, "showBorder", false),
				onToggle: () => {
					const current = readStyleField(state.containerStyle, "showBorder", false);
					patchContainerStyleAndRerender(menuData, state, {showBorder: !current});
				},
				selectValue: readStyleField(state.containerStyle, "borderColor", DEFAULT_STYLE.borderColor),
				selectOptions: STYLE_COLOR_OPTION_ITEMS,
				onSelectChange: (value) => {
					patchContainerStyleAndRerender(menuData, state, {
						borderColor: value === DEFAULT_STYLE.borderColor ? undefined : value,
					});
				},
			});
			createSelectRow<ColumnBackgroundOption>(body, {
				label: "Background",
				value: readStyleField(state.containerStyle, "background", DEFAULT_STYLE.background),
				options: BACKGROUND_OPTION_ITEMS,
				onChange: (value) => {
					patchContainerStyleAndRerender(menuData, state, {
						background: value === DEFAULT_STYLE.background ? undefined : value,
					});
				},
			});
			createSelectRow<StyleColorOption>(body, {
				label: "Text color",
				value: readStyleField(state.containerStyle, "textColor", DEFAULT_STYLE.textColor),
				options: STYLE_COLOR_OPTION_ITEMS,
				onChange: (value) => {
					patchContainerStyleAndRerender(menuData, state, {
						textColor: value === DEFAULT_STYLE.textColor ? undefined : value,
					});
				},
			});
		},
	});
}

export function openColumnStyleContextMenu(
	evt: MouseEvent,
	menuData: ColumnStyleContextMenuData,
): void {
	evt.preventDefault();
	evt.stopPropagation();

	closeActivePopover();

	const popover = document.createElement("div");
	popover.className = "columns-style-popover";
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
	document.body.appendChild(popover);
	positionPopover(popover, evt);

	const onPointerDown = (e: MouseEvent) => {
		if (!popover.contains(e.target as Node)) closeActivePopover();
	};
	const onKeyDown = (e: KeyboardEvent) => {
		if (e.key === "Escape") closeActivePopover();
	};
	const onViewportResize = () => closeActivePopover();

	window.setTimeout(() => {
		document.addEventListener("mousedown", onPointerDown, true);
	}, 0);
	document.addEventListener("keydown", onKeyDown, true);
	window.addEventListener("resize", onViewportResize);

	activePopover = popover;
	cleanupActivePopover = () => {
		document.removeEventListener("mousedown", onPointerDown, true);
		document.removeEventListener("keydown", onKeyDown, true);
		window.removeEventListener("resize", onViewportResize);
	};
}
