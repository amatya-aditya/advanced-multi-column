import {
	AbstractInputSuggest,
	App,
	DropdownComponent,
	getIconIds,
	Setting,
	SettingDefinitionList,
	setIcon,
	TextComponent,
} from "obsidian";
import {BACKGROUND_CSS, COLOR_CSS} from "../column/core/column-style";
import type ColumnsPlugin from "../main";
import {
	BACKGROUND_OPTIONS,
	BUILTIN_HEADER_IDS,
	ColumnBackgroundOption,
	HeaderTypeConfig,
	STYLE_COLOR_OPTIONS,
	StyleColorOption,
} from "../settings";

const BACKGROUND_CSS_MAP: Record<string, string> = BACKGROUND_CSS;
const COLOR_CSS_MAP: Record<string, string> = COLOR_CSS;

/** Header type whose editor is open; kept across re-renders of the page. */
let expandedHeaderId: string | null = null;

class IconSuggest extends AbstractInputSuggest<string> {
	constructor(app: App, inputEl: HTMLInputElement, private readonly onPick: (value: string) => void) {
		super(app, inputEl);
	}

	getSuggestions(query: string): string[] {
		const lower = query.toLowerCase();
		if (!lower) return [];
		return getIconIds()
			.filter((id) => id.toLowerCase().includes(lower))
			.slice(0, 50);
	}

	renderSuggestion(value: string, el: HTMLElement): void {
		const wrapper = el.createDiv({cls: "columns-icon-suggest-item"});
		setIcon(wrapper.createSpan({cls: "columns-icon-suggest-icon"}), value);
		wrapper.createSpan({text: value});
	}

	selectSuggestion(value: string): void {
		this.setValue(value);
		this.onPick(value);
		this.close();
	}
}

/** "Header types" list: one card per type, expanded to edit it. */
export function headerTypesList(app: App, plugin: ColumnsPlugin, refresh: () => void): SettingDefinitionList {
	const types = plugin.settings.headerTypes;
	return {
		type: "list",
		heading: "Header types",
		visible: () => plugin.settings.enableHeaders,
		emptyState: "No header types.",
		addItem: {
			name: "Add header type",
			action: () => {
				const ids = new Set(types.map((h) => h.id));
				let id = "custom";
				for (let n = 1; ids.has(id); n++) id = `custom-${n}`;
				types.push({id, icon: "hash", background: "transparent", textColor: "gray", fontSize: 0.85, fontWeight: 600});
				expandedHeaderId = id;
				void plugin.saveSettings().then(refresh);
			},
		},
		items: types.map((headerType) => ({
			name: headerType.id,
			aliases: ["header type", headerType.icon],
			render: (setting: Setting) => renderHeaderType(app, plugin, setting, headerType, refresh),
		})),
	};
}

