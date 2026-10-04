import {App, Setting} from "obsidian";
import type ColumnsPlugin from "../main";
import {describeMocTemplate, MocForm} from "./form";
import {createMocTemplate, MocTemplate, newMocTemplateId} from "./types";

/**
 * "MOC" settings tab: reusable MOC templates. MOCs built with "New MOC…" for a
 * single note are edited from that note (right-click → Edit MOC) instead.
 */
export class MocSettingsSection {
	private expandedId: string | null = null;
	private form: MocForm | null = null;

	constructor(private readonly app: App, private readonly plugin: ColumnsPlugin) {}

	/** Release preview renders (call when the settings tab closes). */
	dispose(): void {
		this.form?.unload();
		this.form = null;
	}

	render(panelEl: HTMLElement): void {
		panelEl.empty();
		this.dispose();

		new Setting(panelEl)
			.setName("Enable MOC")
			.setDesc("Show MOC menus and commands, and keep inserted MOCs up to date. "
				+ "When off, inserted MOCs stay in your notes as ordinary columns and are not updated.")
			.addToggle((toggle) => toggle
				.setValue(this.plugin.settings.enableMoc)
				.onChange(async (value) => {
					this.plugin.settings.enableMoc = value;
					await this.plugin.saveSettings();
					if (value) this.plugin.mocSync.refreshSoon();
					this.render(panelEl);
				}));
		if (!this.plugin.settings.enableMoc) return;

		new Setting(panelEl).setName("Templates").setHeading();
		panelEl.createEl("p", {
			cls: "setting-item-description",
			text: "A MOC (map of content) lists notes from a folder, tags or properties as links in columns, "
				+ "and updates itself when notes are added, renamed, deleted or retagged. "
				+ "Build a one-off MOC with Insert MOC → New MOC in the editor context menu, "
				+ "or save reusable templates here.",
		});

		const templates = this.plugin.settings.mocTemplates.filter((t) => !t.inline);
		for (const template of templates) {
			this.renderTemplate(panelEl, template);
		}

		new Setting(panelEl).addButton((btn) => btn
			.setButtonText("Add MOC template")
			.setCta()
			.onClick(async () => {
				const all = this.plugin.settings.mocTemplates;
				const id = newMocTemplateId(all);
				all.push(createMocTemplate(id, `MOC ${templates.length + 1}`));
				this.expandedId = id;
				await this.save();
				this.render(panelEl);
			}));
	}

	private async save(): Promise<void> {
		await this.plugin.saveSettings();
		this.plugin.mocSync.refreshSoon();
	}

	private renderTemplate(panelEl: HTMLElement, template: MocTemplate): void {
		const card = panelEl.createDiv({cls: "amc-moc-card"});
		const expanded = this.expandedId === template.id;

		new Setting(card)
			.setName(template.name || template.id)
			.setDesc(describeMocTemplate(template))
			.addExtraButton((btn) => btn
				.setIcon(expanded ? "chevron-up" : "pencil")
				.setTooltip(expanded ? "Close" : "Edit")
				.onClick(() => {
					this.expandedId = expanded ? null : template.id;
					this.render(panelEl);
				}))
			.addExtraButton((btn) => btn
				.setIcon("trash-2")
				.setTooltip("Delete template")
				.onClick(async () => {
					const list = this.plugin.settings.mocTemplates;
					list.splice(list.indexOf(template), 1);
					if (this.expandedId === template.id) this.expandedId = null;
					await this.save();
					this.render(panelEl);
				}));
		if (!expanded) return;

		const body = card.createDiv({cls: "amc-moc-card-body"});
		this.form = new MocForm(body, {
			app: this.app,
			plugin: this.plugin,
			template,
			// Note-relative folders preview against the note that is open.
			sourcePath: this.app.workspace.getActiveFile()?.path,
			showName: true,
			onChange: () => this.save(),
		});
		this.form.load();
	}
}
