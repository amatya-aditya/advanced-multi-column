import {AbstractInputSuggest, App, Component, debounce, Setting, TFolder} from "obsidian";
import type ColumnsPlugin from "../main";
import {findColumnRegions} from "../column/core/parser";
import {renderColumnsRegion} from "../column/reading-view";
import {collectMocGroups} from "./query";
import {generateMocBlock, mocColumnCount} from "./generate";
import {
	createMocTemplate,
	MAX_MOC_COLUMNS,
	MocGroupBy,
	MocMatch,
	MocSort,
	MocTemplate,
	newMocTemplateId,
} from "./types";

const PREVIEW_LIMIT = 8;

const GROUP_BY_OPTIONS: Record<MocGroupBy, string> = {
	none: "No grouping",
	subfolder: "Subfolder",
	tag: "Tag",
	property: "Property value",
};

const SORT_OPTIONS: Record<MocSort, string> = {
	name: "Name",
	modified: "Last modified",
	created: "Created",
};

const MATCH_OPTIONS: Record<MocMatch, string> = {
	all: "Match all sources",
	any: "Match any source",
};

class FolderSuggest extends AbstractInputSuggest<TFolder> {
	private onPick: ((folder: TFolder) => void) | null = null;

	constructor(app: App, private readonly input: HTMLInputElement) {
		super(app, input);
	}

	getSuggestions(query: string): TFolder[] {
		const q = query.toLowerCase();
		return this.app.vault.getAllLoadedFiles()
			.filter((f): f is TFolder => f instanceof TFolder)
			.filter((f) => f.path.toLowerCase().includes(q))
			.slice(0, 50);
	}

	renderSuggestion(folder: TFolder, el: HTMLElement): void {
		el.setText(folder.path === "/" ? "/ (vault root)" : folder.path);
	}

	selectSuggestion(folder: TFolder): void {
		this.input.value = folder.path;
		this.onPick?.(folder);
		this.close();
	}

	onSelected(cb: (folder: TFolder) => void): this {
		this.onPick = cb;
		return this;
	}
}

function parseList(value: string): string[] {
	return value.split(",").map((v) => v.trim()).filter(Boolean);
}

function parseProperties(value: string): MocTemplate["properties"] {
	return value
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => {
			const sep = line.indexOf(":");
			return sep < 0
				? {key: line, value: ""}
				: {key: line.slice(0, sep).trim(), value: line.slice(sep + 1).trim()};
		})
		.filter((p) => p.key.length > 0);
}

/**
 * "MOC" settings tab: manage MOC templates with a live preview of the column
 * block each template generates from the current vault.
 */
export class MocSettingsSection {
	private expandedId: string | null = null;
	private previewComponent: Component | null = null;

	constructor(private readonly app: App, private readonly plugin: ColumnsPlugin) {}

	/** Release preview renders (call when the settings tab closes). */
	dispose(): void {
		this.previewComponent?.unload();
		this.previewComponent = null;
	}