function renderHeaderType(
	app: App,
	plugin: ColumnsPlugin,
	setting: Setting,
	headerType: HeaderTypeConfig,
	refresh: () => void,
): (() => void) | void {
	const builtin = BUILTIN_HEADER_IDS.has(headerType.id);
	const expanded = expandedHeaderId === headerType.id;
	setting.settingEl.addClass("amc-settings-card");
	setting.infoEl.empty();
	setting.infoEl.addClass("columns-header-type-info");

	const preview = setting.infoEl.createDiv({cls: "columns-header-type-preview"});
	const updatePreview = () => {
		preview.empty();
		preview.setCssProps({
			"--amc-header-preview-bg": BACKGROUND_CSS_MAP[headerType.background] ?? "transparent",
			"--amc-header-preview-color": COLOR_CSS_MAP[headerType.textColor] ?? "var(--text-muted)",
			"--amc-header-preview-size": `${headerType.fontSize ?? 0.85}em`,
			"--amc-header-preview-weight": String(headerType.fontWeight ?? 600),
		});
		setIcon(preview.createSpan({cls: "columns-header-type-preview-icon"}), headerType.icon);
		preview.createSpan({text: headerType.id, cls: "columns-header-type-preview-id"});
		preview.createSpan({text: builtin ? "Built-in" : "Custom", cls: "columns-header-type-preview-badge"});
	};
	updatePreview();

	setting.addExtraButton((btn) => btn
		.setIcon(expanded ? "chevron-up" : "pencil")
		.setTooltip(expanded ? "Close" : "Edit")
		.onClick(() => {
			expandedHeaderId = expanded ? null : headerType.id;
			refresh();
		}));
	if (!builtin) {
		setting.addExtraButton((btn) => btn
			.setIcon("trash-2")
			.setTooltip("Delete header type")
			.onClick(() => {
				const list = plugin.settings.headerTypes;
				list.splice(list.indexOf(headerType), 1);
				void plugin.saveSettings().then(refresh);
			}));
	}
	if (!expanded) return;

	const save = async () => {
		updatePreview();
		await plugin.saveSettings();
	};
	const body = setting.settingEl.createDiv({cls: "amc-settings-card-body columns-header-type-controls"});

	new Setting(body).setName("Name").addText((text) => {
		text.setPlaceholder("Header name").setValue(headerType.id);
		text.inputEl.addEventListener("blur", () => {
			const next = uniqueHeaderTypeId(plugin.settings.headerTypes, text.inputEl.value, headerType);
			if (next === headerType.id && text.getValue() === next) return;
			headerType.id = next;
			expandedHeaderId = next;
			text.setValue(next);
			void save();
		});
	});

	new Setting(body).setName("Icon").addText((text) => {
		text.setPlaceholder("Icon name").setValue(headerType.icon);
		const apply = (value: string) => {
			headerType.icon = value || "hash";
			void save();
		};
		new IconSuggest(app, text.inputEl, (value) => {
			text.setValue(value);
			apply(value);
		});
		text.onChange(apply);
	});

	new Setting(body).setName("Background").addDropdown((dropdown) => {
		addOptions(dropdown, BACKGROUND_OPTIONS);
		dropdown.setValue(headerType.background).onChange((value) => {
			headerType.background = value as ColumnBackgroundOption;
			void save();
		});
	});

	new Setting(body).setName("Text color").addDropdown((dropdown) => {
		addOptions(dropdown, STYLE_COLOR_OPTIONS);
		dropdown.setValue(headerType.textColor).onChange((value) => {
			headerType.textColor = value as StyleColorOption;
			void save();
		});
	});

	addNumberSetting(body, "Font size", {min: 0.6, max: 1.5, step: 0.05}, headerType.fontSize ?? 0.85, (value) => {
		headerType.fontSize = value;
		void save();
	});
	addNumberSetting(body, "Font weight", {min: 100, max: 900, step: 100}, headerType.fontWeight ?? 600, (value) => {
		headerType.fontWeight = value;
		void save();
	});
	// Obsidian reuses the row when the page re-renders and only clears its own
	// controls, so the editor added below the row is removed here.
	return () => body.remove();
}

function addOptions(dropdown: DropdownComponent, options: Record<string, string>): void {
	for (const value of Object.keys(options)) dropdown.addOption(value, options[value] ?? value);
}

function uniqueHeaderTypeId(types: HeaderTypeConfig[], raw: string, current: HeaderTypeConfig): string {
	const base = raw.trim()
		.replace(/\s+/g, "-")
		.replace(/[^A-Za-z0-9_-]/g, "")
		.replace(/^-+/, "") || "custom";
	let candidate = base;
	for (let n = 1; types.some((t) => t !== current && t.id === candidate); n++) candidate = `${base}-${n}`;
	return candidate;
}

/** Number input that clamps to the range and snaps to the step on blur. */
function addNumberSetting(
	parent: HTMLElement,
	name: string,
	range: {min: number; max: number; step: number},
	value: number,
	onChange: (value: number) => void,
): void {
	const decimals = (String(range.step).split(".")[1] ?? "").length;
	const normalize = (raw: number) => {
		const clamped = Math.max(range.min, Math.min(range.max, raw));
		const stepped = range.min + Math.round((clamped - range.min) / range.step) * range.step;
		return Number(stepped.toFixed(decimals));
	};
	let current = value;
	new Setting(parent).setName(name).addText((text: TextComponent) => {
		text.inputEl.type = "number";
		text.inputEl.addClass("columns-settings-number-input");
		text.inputEl.min = String(range.min);
		text.inputEl.max = String(range.max);
		text.inputEl.step = String(range.step);
		text.setValue(String(current));
		text.inputEl.addEventListener("blur", () => {
			const parsed = Number(text.getValue());
			if (Number.isNaN(parsed) || text.getValue() === "") {
				text.setValue(String(current));
				return;
			}
			const next = normalize(parsed);
			text.setValue(String(next));
			if (next === current) return;
			current = next;
			onChange(next);
		});
	});
}
