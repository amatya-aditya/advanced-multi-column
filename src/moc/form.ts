import {App, Component, debounce, Setting, SettingGroup} from "obsidian";
import type ColumnsPlugin from "../main";
import {findColumnRegions} from "../column/core/parser";
import {renderColumnsRegion} from "../column/reading-view";
import {FolderSuggest, ListSuggest, renderChips, VaultVocabulary} from "./form-pickers";
import {collectMocGroups, resolveMocFolder} from "./query";
import {generateMocBlock, mocColumnCount} from "./generate";
import {
	MAX_MOC_COLUMNS,
	MocFolderMode,
	MocGroupBy,
	MocMatch,
	MocSort,
	MocTemplate,
} from "./types";

const PREVIEW_LIMIT = 8;

const FOLDER_MODE_OPTIONS: Record<MocFolderMode, string> = {
	note: "This note's folder",
	parent: "Parent of this note's folder",
	fixed: "A specific folder",
	none: "Any folder",
};

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

/** What the reverse toggle does for each sort, shown under it. */
const REVERSE_SORT_DESC: Record<MocSort, string> = {
	name: "Off: A to Z. On: Z to A.",
	modified: "Off: most recently modified first. On: least recently modified first.",
	created: "Off: newest first. On: oldest first.",
};

const MATCH_OPTIONS: Record<MocMatch, string> = {
	all: "Every source",
	any: "Any source",
};

/** Sections of the form, shown one at a time. */
type MocFormTab = "sources" | "groups" | "list";

const TABS: Array<{id: MocFormTab; label: string; summary: (t: MocTemplate) => string}> = [
	{id: "sources", label: "Sources", summary: summarizeSources},
	{id: "groups", label: "Groups", summary: summarizeGroups},
	{id: "list", label: "List", summary: summarizeList},
];

/** Number of separate conditions a note is checked against. */
function sourceCount(template: MocTemplate): number {
	return (template.folderMode === "none" ? 0 : 1) + template.tags.length
		+ template.properties.filter((p) => p.key.trim()).length;
}

function summarizeSources(template: MocTemplate): string {
	const parts: string[] = [];
	if (template.folderMode === "fixed") parts.push(template.folder.trim() || "No folder yet");
	else if (template.folderMode !== "none") parts.push(template.folderMode === "note" ? "This folder" : "Parent folder");
	if (template.tags.length > 0) parts.push(`${template.tags.length} tag${template.tags.length === 1 ? "" : "s"}`);
	const props = template.properties.length;
	if (props > 0) parts.push(`${props} propert${props === 1 ? "y" : "ies"}`);
	return parts.length > 0 ? parts.join(" + ") : "Nothing selected";
}

function summarizeGroups(template: MocTemplate): string {
	const by = template.groupBy === "none" ? "No groups" : `By ${GROUP_BY_OPTIONS[template.groupBy].toLowerCase()}`;
	return `${by}, ${template.columns} column${template.columns === 1 ? "" : "s"}`;
}

function summarizeList(template: MocTemplate): string {
	const order: Record<MocSort, [string, string]> = {
		name: ["A to Z", "Z to A"],
		modified: ["Recently modified", "Least recently modified"],
		created: ["Newest", "Oldest"],
	};
	return order[template.sort][template.sortReverse ? 1 : 0];
}

export interface MocFormOptions {
	app: App;
	plugin: ColumnsPlugin;
	template: MocTemplate;
	/**
	 * Note the MOC lives in (resolves "this note's folder" and the preview).
	 * Templates in settings preview against the active note.
	 */
	sourcePath?: string;
	/** Show the name field (templates); single MOCs don't need one. */
	showName: boolean;
	/** Persist after every change (settings) or only on submit (dialog). */
	onChange: () => Promise<void> | void;
}

/**
 * The MOC options form, shared by the template settings page and the MOC
 * builder dialog. The options are split into tabs (sources, groups, list)
 * above a live preview. Mutates `template` in place.
 */
