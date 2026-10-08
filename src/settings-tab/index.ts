import {App, PluginSettingTab, SettingDefinitionItem} from "obsidian";
import type ColumnsPlugin from "../main";
import {mocSettingsPage} from "../moc/settings-section";
import {
	BACKGROUND_OPTIONS,
	ColumnsPluginSettings,
	DIVIDER_STYLE_OPTIONS,
	STYLE_COLOR_OPTIONS,
	STYLE_TARGET_OPTIONS,
} from "../settings";
import {renderAbout} from "./about";
import {headerTypesList} from "./header-types";

/** Name of the MOC sub-page, used to open settings directly on it. */
export const MOC_PAGE_NAME = "MOC";

/**
 * Settings tab, declared with Obsidian's settings definitions so every option
 * is searchable from the settings search. Simple options are bound controls;
 * MOC templates, header types and the about card render their own rows.
 */
export class ColumnsSettingTab extends PluginSettingTab {
	plugin: ColumnsPlugin;

	constructor(app: App, plugin: ColumnsPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		const settings = this.plugin.settings;
		const refresh = () => this.update();
		return [
			{
				type: "group",
				items: [
					{name: "Enable in live preview", desc: "Render columns in live preview (editing) mode.", control: {type: "toggle", key: "enableLivePreview"}},
					{name: "Enable in reading view", desc: "Render columns in reading (preview) mode.", control: {type: "toggle", key: "enableReadingView"}},
					{name: "Hide comments in live preview", desc: "Hide %% comments %% in live preview, as in reading view. A comment shows while the cursor is on it, so you can still edit it.", aliases: ["comment", "%%"], visible: () => settings.enableLivePreview, control: {type: "toggle", key: "hideCommentsInLivePreview"}},
					{name: "Fold note properties by default", desc: "Collapse the properties section when a note is opened, including new notes.", control: {type: "toggle", key: "foldNotePropertiesByDefault"}},
					{name: "Enable slash suggest", desc: "Show plugin slash command suggestions in column editors.", control: {type: "toggle", key: "enableSlashSuggest"}},
					{name: "Inherit style on add", desc: "New columns inherit the style of the column they are added after.", control: {type: "toggle", key: "inheritStyleOnAdd"}},
					{name: "Default column count", desc: "Number of columns when inserting a new layout.", control: {type: "slider", key: "defaultColumnCount", min: 2, max: 6, step: 1}},
					{name: "Minimum column width", desc: "Minimum width percentage for any column.", control: {type: "slider", key: "minColumnWidthPercent", min: 5, max: 30, step: 5, displayFormat: (v) => `${v}%`}},
					{name: "Show drag handles", desc: "Show grip icons for drag-and-drop reordering.", control: {type: "toggle", key: "showDragHandles"}},
				],
			},
			{
				type: "group",
				heading: "Narrow screens",
				items: [
					{name: "Stack columns on narrow screens", desc: "Place columns below each other when the layout is narrower than the breakpoint, such as on phones or in narrow panes.", aliases: ["mobile"], control: {type: "toggle", key: "stackOnNarrowScreens"}},
					{name: "Narrow screen breakpoint", desc: "Layouts narrower than this width are stacked.", visible: () => settings.stackOnNarrowScreens, control: {type: "slider", key: "narrowBreakpointPx", min: 300, max: 1200, step: 20, displayFormat: (v) => `${v}px`}},
				],
			},
			mocSettingsPage(this.app, this.plugin, MOC_PAGE_NAME, refresh),
			{
				type: "page",
				name: "Appearance",
				desc: "Default container, border and divider styles.",
				items: [
					{
						type: "group",
						heading: "Style target",
						items: [
							{name: "Apply styles to", desc: "Apply global style settings to all columns or a specific column index.", control: {type: "dropdown", key: "styleTargetMode", options: STYLE_TARGET_OPTIONS}},
							{name: "Column index", desc: "1 = first column in each layout.", visible: () => settings.styleTargetMode === "specific", control: {type: "slider", key: "styleTargetColumnIndex", min: 1, max: 12, step: 1}},
						],
					},
					{
						type: "group",
						heading: "Container",
						items: [
							{name: "Background", desc: "Background color for the column container.", control: {type: "dropdown", key: "containerBackground", options: BACKGROUND_OPTIONS}},
							{name: "Show border", desc: "Draw a border around the container.", control: {type: "toggle", key: "showContainerBorder"}},
							{name: "Border color", control: {type: "dropdown", key: "containerBorderColor", options: STYLE_COLOR_OPTIONS}},
							{name: "Border width", desc: "Thickness in pixels.", control: {type: "slider", key: "containerBorderWidthPx", min: 0, max: 8, step: 1, displayFormat: (v) => `${v}px`}},
							{name: "Corner radius", desc: "Rounding in pixels.", control: {type: "slider", key: "containerCornerRadiusPx", min: 0, max: 24, step: 1, displayFormat: (v) => `${v}px`}},
							{name: "Text color", control: {type: "dropdown", key: "containerTextColor", options: STYLE_COLOR_OPTIONS}},
						],
					},
					{
						type: "group",
						heading: "Vertical dividers",
						items: [
							{name: "Divider width", desc: "Width of the vertical line in pixels.", control: {type: "slider", key: "verticalDividerWidthPx", min: 0, max: 8, step: 1, displayFormat: (v) => `${v}px`}},
							{name: "Divider style", control: {type: "dropdown", key: "verticalDividerStyle", options: DIVIDER_STYLE_OPTIONS}},
							{name: "Divider color", control: {type: "dropdown", key: "verticalDividerColor", options: STYLE_COLOR_OPTIONS}},
						],
					},
				],
			},
			{
				type: "page",
				name: "Column headers",
				desc: "Styled headers written as !type: title on the first line of a column.",
				items: [
					{
						type: "group",
						items: [
							{name: "Enable column headers", desc: "Parse !type: title syntax as styled headers in columns.", control: {type: "toggle", key: "enableHeaders"}},
						],
					},
					headerTypesList(this.app, this.plugin, refresh),
				],
			},
			{
				type: "group",
				heading: "About",
				items: [
					{name: "About", searchable: false, render: (setting) => renderAbout(setting, this.plugin)},
				],
			},
		];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		const settings = this.plugin.settings as unknown as Record<string, unknown>;
		settings[key] = value;
		await this.plugin.saveSettings();

		const changed = key as keyof ColumnsPluginSettings;
		if (changed === "foldNotePropertiesByDefault" && value === true) {
			this.plugin.collapsePropertiesInOpenNotes();
		}
		if (changed === "enableMoc" && value === true) {
			this.plugin.mocSync.refreshSoon();
		}
	}
}
