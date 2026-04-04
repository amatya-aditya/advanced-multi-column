import {
	AbstractInputSuggest,
	App,
	DropdownComponent,
	getIconIds,
	PluginSettingTab,
	Setting,
	setIcon,
	SliderComponent,
	TextComponent,
} from "obsidian";
import {BACKGROUND_CSS, COLOR_CSS} from "./column/core/column-style";
import type ColumnsPlugin from "./main";

const BACKGROUND_CSS_MAP: Record<string, string> = BACKGROUND_CSS;
const COLOR_CSS_MAP: Record<string, string> = COLOR_CSS;

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

const BUILTIN_HEADER_IDS = new Set(["note", "info", "tip", "warning", "danger"]);

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
}

export const DEFAULT_SETTINGS: ColumnsPluginSettings = {
	defaultColumnCount: 2,
	minColumnWidthPercent: 10,
	showDragHandles: true,
	enableLivePreview: true,
	enableReadingView: true,
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
};

// ── Option maps ──────────────────────────────────────────────────────

type SettingsTabId = "general" | "appearance" | "headers" | "about";

const STYLE_TARGET_OPTIONS: Record<StyleTargetMode, string> = {
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

const DIVIDER_STYLE_OPTIONS: Record<DividerLineStyle, string> = {
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
	red: "Red",
	orange: "Orange",
	yellow: "Yellow",
	green: "Green",
	cyan: "Cyan",
	blue: "Blue",
	pink: "Pink",
};

// ── Icon Suggest ────────────────────────────────────────────────────

class IconSuggest extends AbstractInputSuggest<string> {
	private onSelectCb: ((value: string) => void) | null = null;

	getSuggestions(query: string): string[] {
		const lower = query.toLowerCase();
		if (!lower) return [];
		return getIconIds()
			.filter((id) => id.toLowerCase().includes(lower))
			.slice(0, 50);
	}

	renderSuggestion(value: string, el: HTMLElement): void {
		const wrapper = el.createDiv({cls: "columns-icon-suggest-item"});
		const iconSpan = wrapper.createSpan({cls: "columns-icon-suggest-icon"});
		setIcon(iconSpan, value);
		wrapper.createSpan({text: value});
	}

	selectSuggestion(value: string, evt: MouseEvent | KeyboardEvent): void {
		this.setValue(value);
		if (this.onSelectCb) this.onSelectCb(value);
		this.close();
	}

	onSelectCallback(cb: (value: string) => void): this {
		this.onSelectCb = cb;
		return this;
	}
}

// ── Settings tab ─────────────────────────────────────────────────────

export class ColumnsSettingTab extends PluginSettingTab {
	plugin: ColumnsPlugin;
	private activeTab: SettingsTabId = "general";

	constructor(app: App, plugin: ColumnsPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;
		containerEl.empty();
		containerEl.addClass("columns-settings-root");

		const tabBar = containerEl.createDiv({cls: "columns-settings-tab-bar"});
		const panelsHost = containerEl.createDiv({cls: "columns-settings-panels"});

		const tabs: Array<{
			id: SettingsTabId;
			label: string;
			render: (panelEl: HTMLElement) => void;
		}> = [
			{id: "general", label: "General", render: (el) => this.renderGeneralTab(el)},
			{id: "appearance", label: "Appearance", render: (el) => this.renderAppearanceTab(el)},
			{id: "headers", label: "Headers", render: (el) => this.renderHeadersTab(el)},
			{id: "about", label: "About", render: (el) => this.renderAboutTab(el)},
		];

		const tabButtons = new Map<SettingsTabId, HTMLButtonElement>();
		const tabPanels = new Map<SettingsTabId, HTMLElement>();

		const activateTab = (tabId: SettingsTabId) => {
			this.activeTab = tabId;
			for (const [id, btn] of tabButtons) {
				btn.toggleClass("is-active", id === tabId);
			}
			for (const [id, panel] of tabPanels) {
				panel.toggleClass("is-active", id === tabId);
			}
		};

		for (const tab of tabs) {
			const btn = tabBar.createEl("button", {
				text: tab.label,
				cls: "columns-settings-tab-btn",
			});
			btn.type = "button";
			btn.addEventListener("click", () => activateTab(tab.id));
			tabButtons.set(tab.id, btn);

			const panel = panelsHost.createDiv({cls: "columns-settings-panel"});
			tab.render(panel);
			tabPanels.set(tab.id, panel);
		}

		activateTab(this.activeTab);
	}

	// ── General tab ──────────────────────────────────────────────

	private renderGeneralTab(panelEl: HTMLElement): void {
		new Setting(panelEl)
			.setName("Enable in live preview")
			.setDesc("Render columns in live preview (editing) mode.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.enableLivePreview)
					.onChange(async (value) => {
						this.plugin.settings.enableLivePreview = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(panelEl)
			.setName("Enable in reading view")
			.setDesc("Render columns in reading (preview) mode.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.enableReadingView)
					.onChange(async (value) => {
						this.plugin.settings.enableReadingView = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(panelEl)
			.setName("Enable slash suggest")
			.setDesc("Show plugin slash command suggestions in column editors.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.enableSlashSuggest)
					.onChange(async (value) => {
						this.plugin.settings.enableSlashSuggest = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(panelEl)
			.setName("Inherit style on add")
			.setDesc("New columns inherit the style of the column they are added after.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.inheritStyleOnAdd)
					.onChange(async (value) => {
						this.plugin.settings.inheritStyleOnAdd = value;
						await this.plugin.saveSettings();
					}),
			);

		this.addSliderWithNumber(panelEl, "Default column count", "Number of columns when inserting a new layout.", {
			min: 2,
			max: 6,
			step: 1,
			value: this.plugin.settings.defaultColumnCount,
			onChange: (value) => {
				this.plugin.settings.defaultColumnCount = value;
			},
		});

		this.addSliderWithNumber(panelEl, "Minimum column width", "Minimum width percentage for any column.", {
			min: 5,
			max: 30,
			step: 5,
			value: this.plugin.settings.minColumnWidthPercent,
			onChange: (value) => {
				this.plugin.settings.minColumnWidthPercent = value;
			},
		});

		new Setting(panelEl)
			.setName("Show drag handles")
			.setDesc("Show grip icons for drag-and-drop reordering.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showDragHandles)
					.onChange(async (value) => {
						this.plugin.settings.showDragHandles = value;
						await this.plugin.saveSettings();
					}),
			);
	}

	// ── Appearance tab ───────────────────────────────────────────

	private renderAppearanceTab(panelEl: HTMLElement): void {
		// ── Style target ──
		this.addSectionHeading(panelEl, "Style Target");

		new Setting(panelEl)
			.setName("Apply styles to")
			.setDesc("Apply global style settings to all columns or a specific column index.")
			.addDropdown((dropdown) => {
				this.addDropdownOptions(dropdown, STYLE_TARGET_OPTIONS);
				dropdown.setValue(this.plugin.settings.styleTargetMode);
				dropdown.onChange(async (value) => {
					this.plugin.settings.styleTargetMode = value as StyleTargetMode;
					await this.plugin.saveSettings();
					this.display();
				});
			});

		if (this.plugin.settings.styleTargetMode === "specific") {
			this.addSliderWithNumber(panelEl, "Column index", "1 = first column in each layout.", {
				min: 1,
				max: 12,
				step: 1,
				value: this.plugin.settings.styleTargetColumnIndex,
				onChange: (value) => {
					this.plugin.settings.styleTargetColumnIndex = value;
				},
			});
		}

		// ── Container ──
		this.addSectionHeading(panelEl, "Container");

		new Setting(panelEl)
			.setName("Background")
			.setDesc("Background color for the column container.")
			.addDropdown((dropdown) => {
				this.addDropdownOptions(dropdown, BACKGROUND_OPTIONS);
				dropdown.setValue(this.plugin.settings.containerBackground);
				dropdown.onChange(async (value) => {
					this.plugin.settings.containerBackground = value as ColumnBackgroundOption;
					await this.plugin.saveSettings();
				});
			});

		new Setting(panelEl)
			.setName("Show border")
			.setDesc("Draw a border around the container.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showContainerBorder)
					.onChange(async (value) => {
						this.plugin.settings.showContainerBorder = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(panelEl)
			.setName("Border color")
			.addDropdown((dropdown) => {
				this.addDropdownOptions(dropdown, STYLE_COLOR_OPTIONS);
				dropdown.setValue(this.plugin.settings.containerBorderColor);
				dropdown.onChange(async (value) => {
					this.plugin.settings.containerBorderColor = value as StyleColorOption;
					await this.plugin.saveSettings();
				});
			});

		this.addSliderWithNumber(panelEl, "Border width", "Thickness in pixels.", {
			min: 0,
			max: 8,
			step: 1,
			value: this.plugin.settings.containerBorderWidthPx,
			onChange: (value) => {
				this.plugin.settings.containerBorderWidthPx = value;
			},
		});

		this.addSliderWithNumber(panelEl, "Corner radius", "Rounding in pixels.", {
			min: 0,
			max: 24,
			step: 1,
			value: this.plugin.settings.containerCornerRadiusPx,
			onChange: (value) => {
				this.plugin.settings.containerCornerRadiusPx = value;
			},
		});

		new Setting(panelEl)
			.setName("Text color")
			.addDropdown((dropdown) => {
				this.addDropdownOptions(dropdown, STYLE_COLOR_OPTIONS);
				dropdown.setValue(this.plugin.settings.containerTextColor);
				dropdown.onChange(async (value) => {
					this.plugin.settings.containerTextColor = value as StyleColorOption;
					await this.plugin.saveSettings();
				});
			});

		// ── Vertical dividers ──
		this.addSectionHeading(panelEl, "Vertical Dividers");

		this.addSliderWithNumber(panelEl, "Width", "Width of the vertical line in pixels.", {
			min: 0,
			max: 8,
			step: 1,
			value: this.plugin.settings.verticalDividerWidthPx,
			onChange: (value) => {
				this.plugin.settings.verticalDividerWidthPx = value;
			},
		});

		new Setting(panelEl)
			.setName("Style")
			.addDropdown((dropdown) => {
				this.addDropdownOptions(dropdown, DIVIDER_STYLE_OPTIONS);
				dropdown.setValue(this.plugin.settings.verticalDividerStyle);
				dropdown.onChange(async (value) => {
					this.plugin.settings.verticalDividerStyle = value as DividerLineStyle;
					await this.plugin.saveSettings();
				});
			});

		new Setting(panelEl)
			.setName("Color")
			.addDropdown((dropdown) => {
				this.addDropdownOptions(dropdown, STYLE_COLOR_OPTIONS);
				dropdown.setValue(this.plugin.settings.verticalDividerColor);
				dropdown.onChange(async (value) => {
					this.plugin.settings.verticalDividerColor = value as StyleColorOption;
					await this.plugin.saveSettings();
				});
			});

	}

	// ── Headers tab ─────────────────────────────────────────────

	private renderHeadersTab(panelEl: HTMLElement): void {
		new Setting(panelEl)
			.setName("Enable column headers")
			.setDesc("Parse !type: title syntax as styled headers in columns")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.enableHeaders)
					.onChange(async (value) => {
						this.plugin.settings.enableHeaders = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(panelEl).setName("Header types").setHeading();
		panelEl.createEl("p", {
			text: "Use !type: title as the first line in a column to render a styled header.",
			cls: "setting-item-description",
		});

		const listEl = panelEl.createDiv({cls: "columns-header-types-list"});
		this.renderHeaderTypesList(listEl);

		new Setting(panelEl)
			.addButton((btn) =>
				btn
					.setButtonText("Add header type")
					.setCta()
					.onClick(async () => {
						const ids = new Set(this.plugin.settings.headerTypes.map((h) => h.id));
						let newId = "custom";
						let n = 1;
						while (ids.has(newId)) {
							newId = `custom-${n++}`;
						}
						this.plugin.settings.headerTypes.push({
							id: newId,
							icon: "hash",
							background: "transparent",
							textColor: "gray",
							fontSize: 0.85,
							fontWeight: 600,
						});
						await this.plugin.saveSettings();
						this.renderHeaderTypesList(listEl);
					}),
			);
	}

	private renderHeaderTypesList(listEl: HTMLElement): void {
		listEl.empty();
		const types = this.plugin.settings.headerTypes;

		for (let i = 0; i < types.length; i++) {
			const ht = types[i]!;
			const row = listEl.createDiv({cls: "columns-header-type-row"});

			// ── Preview banner ──
			const preview = row.createDiv({cls: "columns-header-type-preview"});
			const updatePreview = () => {
				const isBuiltin = BUILTIN_HEADER_IDS.has(ht.id);
				preview.empty();
				const bg = BACKGROUND_CSS_MAP[ht.background] ?? "transparent";
				const color = COLOR_CSS_MAP[ht.textColor] ?? "var(--text-muted)";
				preview.style.background = bg;
				preview.style.color = color;
				preview.style.fontSize = `${ht.fontSize ?? 0.85}em`;
				preview.style.fontWeight = String(ht.fontWeight ?? 600);

				const iconSpan = preview.createSpan({cls: "columns-header-type-preview-icon"});
				setIcon(iconSpan, ht.icon);
				preview.createSpan({
					text: `!${ht.id}`,
					cls: "columns-header-type-preview-id",
				});
				preview.createSpan({
					text: isBuiltin ? "Built-in" : "Custom",
					cls: "columns-header-type-preview-badge",
				});
				if (!isBuiltin) {
					const deleteBtn = preview.createSpan({
						cls: "columns-header-type-delete-btn",
						attr: {"aria-label": "Delete header type"},
					});
					setIcon(deleteBtn, "trash-2");
					deleteBtn.addEventListener("click", (e) => {
						e.stopPropagation();
						this.plugin.settings.headerTypes.splice(i, 1);
						void this.plugin.saveSettings();
						this.renderHeaderTypesList(listEl);
					});
				}
			};
			updatePreview();

			// ── Controls ──
			const controls = row.createDiv({cls: "columns-header-type-controls"});

			const nameRow = new Setting(controls)
				.setName("Header name")
				.addText((text) => {
					// eslint-disable-next-line obsidianmd/ui/sentence-case
					text.setPlaceholder("header-name").setValue(ht.id);
					text.inputEl.addEventListener("blur", () => {
						void this.persistHeaderTypeId(i, ht, text, updatePreview);
					});
				});
			nameRow.settingEl.addClass("columns-header-type-setting");

			// Icon input with autosuggest
			const iconRow = new Setting(controls)
				.setName("Icon")
				.addText((text) => {
					// eslint-disable-next-line obsidianmd/ui/sentence-case
					text.setPlaceholder("icon name").setValue(ht.icon);
					const suggest = new IconSuggest(this.app, text.inputEl);
					suggest.onSelectCallback((value) => {
						ht.icon = value || "hash";
						text.setValue(ht.icon);
						updatePreview();
						void this.plugin.saveSettings();
					});
					text.onChange(async (value) => {
						ht.icon = value || "hash";
						updatePreview();
						await this.plugin.saveSettings();
					});
				});
			iconRow.settingEl.addClass("columns-header-type-setting");

			// Background dropdown
			const bgRow = new Setting(controls)
				.setName("Background")
				.addDropdown((dd) => {
					this.addDropdownOptions(dd, BACKGROUND_OPTIONS);
					dd.setValue(ht.background);
					dd.onChange(async (value) => {
						ht.background = value as ColumnBackgroundOption;
						updatePreview();
						await this.plugin.saveSettings();
					});
				});
			bgRow.settingEl.addClass("columns-header-type-setting");

			// Text color dropdown
			const colorRow = new Setting(controls)
				.setName("Text color")
				.addDropdown((dd) => {
					this.addDropdownOptions(dd, STYLE_COLOR_OPTIONS);
					dd.setValue(ht.textColor);
					dd.onChange(async (value) => {
						ht.textColor = value as StyleColorOption;
						updatePreview();
						await this.plugin.saveSettings();
					});
				});
			colorRow.settingEl.addClass("columns-header-type-setting");

			this.addNumberInputInContainer(controls, "Font size", {
				min: 0.6,
				max: 1.5,
				step: 0.05,
				value: ht.fontSize ?? 0.85,
				onChange: (value) => {
					ht.fontSize = value;
					updatePreview();
				},
			});

			this.addNumberInputInContainer(controls, "Font weight", {
				min: 100,
				max: 900,
				step: 100,
				value: ht.fontWeight ?? 600,
				onChange: (value) => {
					ht.fontWeight = value;
					updatePreview();
				},
			});
		}
	}

	// ── About tab ────────────────────────────────────────────────

	private renderAboutTab(panelEl: HTMLElement): void {
		const aboutEl = panelEl.createDiv({cls: "columns-settings-about"});

		// Plugin info
		const infoEl = aboutEl.createDiv({cls: "columns-settings-about-info"});
		infoEl.createEl("div", {
			text: "Advanced multi column",
			cls: "columns-settings-about-name",
		});
		infoEl.createEl("div", {
			text: `v${this.plugin.manifest.version}`,
			cls: "columns-settings-about-version",
		});

		// Links
		const linksEl = aboutEl.createDiv({cls: "columns-settings-about-links"});
		this.addAboutLink(linksEl, "GitHub", "https://github.com/amatya-aditya/obsidian-multi-columns");
		this.addAboutLink(linksEl, "Report Issue", "https://github.com/amatya-aditya/obsidian-multi-columns/issues");
		this.addAboutLink(linksEl, "Discord", "https://discord.gg/9bu7V9BBbs");

		// Support
		const supportEl = aboutEl.createDiv({cls: "columns-settings-about-support"});
		supportEl.createEl("div", {
			text: "Support development",
			cls: "columns-settings-about-support-label",
		});
		const supportLinks = supportEl.createDiv({cls: "columns-settings-about-links"});
		this.addAboutLink(supportLinks, "Buy Me a Coffee", "https://www.buymeacoffee.com/amatya_aditya");
		this.addAboutLink(supportLinks, "Ko-fi", "https://ko-fi.com/Y8Y41FV4WI");

		// Other plugins
		const othersEl = aboutEl.createDiv({cls: "columns-settings-about-others"});
		othersEl.createEl("div", {
			text: "Other plugins",
			cls: "columns-settings-about-support-label",
		});
		const otherLinks = othersEl.createDiv({cls: "columns-settings-about-links"});
		this.addAboutLink(otherLinks, "RSS Dashboard", "https://github.com/amatya-aditya/obsidian-rss-dashboard");
		this.addAboutLink(otherLinks, "Media Slider", "https://github.com/amatya-aditya/obsidian-media-slider");
		this.addAboutLink(otherLinks, "Zen Space", "https://github.com/amatya-aditya/obsidian-zen-space");
	}

	private addAboutLink(parent: HTMLElement, label: string, url: string): void {
		const link = parent.createEl("a", {
			text: label,
			cls: "columns-settings-about-link",
			href: url,
		});
		link.setAttr("target", "_blank");
		link.setAttr("rel", "noopener");
	}

	// ── Helpers ──────────────────────────────────────────────────

	private addSectionHeading(parentEl: HTMLElement, title: string): void {
		parentEl.createDiv({
			text: title,
			cls: "columns-settings-section-title",
		});
	}

	private addDropdownOptions<T extends string>(
		dropdown: DropdownComponent,
		options: Record<T, string>,
	): void {
		for (const value of Object.keys(options) as T[]) {
			dropdown.addOption(value, options[value]);
		}
	}

	private normalizeHeaderTypeId(raw: string): string {
		return raw
			.trim()
			.replace(/\s+/g, "-")
			.replace(/[^A-Za-z0-9_-]/g, "")
			.replace(/^-+/, "");
	}

	private getUniqueHeaderTypeId(raw: string, currentIndex: number): string {
		const base = this.normalizeHeaderTypeId(raw) || "custom";
		let candidate = base;
		let suffix = 1;

		while (this.plugin.settings.headerTypes.some((headerType, index) => index !== currentIndex && headerType.id === candidate)) {
			candidate = `${base}-${suffix++}`;
		}

		return candidate;
	}

	private async persistHeaderTypeId(
		index: number,
		headerType: HeaderTypeConfig,
		text: TextComponent,
		updatePreview: () => void,
	): Promise<void> {
		const nextId = this.getUniqueHeaderTypeId(text.inputEl.value, index);
		if (nextId === headerType.id && text.inputEl.value === headerType.id) return;

		headerType.id = nextId;
		text.setValue(nextId);
		updatePreview();
		await this.plugin.saveSettings();
	}

	private addNumberInputInContainer(
		container: HTMLElement,
		name: string,
		config: {
			min: number;
			max: number;
			step: number;
			value: number;
			onChange: (value: number) => void;
		},
	): void {
		const setting = new Setting(container).setName(name);
		setting.settingEl.addClass("columns-header-type-setting");

		const decimals = this.countStepDecimals(config.step);
		let currentValue = config.value;

		const normalize = (raw: number): number => {
			const clamped = Math.max(config.min, Math.min(config.max, raw));
			const stepped =
				config.min +
				Math.round((clamped - config.min) / config.step) * config.step;
			return Number(stepped.toFixed(decimals));
		};

		setting.addText((text) => {
			text.inputEl.type = "number";
			text.inputEl.classList.add("columns-settings-number-input");
			text.inputEl.min = String(config.min);
			text.inputEl.max = String(config.max);
			text.inputEl.step = String(config.step);
			text.setValue(String(currentValue));

			const persist = async () => {
				const parsed = Number(text.inputEl.value);
				if (Number.isNaN(parsed)) {
					text.setValue(String(currentValue));
					return;
				}

				currentValue = normalize(parsed);
				config.onChange(currentValue);
				text.setValue(String(currentValue));
				await this.plugin.saveSettings();
			};

			text.onChange((value) => {
				const parsed = Number(value);
				if (Number.isNaN(parsed)) return;
				currentValue = normalize(parsed);
				config.onChange(currentValue);
			});

			text.inputEl.addEventListener("blur", () => {
				void persist();
			});
		});
	}

	private addSliderWithNumber(
		parentEl: HTMLElement,
		name: string,
		desc: string,
		config: {
			min: number;
			max: number;
			step: number;
			value: number;
			onChange: (value: number) => void;
		},
	): void {
		let sliderRef: SliderComponent | null = null;
		let inputRef: TextComponent | null = null;

		const decimals = this.countStepDecimals(config.step);

		const normalize = (raw: number): number => {
			const clamped = Math.max(config.min, Math.min(config.max, raw));
			const stepped =
				config.min +
				Math.round((clamped - config.min) / config.step) * config.step;
			return Number(stepped.toFixed(decimals));
		};

		const syncControls = (value: number) => {
			if (sliderRef) sliderRef.setValue(value);
			if (inputRef) inputRef.inputEl.value = String(value);
		};

		const persist = async (raw: number) => {
			const value = normalize(raw);
			config.onChange(value);
			syncControls(value);
			await this.plugin.saveSettings();
		};

		new Setting(parentEl)
			.setName(name)
			.setDesc(desc)
			.addSlider((slider) => {
				sliderRef = slider;
				return slider
					.setLimits(config.min, config.max, config.step)
					.setValue(config.value)
					.setDynamicTooltip()
					.onChange((value) => {
						void persist(value);
					});
			})
			.addText((text) => {
				inputRef = text;
				text.inputEl.type = "number";
				text.inputEl.classList.add("columns-settings-number-input");
				text.inputEl.min = String(config.min);
				text.inputEl.max = String(config.max);
				text.inputEl.step = String(config.step);
				text.inputEl.value = String(config.value);
				text.onChange((value) => {
					const parsed = Number(value);
					if (Number.isNaN(parsed)) return;
					void persist(parsed);
				});
			});
	}

	private countStepDecimals(step: number): number {
		if (!Number.isFinite(step)) return 0;
		const [, decimals = ""] = String(step).split(".");
		return decimals.length;
	}
}