export class MocForm extends Component {
	private vocabulary: VaultVocabulary | null = null;
	private previewComponent: Component | null = null;
	private refreshDerived: () => void = () => {};
	private tab: MocFormTab = "sources";
	private tabsEl: HTMLElement | null = null;

	constructor(private readonly host: HTMLElement, private readonly opts: MocFormOptions) {
		super();
		host.addClass("amc-moc-form");
	}

	onload(): void {
		this.render();
	}

	onunload(): void {
		this.previewComponent?.unload();
		this.previewComponent = null;
	}

	private get vocab(): VaultVocabulary {
		this.vocabulary ??= new VaultVocabulary(this.opts.app);
		return this.vocabulary;
	}

	private render(): void {
		const {template} = this.opts;
		const scrollEl = this.host.closest(".vertical-tab-content, .amc-moc-builder-form");
		const scrollTop = scrollEl?.scrollTop ?? 0;
		this.host.empty();
		const body = this.host;
		const previewEl = createDiv({cls: "amc-moc-preview"});
		const assignmentsEl = createDiv();
		const refresh = debounce(() => {
			if (this.tab === "groups") this.renderAssignments(assignmentsEl);
			this.renderPreview(previewEl);
		}, 250, true);
		this.refreshDerived = refresh;
		const change = async () => {
			await this.opts.onChange();
			if (this.tabsEl) this.renderTabs(this.tabsEl);
			refresh();
		};
		const changeAndRerender = async () => {
			await this.opts.onChange();
			this.render();
		};

		if (this.opts.showName) {
			new Setting(section(body)).setName("Name").addText((text) => text
				.setValue(template.name)
				.onChange(async (value) => {
					template.name = value;
					await this.opts.onChange();
				}));
		}

		this.tabsEl = body.createDiv({cls: "amc-moc-tabs", attr: {role: "tablist"}});
		this.renderTabs(this.tabsEl);
		const panel = body.createDiv({cls: "amc-moc-tab-panel", attr: {role: "tabpanel"}});
		if (this.tab === "sources") this.renderSources(section(panel), change, changeAndRerender);
		else if (this.tab === "groups") this.renderGroups(panel, assignmentsEl, change, changeAndRerender);
		else this.renderList(section(panel), change);

		const preview = new SettingGroup(body).setHeading("Preview").addClass("amc-moc-preview-group");
		preview.listEl.replaceWith(previewEl);
		refresh();
		if (scrollEl) scrollEl.scrollTop = scrollTop;
	}

