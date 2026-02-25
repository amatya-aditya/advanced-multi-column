import type {ColumnBackgroundOption, StyleColorOption} from "../settings";
import type {ColumnData, ColumnStyleData} from "./types";

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
	parentIndex?: number;
	actions?: ColumnContextActions;
}

interface PopoverRenderState {
	columns: ColumnData[];
	containerStyle?: ColumnStyleData;
}

const DEFAULT_STYLE: Required<ColumnStyleData> = {
	background: "transparent",
	borderColor: "gray",
	textColor: "text",
	showBorder: true,
	horizontalDividers: false,
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

let activePopover: HTMLDivElement | null = null;
let cleanupActivePopover: (() => void) | null = null;

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

	const label = document.createElement("label");
	label.className = "columns-style-popover-select-label";
	label.textContent = config.label;

	const select = document.createElement("select");
	select.className = "columns-style-popover-select";

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

function applyStylePatch(
	columns: ColumnData[],
	columnIndex: number,
	patch: StylePatch,
): ColumnData[] {
	if (columns.length === 0) return columns;

	const safeIndex = Math.max(0, Math.min(columnIndex, columns.length - 1));

	let changedAny = false;
	const next = columns.map((column, idx) => {
		if (idx !== safeIndex) return column;
		const updated = patchColumnStyle(column, patch);
		if (updated !== column) changedAny = true;
		return updated;
	});

	return changedAny ? next : columns;
}

function patchStylesAndRerender(
	menuData: ColumnStyleContextMenuData,
	state: PopoverRenderState,
	patch: StylePatch,
): void {
	const updated = applyStylePatch(
		state.columns,
		menuData.columnIndex,
		patch,
	);
	if (updated === state.columns) return;
	state.columns = updated;
	menuData.onChange(updated, state.containerStyle);
	// The underlying widget instance is replaced after dispatch, so close
	// to avoid writing again via stale callbacks.
	closeActivePopover();
}

function patchContainerStyleAndRerender(
	menuData: ColumnStyleContextMenuData,
	state: PopoverRenderState,
	patch: StylePatch,
): void {
	const updated = patchStyleData(state.containerStyle, patch);
	if (updated === state.containerStyle) return;
	state.containerStyle = updated;
	menuData.onChange(state.columns, updated);
	// The underlying widget instance is replaced after dispatch, so close
	// to avoid writing again via stale callbacks.
	closeActivePopover();
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
	const selectedIndex = Math.max(1, Math.min(menuData.columnIndex + 1, state.columns.length));
	const selectedColumn = state.columns[Math.max(0, selectedIndex - 1)] ?? state.columns[0];
	if (!selectedColumn) {
		popover.textContent = "";
		createSectionLabel(popover, "No columns available");
		return;
	}

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

	createDivider(popover);
	createSectionHeader(popover, {
		label: `Styles for column ${selectedIndex}`,
		actionLabel: "Reset",
		onAction: () => patchStylesAndRerender(menuData, state, CLEAR_STYLE_PATCH),
	});

	createActionRow(popover, {
		label: "Show border",
		checked: readStyleValue(selectedColumn, "showBorder", false),
		onClick: () => {
			const current = readStyleValue(selectedColumn, "showBorder", false);
			patchStylesAndRerender(menuData, state, {showBorder: !current});
		},
	});

	createSelectRow<ColumnBackgroundOption>(popover, {
		label: "Column background",
		value: readStyleValue(selectedColumn, "background", DEFAULT_STYLE.background),
		options: BACKGROUND_OPTION_ITEMS,
		onChange: (value) => {
			patchStylesAndRerender(menuData, state, {
				background: value === DEFAULT_STYLE.background ? undefined : value,
			});
		},
	});
	createSelectRow<StyleColorOption>(popover, {
		label: "Column border",
		value: readStyleValue(selectedColumn, "borderColor", DEFAULT_STYLE.borderColor),
		options: STYLE_COLOR_OPTION_ITEMS,
		onChange: (value) => {
			patchStylesAndRerender(menuData, state, {
				borderColor: value === DEFAULT_STYLE.borderColor ? undefined : value,
			});
		},
	});
	createSelectRow<StyleColorOption>(popover, {
		label: "Column text",
		value: readStyleValue(selectedColumn, "textColor", DEFAULT_STYLE.textColor),
		options: STYLE_COLOR_OPTION_ITEMS,
		onChange: (value) => {
			patchStylesAndRerender(menuData, state, {
				textColor: value === DEFAULT_STYLE.textColor ? undefined : value,
			});
		},
	});

	createDivider(popover);
	createSectionHeader(popover, {
		label:
			menuData.parentIndex !== undefined
				? `Parent styles ${menuData.parentIndex}`
				: "Parent styles",
		actionLabel: "Reset",
		onAction: () => patchContainerStyleAndRerender(menuData, state, CLEAR_STYLE_PATCH),
	});

	createActionRow(popover, {
		label: "Show parent border",
		checked: readStyleField(
			state.containerStyle,
			"showBorder",
			false,
		),
		onClick: () => {
			const current = readStyleField(
				state.containerStyle,
				"showBorder",
				false,
			);
			patchContainerStyleAndRerender(menuData, state, {showBorder: !current});
		},
	});

	createSelectRow<ColumnBackgroundOption>(popover, {
		label: "Parent background",
		value: readStyleField(
			state.containerStyle,
			"background",
			DEFAULT_STYLE.background,
		),
		options: BACKGROUND_OPTION_ITEMS,
		onChange: (value) => {
			patchContainerStyleAndRerender(menuData, state, {
				background: value === DEFAULT_STYLE.background ? undefined : value,
			});
		},
	});
	createSelectRow<StyleColorOption>(popover, {
		label: "Parent border",
		value: readStyleField(
			state.containerStyle,
			"borderColor",
			DEFAULT_STYLE.borderColor,
		),
		options: STYLE_COLOR_OPTION_ITEMS,
		onChange: (value) => {
			patchContainerStyleAndRerender(menuData, state, {
				borderColor: value === DEFAULT_STYLE.borderColor ? undefined : value,
			});
		},
	});
	createSelectRow<StyleColorOption>(popover, {
		label: "Parent text",
		value: readStyleField(
			state.containerStyle,
			"textColor",
			DEFAULT_STYLE.textColor,
		),
		options: STYLE_COLOR_OPTION_ITEMS,
		onChange: (value) => {
			patchContainerStyleAndRerender(menuData, state, {
				textColor: value === DEFAULT_STYLE.textColor ? undefined : value,
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
	popover.addEventListener("contextmenu", (e) => {
		e.preventDefault();
		e.stopPropagation();
	});
	popover.addEventListener("mousedown", (e) => e.stopPropagation());

	const state: PopoverRenderState = {
		columns: cloneColumns(menuData.columns),
		containerStyle: cloneStyle(menuData.containerStyle),
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
