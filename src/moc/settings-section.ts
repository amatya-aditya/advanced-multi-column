import {App, Setting, SettingDefinitionPage} from "obsidian";
import type ColumnsPlugin from "../main";
import {describeMocTemplate, MocForm} from "./form";
import {createMocTemplate, MocTemplate, newMocTemplateId} from "./types";

/** Template whose form is open; kept across re-renders of the page. */
let expandedTemplateId: string | null = null;

/**
 * "MOC" settings page: the feature toggle and reusable MOC templates. MOCs
 * built with "New MOC…" for a single note are edited from that note
 * (right-click → Edit MOC) instead.
 */
export function mocSettingsPage(app: App, plugin: ColumnsPlugin, name: string, refresh: () => void): SettingDefinitionPage {
	const enabled = () => plugin.settings.enableMoc;
	const templates = plugin.settings.mocTemplates.filter((t) => !t.inline);
	const save = async () => {
		await plugin.saveSettings();
		plugin.mocSync.refreshSoon();
	};

	return {
		type: "page",
		name,
		desc: "Maps of content: note links in columns that update themselves.",
		displayValue: () => (enabled() ? "On" : "Off"),
		items: [
			{
				type: "group",
				items: [
					{
						name: "Enable MOC",
						desc: "Show MOC menus and commands, and keep inserted MOCs up to date. "
							+ "When off, inserted MOCs stay in your notes as ordinary columns and are not updated.",
						aliases: ["map of content"],
						control: {type: "toggle", key: "enableMoc"},
					},
				],
			},
			{
				type: "list",
				heading: "Templates",
				visible: enabled,
				emptyState: "No templates yet. Build a one-off MOC with Insert MOC → New MOC in the editor context menu, "
					+ "or add a reusable template here.",
				addItem: {
					name: "Add MOC template",
					action: () => {
						const all = plugin.settings.mocTemplates;
						const id = newMocTemplateId(all);
						all.push(createMocTemplate(id, `MOC ${templates.length + 1}`));
						expandedTemplateId = id;
						void save().then(refresh);
					},
				},
				onDelete: (index) => {
					const template = templates[index];
					if (!template) return;
					const all = plugin.settings.mocTemplates;
					all.splice(all.indexOf(template), 1);
					if (expandedTemplateId === template.id) expandedTemplateId = null;
					void save().then(refresh);
				},
				items: templates.map((template) => ({
					name: uniqueLabel(template, templates),
					desc: describeMocTemplate(template),
					aliases: ["MOC template"],
					render: (setting: Setting) => renderTemplate(app, plugin, setting, template, save, refresh),
				})),
			},
		],
	};
}

function renderTemplate(
	app: App,
	plugin: ColumnsPlugin,
	setting: Setting,
	template: MocTemplate,
	save: () => Promise<void>,
	refresh: () => void,
): (() => void) | void {
	const expanded = expandedTemplateId === template.id;
	setting.settingEl.addClass("amc-settings-card");
	setting
		.setName(template.name || template.id)
		.setDesc(describeMocTemplate(template))
		.addExtraButton((btn) => btn
			.setIcon(expanded ? "chevron-up" : "pencil")
			.setTooltip(expanded ? "Close" : "Edit")
			.onClick(() => {
				expandedTemplateId = expanded ? null : template.id;
				refresh();
			}));
	if (!expanded) return;

	const body = setting.settingEl.createDiv({cls: "amc-settings-card-body amc-moc-card-body"});
	const form = new MocForm(body, {
		app,
		plugin,
		template,
		// Note-relative folders preview against the note that is open.
		sourcePath: app.workspace.getActiveFile()?.path,
		showName: true,
		onChange: async () => {
			await save();
			setting.setName(template.name || template.id).setDesc(describeMocTemplate(template));
		},
	});
	form.load();
	// Obsidian reuses the row when the page re-renders and only clears its own
	// controls, so the editor added below the row is removed here.
	return () => {
		form.unload();
		body.remove();
	};
}

/** Row label; Obsidian keys rows by name, so repeated names get the id. */
function uniqueLabel(template: MocTemplate, templates: MocTemplate[]): string {
	const label = template.name || template.id;
	const repeated = templates.some((t) => t !== template && (t.name || t.id) === label);
	return repeated ? `${label} (${template.id})` : label;
}
