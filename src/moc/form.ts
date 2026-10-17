import {App, ButtonComponent, Component, debounce, DropdownComponent, ExtraButtonComponent, Setting, SettingGroup} from "obsidian";
import type ColumnsPlugin from "../main";
import {findColumnRegions} from "../column/core/parser";
import {renderColumnsRegion} from "../column/reading-view";
import {FolderSuggest, ListSuggest, VaultVocabulary} from "./form-pickers";
import {collectMocGroups, hasRelativeFolder, resolvedFolders, visibleMocGroups} from "./query";
import {generateMocBlock, mocColumnCount} from "./generate";
import {
	MAX_MOC_COLUMNS,
	MocFolderMode,
	MocGroupBy,
	MocRule,
	MocRuleOp,
	MocSort,
	MocTemplate,
} from "./types";

const PREVIEW_LIMIT = 8;

const FOLDER_MODE_OPTIONS: Record<MocFolderMode, string> = {
	note: "This note's folder",
	parent: "Parent of this note's folder",
	fixed: "A specific folder",
};

const OP_OPTIONS: Record<MocRuleOp, string> = {
	and: "And",
	or: "Or",
};

const RULE_NAMES: Record<MocRule["type"], string> = {
	folder: "Folder",
	tag: "Tag",
	property: "Property",
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

/** Sections of the form, shown one at a time. */
type MocFormTab = "sources" | "groups" | "list";

const TABS: Array<{id: MocFormTab; label: string; summary: (t: MocTemplate) => string}> = [
	{id: "sources", label: "Sources", summary: summarizeSources},
	{id: "groups", label: "Groups", summary: summarizeGroups},
	{id: "list", label: "List", summary: summarizeList},
];

function summarizeSources(template: MocTemplate): string {
	const count = (type: MocRule["type"]) => template.rules.filter((r) => r.type === type).length;
	const parts: string[] = [];
	const folders = count("folder"), tags = count("tag"), props = count("property");
	if (folders > 0) parts.push(`${folders} folder${folders === 1 ? "" : "s"}`);
	if (tags > 0) parts.push(`${tags} tag${tags === 1 ? "" : "s"}`);
	if (props > 0) parts.push(`${props} propert${props === 1 ? "y" : "ies"}`);
	return parts.length > 0 ? parts.join(", ") : "Nothing selected";
}

/** What a rule selects, for summaries. */
function describeRule(rule: MocRule): string {
	switch (rule.type) {
		case "folder": {
			const where = rule.mode === "fixed" ? rule.folder.trim() || "/" : FOLDER_MODE_OPTIONS[rule.mode];
			return `${where}${rule.includeSubfolders ? " (with subfolders)" : ""}`;
		}
		case "tag":
			return `#${rule.tag.replace(/^#/, "")}`;
		case "property":
			return rule.value ? `${rule.key}: ${rule.value}` : rule.key;
	}
}

function summarizeGroups(template: MocTemplate): string {
	const by = template.groupBy === "none" ? "No groups" : `By ${GROUP_BY_OPTIONS[template.groupBy].toLowerCase()}`;
	const hidden = template.groupBy === "none" ? 0 : template.hiddenGroups.length;
	return `${by}, ${template.columns} column${template.columns === 1 ? "" : "s"}${hidden > 0 ? `, ${hidden} hidden` : ""}`;
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
		const {template} = this.opts;
		if (template.rules.length === 0) {
			new Setting(body)
				.setName("No rules yet")
				.setDesc("Add a folder, tag or property below to choose the notes this MOC lists.");
		}
		template.rules.forEach((rule, index) => this.renderRule(body, rule, index, change, changeAndRerender));

		const add = (rule: MocRule) => {
			// A rule of the same kind as the one above it usually widens the list
			// (another folder or tag); a different kind usually narrows it.
			const above = template.rules[template.rules.length - 1];
			rule.op = above?.type === rule.type ? "or" : "and";
			template.rules.push(rule);
			void changeAndRerender();
		};
		const addSetting = new Setting(body)
			.setName("Add rule")
			.setDesc("Rules are checked from top to bottom. And: the note must also match the rule. Or: the note may match the rule instead.");
		const addButton = (label: string, rule: () => MocRule) => addSetting.addButton((btn: ButtonComponent) => btn
			.setButtonText(label)
			.onClick(() => add(rule())));
		addButton("Folder", () => ({type: "folder", op: "and", mode: "fixed", folder: "", includeSubfolders: true}));
		addButton("Tag", () => ({type: "tag", op: "and", tag: ""}));
		addButton("Property", () => ({type: "property", op: "and", key: "", value: ""}));
	}

	/** One rule: how it joins the rules above, what it matches, and a remove button. */
	private renderRule(
		body: HTMLElement,
		rule: MocRule,
		index: number,
		change: () => Promise<void>,
		changeAndRerender: () => Promise<void>,
	): void {
		const {app, template} = this.opts;
		const setting = new Setting(body);
		setting.settingEl.addClass("amc-moc-rule");
		setting.nameEl.empty();
		if (index > 0) {
			new DropdownComponent(setting.nameEl.createSpan({cls: "amc-moc-rule-op"}))
				.addOptions(OP_OPTIONS)
				.setValue(rule.op)
				.onChange(async (value) => {
					rule.op = value as MocRuleOp;
					await change();
				});
		}
		setting.nameEl.createSpan({text: RULE_NAMES[rule.type]});

		switch (rule.type) {
			case "folder": {
				// The toggle has no label of its own: the description says what it does.
				const describe = () => setting.setDesc([
					rule.includeSubfolders ? "Includes subfolders." : "Only notes directly in the folder.",
					rule.mode === "fixed" ? "" : "Resolved from the note the MOC is in, so the same MOC works in any folder.",
				].join(" ").trim());
				describe();
				setting.addDropdown((dd) => dd
					.addOptions(FOLDER_MODE_OPTIONS)
					.setValue(rule.mode)
					.onChange(async (value) => {
						rule.mode = value as MocFolderMode;
						await changeAndRerender();
					}));
				if (rule.mode === "fixed") {
					setting.addText((text) => {
						text.setPlaceholder("Folder (/ for the vault)").setValue(rule.folder);
						new FolderSuggest(app, text.inputEl, (folder) => {
							rule.folder = folder.path;
							void change();
						});
						text.onChange(async (value) => {
							rule.folder = value;
							await change();
						});
					});
				}
				setting.addToggle((toggle) => toggle
					.setTooltip("Include subfolders")
					.setValue(rule.includeSubfolders)
					.onChange(async (value) => {
						rule.includeSubfolders = value;
						describe();
						await change();
					}));
				break;
			}
			case "tag":
				setting.setDesc("Also matches its subtags.");
				setting.addText((text) => {
					text.setPlaceholder("Tag").setValue(rule.tag);
					new ListSuggest(app, text.inputEl, () => this.vocab.tags, (tag) => {
						rule.tag = tag;
						void change();
					});
					text.onChange(async (value) => {
						rule.tag = value.trim().replace(/^#/, "");
						await change();
					});
				});
				break;
			case "property": {
				setting.setDesc("Leave the value empty to only require the property.");
				setting.addText((text) => {
					text.setPlaceholder("Property").setValue(rule.key);
					new ListSuggest(app, text.inputEl, () => this.vocab.propertyKeys, (key) => {
						rule.key = key;
						void change();
					});
					text.onChange(async (value) => {
						rule.key = value.trim();
						await change();
					});
				});
				setting.addText((text) => {
					text.setPlaceholder("Value (optional)").setValue(rule.value);
					new ListSuggest(app, text.inputEl, () => this.vocab.propertyValues(rule.key.trim()), (value) => {
						rule.value = value;
						void change();
					});
					text.onChange(async (value) => {
						rule.value = value.trim();
						await change();
					});
				});
				break;
			}
		}

		setting.addExtraButton((btn) => btn
			.setIcon("x")
			.setTooltip("Remove rule")
			.onClick(() => {
				template.rules.splice(index, 1);
				void changeAndRerender();
			}));
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
				text: "Groups found right now. Automatic places a group in the shortest column. Use the eye to leave a group out of the MOC.",
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
			const setting = new Setting(el)
				.setName(group.name)
				.setDesc(`${group.files.length} note${group.files.length === 1 ? "" : "s"}`);
			let dropdown: DropdownComponent | null = null;
			let eye: ExtraButtonComponent | null = null;
			// Hiding keeps the column choice, so showing the group again puts it back.
			const showState = () => {
				const hidden = template.hiddenGroups.includes(group.name);
				setting.settingEl.toggleClass("is-hidden-group", hidden);
				dropdown?.setDisabled(hidden);
				eye?.setIcon(hidden ? "eye-off" : "eye").setTooltip(hidden ? "Show in MOC" : "Hide from MOC");
			};
			setting.addExtraButton((btn) => {
				eye = btn.onClick(async () => {
					const hidden = template.hiddenGroups.includes(group.name);
					template.hiddenGroups = hidden
						? template.hiddenGroups.filter((name) => name !== group.name)
						: [...template.hiddenGroups, group.name];
					showState();
					await this.opts.onChange();
					if (this.tabsEl) this.renderTabs(this.tabsEl);
					this.refreshDerived();
				});
				btn.extraSettingsEl.addClass("amc-moc-group-visibility");
			});
			setting.addDropdown((dd) => {
				dropdown = dd
					.addOptions(options)
					.setValue(assigned !== undefined && assigned < count ? `col-${assigned}` : "auto")
					.onChange(async (value) => {
						if (value === "auto") delete template.assignments[group.name];
						else template.assignments[group.name] = parseInt(value.slice("col-".length), 10);
						await this.opts.onChange();
						this.refreshDerived();
					});
			});
			showState();
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

		const relative = hasRelativeFolder(template);
		if (relative && sourcePath === undefined) {
			el.createDiv({cls: "amc-moc-preview-empty", text: "Open a note to preview a MOC relative to its folder."});
			return;
		}
		const groups = visibleMocGroups(template, collectMocGroups(app, template, sourcePath, PREVIEW_LIMIT));
		const folders = resolvedFolders(template, sourcePath).map((f) => (f.folder === "" ? "/" : f.folder));
		const where = relative ? ` Folders: ${folders.join(", ")} (from ${sourcePath}).` : "";
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

/** One-line summary of a template's rules and layout. */
export function describeMocTemplate(template: MocTemplate): string {
	const what = template.rules.length > 0
		? template.rules.map((rule, i) => (i === 0 ? "" : ` ${rule.op} `) + describeRule(rule)).join("")
		: "No sources yet";
	return `${what} · ${GROUP_BY_OPTIONS[template.groupBy]} · ${template.columns} column(s)`;
}
