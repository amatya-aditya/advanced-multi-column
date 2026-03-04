import {
	App,
	DropdownComponent,
	PluginSettingTab,
	Setting,
	SliderComponent,
	TextComponent,
} from "obsidian";
import type ColumnsPlugin from "./main";

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

export interface ColumnsPluginSettings {
	defaultColumnCount: number;
	minColumnWidthPercent: number;
	showDragHandles: boolean;
	enableLivePreview: boolean;
	enableReadingView: boolean;
	enableSlashSuggest: boolean;
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
}

export const DEFAULT_SETTINGS: ColumnsPluginSettings = {
	defaultColumnCount: 2,
	minColumnWidthPercent: 10,
	showDragHandles: true,
	enableLivePreview: true,
	enableReadingView: true,
	enableSlashSuggest: true,
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
};

// ── Option maps ──────────────────────────────────────────────────────

type SettingsTabId = "general" | "appearance" | "about";

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