	private renderTabs(el: HTMLElement): void {
		const {template} = this.opts;
		el.empty();
		for (const tab of TABS) {
			const selected = tab.id === this.tab;
			const button = el.createEl("button", {
				cls: "amc-moc-tab",
				attr: {role: "tab", "aria-selected": String(selected), tabindex: selected ? "0" : "-1"},
			});
			button.toggleClass("is-active", selected);
			button.createSpan({cls: "amc-moc-tab-label", text: tab.label});
			button.createSpan({cls: "amc-moc-tab-summary", text: tab.summary(template)});
			button.addEventListener("click", () => this.selectTab(tab.id));
			button.addEventListener("keydown", (evt) => {
				if (evt.key !== "ArrowRight" && evt.key !== "ArrowLeft") return;
				evt.preventDefault();
				const index = TABS.findIndex((t) => t.id === tab.id);
				const next = TABS[(index + (evt.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length]!;
				this.selectTab(next.id);
				this.host.querySelector<HTMLElement>(".amc-moc-tab.is-active")?.focus();
			});
		}
	}

	private selectTab(tab: MocFormTab): void {
		if (tab === this.tab) return;
		this.tab = tab;
		this.render();
	}

	// ── Sources ──

	private renderSources(body: HTMLElement, change: () => Promise<void>, changeAndRerender: () => Promise<void>): void {
		const {app, template} = this.opts;
		new Setting(body)
			.setName("Folder")
			.setDesc(template.folderMode === "note" || template.folderMode === "parent"
				? "Resolved from the note the MOC is in, so the same MOC works in any folder."
				: "")
			.addDropdown((dd) => dd
				.addOptions(FOLDER_MODE_OPTIONS)
				.setValue(template.folderMode)
				.onChange(async (value) => {
					template.folderMode = value as MocFolderMode;
					await changeAndRerender();
				}));
		if (template.folderMode === "fixed") {
			new Setting(body)
				.setName("Folder path")
				.setDesc("Use / for the whole vault.")
				.addText((text) => {
					text.setPlaceholder("Projects").setValue(template.folder);
					new FolderSuggest(app, text.inputEl, (folder) => {
						template.folder = folder.path;
						void change();
					});
					text.onChange(async (value) => {
						template.folder = value;
						await change();
					});
				});
		}
		if (template.folderMode !== "none") {
			new Setting(body).setName("Include subfolders").addToggle((toggle) => toggle
				.setValue(template.includeSubfolders)
				.onChange(async (value) => {
					template.includeSubfolders = value;
					await change();
				}));
		}

		this.renderTagPicker(body, changeAndRerender);
		this.renderPropertyPicker(body, changeAndRerender);

		// Only meaningful once there is more than one condition to combine.
		if (sourceCount(template) > 1) {
			new Setting(body)
				.setName("Notes must match")
				.setDesc("Whether a note needs every folder, tag and property above, or just one of them.")
				.addDropdown((dd) => dd
					.addOptions(MATCH_OPTIONS)
					.setValue(template.match)
					.onChange(async (value) => {
						template.match = value as MocMatch;
						await change();
					}));
		}
	}

	private renderTagPicker(body: HTMLElement, onChange: () => Promise<void>): void {
		const {app, template} = this.opts;
		const setting = new Setting(body)
			.setName("Tags")
			.setDesc("Notes with these tags. A tag also matches its subtags.");
		const add = async (raw: string) => {
			const tag = raw.trim().replace(/^#/, "");
			if (!tag || template.tags.includes(tag)) return;
			template.tags.push(tag);
			await onChange();
		};
		setting.addText((text) => {
			text.setPlaceholder("Add a tag");
			new ListSuggest(app, text.inputEl, () => this.vocab.tags.filter((t) => !template.tags.includes(t)),
				(tag) => void add(tag));
			text.inputEl.addEventListener("keydown", (evt) => {
				if (evt.key !== "Enter") return;
				evt.preventDefault();
				void add(text.getValue());
			});
		});
		if (template.tags.length > 0) {
			renderChips(setting.descEl, template.tags.map((t) => `#${t}`), (index) => {
				template.tags.splice(index, 1);
				void onChange();
			});
		}
	}

	private renderPropertyPicker(body: HTMLElement, onChange: () => Promise<void>): void {
		const {app, template} = this.opts;
		const setting = new Setting(body)
			.setName("Properties")
			.setDesc("Notes whose property has this value. Leave the value empty to only require the property.");
		setting.settingEl.addClass("amc-moc-property-picker");
		let key = "";
		let value = "";
		let valueInput: HTMLInputElement | null = null;
		const add = async () => {
			const k = key.trim();
			if (!k) return;
			template.properties.push({key: k, value: value.trim()});
			await onChange();
		};
		setting.addText((text) => {
			text.setPlaceholder("Property");
			new ListSuggest(app, text.inputEl, () => this.vocab.propertyKeys, (picked) => {
				key = picked;
				valueInput?.focus();
			});
			text.onChange((v) => {
				key = v;
			});
		});
		setting.addText((text) => {
			valueInput = text.inputEl;
			text.setPlaceholder("Value (optional)");
			new ListSuggest(app, text.inputEl, () => this.vocab.propertyValues(key.trim()), (picked) => {
				value = picked;
			});
			text.onChange((v) => {
				value = v;
			});
			text.inputEl.addEventListener("keydown", (evt) => {
				if (evt.key !== "Enter") return;
				evt.preventDefault();
				void add();
			});
		});
		setting.addExtraButton((btn) => btn
			.setIcon("plus")
			.setTooltip("Add property")
			.onClick(() => void add()));
		if (template.properties.length > 0) {
			renderChips(
				setting.descEl,
				template.properties.map((p) => (p.value ? `${p.key}: ${p.value}` : p.key)),
				(index) => {
					template.properties.splice(index, 1);
					void onChange();
				},
			);
		}
	}

	// ── Groups ──

	private renderGroups(
		panel: HTMLElement,
		assignmentsEl: HTMLElement,
		change: () => Promise<void>,
		changeAndRerender: () => Promise<void>,
	): void {
		const {app, template} = this.opts;
		const body = section(panel);
		new Setting(body)
			.setName("Group by")
			.setDesc("Each group gets its own heading and is placed in a column.")
			.addDropdown((dd) => dd
				.addOptions(GROUP_BY_OPTIONS)
				.setValue(template.groupBy)
				.onChange(async (value) => {
					template.groupBy = value as MocGroupBy;
					await changeAndRerender();
				}));
		if (template.groupBy === "property") {
			new Setting(body).setName("Group property").addText((text) => {
				text.setPlaceholder("Status").setValue(template.groupProperty);
				new ListSuggest(app, text.inputEl, () => this.vocab.propertyKeys, (key) => {
					template.groupProperty = key;
					void change();
				});
				text.onChange(async (value) => {
					template.groupProperty = value.trim();
					await change();
				});
			});
		}
		new Setting(body)
			.setName("Columns")
			.setDesc(template.groupBy === "none"
				? "The list is split evenly across the columns."
				: "With fewer groups than columns, fewer columns are used.")
			.addSlider((slider) => slider
				.setLimits(1, MAX_MOC_COLUMNS, 1)
				.setValue(template.columns)
				.onChange(async (value) => {
					template.columns = value;
					await change();
				}));
		if (template.groupBy === "none") return;

		new Setting(body).setName("Show group headings").addToggle((toggle) => toggle
			.setValue(template.showHeadings)
			.onChange(async (value) => {
				template.showHeadings = value;
				await change();
			}));
		const heading = createFragment((f) => {
			f.appendText("Column for each group");
			f.createDiv({
				cls: "setting-item-description",
				text: "Groups found right now. Automatic places a group in the shortest column.",
			});
		});
		const assignments = new SettingGroup(panel).setHeading(heading);
		assignmentsEl.addClass("setting-items");
		assignments.listEl.replaceWith(assignmentsEl);
	}

	private renderAssignments(el: HTMLElement): void {
		const {app, template, sourcePath} = this.opts;
		el.empty();
		if (template.groupBy === "none") return;
		const groups = collectMocGroups(app, template, sourcePath);
		if (groups.length === 0) {
			el.createDiv({cls: "setting-item-description", text: "No matching notes yet."});
			return;
		}
		const count = Math.max(1, Math.min(MAX_MOC_COLUMNS, template.columns));
		// Column keys are not plain numbers: objects list integer keys first,
		// which would put "Automatic" after the columns.
		const options: Record<string, string> = {auto: "Automatic"};
		for (let i = 0; i < count; i++) options[`col-${i}`] = `Column ${i + 1}`;
		for (const group of groups) {
			const assigned = template.assignments[group.name];
			new Setting(el)
				.setName(group.name)
				.setDesc(`${group.files.length} note${group.files.length === 1 ? "" : "s"}`)
				.addDropdown((dd) => dd
					.addOptions(options)
					.setValue(assigned !== undefined && assigned < count ? `col-${assigned}` : "auto")
					.onChange(async (value) => {
						if (value === "auto") delete template.assignments[group.name];
						else template.assignments[group.name] = parseInt(value.slice("col-".length), 10);
						await this.opts.onChange();
						this.refreshDerived();
					}));
		}
	}

	// ── List ──

	private renderList(body: HTMLElement, change: () => Promise<void>): void {
		const {template} = this.opts;
		const sortSetting = new Setting(body).setName("Sort notes by");
		const reverseSetting = new Setting(body)
			.setName("Reverse sort order")
			.setDesc(REVERSE_SORT_DESC[template.sort])
			.addToggle((toggle) => toggle
				.setValue(template.sortReverse)
				.onChange(async (value) => {
					template.sortReverse = value;
					await change();
				}));
		sortSetting.addDropdown((dd) => dd
			.addOptions(SORT_OPTIONS)
			.setValue(template.sort)
			.onChange(async (value) => {
				template.sort = value as MocSort;
				reverseSetting.setDesc(REVERSE_SORT_DESC[template.sort]);
				await change();
			}));
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
			.setName(template.groupBy === "none" ? "Maximum notes" : "Notes per group")
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
	}

	// ── Preview ──

	private renderPreview(el: HTMLElement): void {
		const {app, plugin, template, sourcePath} = this.opts;
		this.previewComponent?.unload();
		const component = new Component();
		component.load();
		this.previewComponent = component;
		el.empty();

		const folder = resolveMocFolder(template, sourcePath);
		const relative = template.folderMode === "note" || template.folderMode === "parent";
		if (relative && sourcePath === undefined) {
			el.createDiv({cls: "amc-moc-preview-empty", text: "Open a note to preview a MOC relative to its folder."});
			return;
		}
		const groups = collectMocGroups(app, template, sourcePath, PREVIEW_LIMIT);
		const where = relative ? ` Folder: ${folder === "" ? "/" : folder} (from ${sourcePath}).` : "";
		if (groups.length === 0) {
			el.createDiv({cls: "amc-moc-preview-empty", text: `No notes match these sources.${where}`});
			return;
		}
		el.createDiv({
			cls: "setting-item-description",
			text: `${mocColumnCount(template, groups)} column(s), up to ${PREVIEW_LIMIT} notes per group.${where}`,
		});
		const block = generateMocBlock(app, template, sourcePath ?? "", undefined, PREVIEW_LIMIT);
		const region = findColumnRegions(block)[0];
		if (!region) return;
		const previewHost = el.createDiv({cls: "markdown-rendered amc-moc-preview-body"});
		void renderColumnsRegion(plugin, component, previewHost, region, sourcePath ?? "");
	}
}

/** A card of settings, styled like Obsidian's own groups; returns its list. */
function section(parent: HTMLElement): HTMLElement {
	return new SettingGroup(parent).listEl;
}

/** One-line summary of a template's sources and layout. */
export function describeMocTemplate(template: MocTemplate): string {
	const sources: string[] = [];
	if (template.folderMode === "fixed" && template.folder.trim()) {
		sources.push(`${template.folder}${template.includeSubfolders ? " (with subfolders)" : ""}`);
	} else if (template.folderMode === "note" || template.folderMode === "parent") {
		sources.push(`${FOLDER_MODE_OPTIONS[template.folderMode]}${template.includeSubfolders ? " (with subfolders)" : ""}`);
	}
	if (template.tags.length > 0) sources.push(template.tags.map((t) => `#${t}`).join(" "));
	if (template.properties.length > 0) sources.push(template.properties.map((p) => p.key).join(", "));
	const what = sources.length > 0 ? sources.join(template.match === "all" ? " + " : " or ") : "No sources yet";
	return `${what} · ${GROUP_BY_OPTIONS[template.groupBy]} · ${template.columns} column(s)`;
}