	render(panelEl: HTMLElement): void {
		panelEl.empty();
		this.dispose();

		new Setting(panelEl).setName("Templates").setHeading();
		panelEl.createEl("p", {
			cls: "setting-item-description",
			text: "A MOC (map of content) lists notes from a folder, tags or properties as links in columns. "
				+ "Insert one with the Insert MOC command or from the editor context menu. "
				+ "Inserted MOCs update automatically when notes are added, renamed, deleted or retagged.",
		});

		const templates = this.plugin.settings.mocTemplates;
		for (const template of templates) {
			this.renderTemplate(panelEl, template);
		}

		new Setting(panelEl).addButton((btn) => btn
			.setButtonText("Add MOC template")
			.setCta()
			.onClick(async () => {
				const id = newMocTemplateId(templates);
				templates.push(createMocTemplate(id, `MOC ${templates.length + 1}`));
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
			.setDesc(this.describe(template))
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
		const previewEl = body.doc.createElement("div");
		const assignmentsEl = body.doc.createElement("div");
		const refresh = debounce(() => {
			this.renderAssignments(assignmentsEl, template, refresh);
			this.renderPreview(previewEl, template);
		}, 250, true);
		const change = async () => {
			await this.save();
			refresh();
		};

		new Setting(body).setName("Name").addText((text) => text
			.setValue(template.name)
			.onChange(async (value) => {
				template.name = value;
				await this.save();
			}));

		new Setting(body).setName("Sources").setHeading();
		new Setting(body)
			.setName("Folder")
			.setDesc("Leave empty to not filter by folder. Use / for the whole vault.")
			.addText((text) => {
				text.setPlaceholder("Projects").setValue(template.folder);
				new FolderSuggest(this.app, text.inputEl).onSelected((folder) => {
					template.folder = folder.path;
					void change();
				});
				text.onChange(async (value) => {
					template.folder = value;
					await change();
				});
			});
		new Setting(body).setName("Include subfolders").addToggle((toggle) => toggle
			.setValue(template.includeSubfolders)
			.onChange(async (value) => {
				template.includeSubfolders = value;
				await change();
			}));
		new Setting(body)
			.setName("Tags")
			.setDesc("Comma-separated, for example: project, area/work")
			.addText((text) => text
				.setPlaceholder("Project, area/work")
				.setValue(template.tags.join(", "))
				.onChange(async (value) => {
					template.tags = parseList(value);
					await change();
				}));
		new Setting(body)
			.setName("Properties")
			.setDesc("One per line as key: value, or just key to require the property.")
			.addTextArea((text) => text
				.setPlaceholder("Status: active")
				.setValue(template.properties.map((p) => (p.value ? `${p.key}: ${p.value}` : p.key)).join("\n"))
				.onChange(async (value) => {
					template.properties = parseProperties(value);
					await change();
				}));
		new Setting(body).setName("Combine sources").addDropdown((dd) => dd
			.addOptions(MATCH_OPTIONS)
			.setValue(template.match)
			.onChange(async (value) => {
				template.match = value as MocMatch;
				await change();
			}));

		new Setting(body).setName("Layout").setHeading();
		new Setting(body).setName("Group by").addDropdown((dd) => dd
			.addOptions(GROUP_BY_OPTIONS)
			.setValue(template.groupBy)
			.onChange(async (value) => {
				template.groupBy = value as MocGroupBy;
				await change();
				this.render(panelEl);
			}));
		if (template.groupBy === "property") {
			new Setting(body).setName("Group property").addText((text) => text
				.setPlaceholder("Status")
				.setValue(template.groupProperty)
				.onChange(async (value) => {
					template.groupProperty = value.trim();
					await change();
				}));
		}
		new Setting(body)
			.setName("Columns")
			.setDesc(template.groupBy === "none"
				? "The list is split evenly across the columns."
				: "Groups are placed into columns; with fewer groups, fewer columns are used.")
			.addSlider((slider) => slider
				.setLimits(1, MAX_MOC_COLUMNS, 1)
				.setValue(template.columns)
				.setDynamicTooltip()
				.onChange(async (value) => {
					template.columns = value;
					await change();
				}));
		new Setting(body).setName("Sort notes by").addDropdown((dd) => dd
			.addOptions(SORT_OPTIONS)
			.setValue(template.sort)
			.onChange(async (value) => {
				template.sort = value as MocSort;
				await change();
			}));
		if (template.groupBy !== "none") {
			new Setting(body).setName("Show group headings").addToggle((toggle) => toggle
				.setValue(template.showHeadings)
				.onChange(async (value) => {
					template.showHeadings = value;
					await change();
				}));
		}
		new Setting(body)
			.setName("Show bullets")
			.setDesc("List links as a bulleted list. When off, each link is on its own line without a bullet.")
			.addToggle((toggle) => toggle
				.setValue(template.showBullets)
				.onChange(async (value) => {
					template.showBullets = value;
					await change();
				}));
		new Setting(body)
			.setName("Notes per group")
			.setDesc("0 shows all notes.")
			.addText((text) => {
				text.inputEl.type = "number";
				text.inputEl.min = "0";
				text.setValue(String(template.maxPerGroup)).onChange(async (value) => {
					const n = parseInt(value, 10);
					template.maxPerGroup = Number.isFinite(n) && n > 0 ? n : 0;
					await change();
				});
			});

		if (template.groupBy !== "none") {
			new Setting(body)
				.setName("Column for each group")
				.setDesc("Groups found in the vault right now. Automatic places a group in the shortest column.")
				.setHeading();
			body.appendChild(assignmentsEl);
		}

		new Setting(body).setName("Preview").setHeading();
		previewEl.addClass("amc-moc-preview");
		body.appendChild(previewEl);
		refresh();
	}

	private describe(template: MocTemplate): string {
		const sources: string[] = [];
		if (template.folder.trim()) {
			sources.push(`${template.folder}${template.includeSubfolders ? " (with subfolders)" : ""}`);
		}
		if (template.tags.length > 0) sources.push(template.tags.map((t) => `#${t.replace(/^#/, "")}`).join(" "));
		if (template.properties.length > 0) sources.push(template.properties.map((p) => p.key).join(", "));
		const what = sources.length > 0 ? sources.join(template.match === "all" ? " + " : " or ") : "No sources yet";
		return `${what} · ${GROUP_BY_OPTIONS[template.groupBy]} · ${template.columns} column(s)`;
	}

	private renderAssignments(el: HTMLElement, template: MocTemplate, onChange: () => void): void {
		el.empty();
		if (template.groupBy === "none") return;
		const groups = collectMocGroups(this.app, template);
		if (groups.length === 0) {
			el.createDiv({cls: "setting-item-description", text: "No matching notes yet."});
			return;
		}
		const count = Math.max(1, Math.min(MAX_MOC_COLUMNS, template.columns));
		const options: Record<string, string> = {auto: "Automatic"};
		for (let i = 0; i < count; i++) options[String(i)] = `Column ${i + 1}`;
		for (const group of groups) {
			const assigned = template.assignments[group.name];
			new Setting(el)
				.setName(group.name)
				.setDesc(`${group.files.length} note${group.files.length === 1 ? "" : "s"}`)
				.addDropdown((dd) => dd
					.addOptions(options)
					.setValue(assigned !== undefined && assigned < count ? String(assigned) : "auto")
					.onChange(async (value) => {
						if (value === "auto") delete template.assignments[group.name];
						else template.assignments[group.name] = parseInt(value, 10);
						await this.save();
						onChange();
					}));
		}
	}

	private renderPreview(el: HTMLElement, template: MocTemplate): void {
		this.previewComponent?.unload();
		const component = new Component();
		component.load();
		this.previewComponent = component;
		el.empty();

		const groups = collectMocGroups(this.app, template, undefined, PREVIEW_LIMIT);
		if (groups.length === 0) {
			el.createDiv({cls: "amc-moc-preview-empty", text: "No notes match these sources."});
			return;
		}
		el.createDiv({
			cls: "setting-item-description",
			text: `${mocColumnCount(template, groups)} column(s). Showing up to ${PREVIEW_LIMIT} notes per group.`,
		});
		const block = generateMocBlock(this.app, template, "", undefined, PREVIEW_LIMIT);
		const region = findColumnRegions(block)[0];
		if (!region) return;
		const host = el.createDiv({cls: "markdown-rendered amc-moc-preview-body"});
		void renderColumnsRegion(this.plugin, component, host, region, "");
	}
}
