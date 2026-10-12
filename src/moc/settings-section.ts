import {App, Setting, SettingDefinitionPage, SettingGroup, SettingPage} from "obsidian";
import type ColumnsPlugin from "../main";
import {describeMocTemplate, MocForm} from "./form";
import {createMocTemplate, MocTemplate, newMocTemplateId} from "./types";

/**
 * "MOC" settings page: the feature toggle and reusable MOC templates, each
 * edited on its own page. MOCs built with "New MOC…" for a single note are
 * edited from that note (right-click → Edit MOC) instead.
 */
export function mocSettingsPage(app: App, plugin: ColumnsPlugin, name: string, refresh: () => void): SettingDefinitionPage {
	const enabled = () => plugin.settings.enableMoc;
	const templates = plugin.settings.mocTemplates.filter((t) => !t.inline);
	const save = async () => {
		await plugin.saveSettings();
		plugin.mocSync.refreshSoon();
	};
	const remove = (template: MocTemplate) => {
		const all = plugin.settings.mocTemplates;
		const index = all.indexOf(template);
		if (index < 0) return;
		all.splice(index, 1);
		void save().then(refresh);
	};

	return {
		type: "page",
		name,
		desc: "MOCs: lists of note links in columns that update themselves.",
		displayValue: () => {
			if (!enabled()) return "Off";
			return `${templates.length} template${templates.length === 1 ? "" : "s"}`;
		},
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
						const template = createMocTemplate(newMocTemplateId(all), `MOC ${templates.length + 1}`);
						all.push(template);
						void save().then(() => {
							refresh();
							openSettingsPage(app, plugin, [name, pageName(template, [...templates, template])]);
						});
					},
				},
				onDelete: (index) => {
					const template = templates[index];
					if (template) remove(template);
				},
				items: templates.map((template): SettingDefinitionPage => ({
					type: "page",
					name: pageName(template, templates),
					desc: describeMocTemplate(template),
					page: () => new MocTemplatePage(app, plugin, template, save, () => {
						remove(template);
						openSettingsPage(app, plugin, [name]);
					}, refresh),
				})),
			},
		],
	};
}

/** Editor for one template: the MOC form and a delete button. */
class MocTemplatePage extends SettingPage {
	private form: MocForm | null = null;

	constructor(
		private readonly app: App,
		private readonly plugin: ColumnsPlugin,
		private readonly template: MocTemplate,
		private readonly save: () => Promise<void>,
		private readonly remove: () => void,
		private readonly refresh: () => void,
	) {
		super();
		this.title = template.name || template.id;
	}

	display(): void {
		const {containerEl, template} = this;
		containerEl.empty();
		this.form?.unload();
		this.form = new MocForm(containerEl.createDiv(), {
			app: this.app,
			plugin: this.plugin,
			template,
			// Note-relative folders preview against the note that is open.
			sourcePath: this.app.workspace.getActiveFile()?.path,
			showName: true,
			onChange: () => this.save(),
		});
		this.form.load();

		new Setting(new SettingGroup(containerEl).listEl)
			.setName("Delete template")
			.setDesc("MOCs already inserted from it stay in your notes as ordinary columns and are no longer updated.")
			.addButton((btn) => btn
				.setButtonText("Delete")
				.setDestructive()
				.onClick(() => this.remove()));
	}

	hide(): void {
		this.form?.unload();
		this.form = null;
		super.hide();
		// The list shows the template's name and summary, which may have changed.
		this.refresh();
	}
}

/** Open a page of this plugin's settings (not in the public API). */
function openSettingsPage(app: App, plugin: ColumnsPlugin, path: string[]): void {
	const setting = (app as App & {setting?: {openPagePath?(id: string, path: string[]): unknown}}).setting;
	setting?.openPagePath?.(plugin.manifest.id, path);
}

/** Page label; Obsidian keys rows by name, so repeated names get the id. */
function pageName(template: MocTemplate, templates: MocTemplate[]): string {
	const label = template.name || template.id;
	const repeated = templates.some((t) => t !== template && (t.name || t.id) === label);
	return repeated ? `${label} (${template.id})` : label;
}
