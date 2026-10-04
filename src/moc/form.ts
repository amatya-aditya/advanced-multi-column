import {AbstractInputSuggest, App, Component, debounce, getAllTags, setIcon, Setting, TFolder} from "obsidian";
import type ColumnsPlugin from "../main";
import {findColumnRegions} from "../column/core/parser";
import {renderColumnsRegion} from "../column/reading-view";
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

const MATCH_OPTIONS: Record<MocMatch, string> = {
	all: "Match all sources",
	any: "Match any source",
};

// ── Vault vocabulary (for pickers) ──────────────────────────

/** Tags, property keys and values in use, read from the metadata cache. */
class VaultVocabulary {
	readonly tags: string[];
	readonly propertyKeys: string[];
	private readonly values = new Map<string, Set<string>>();

	constructor(app: App) {
		const tags = new Set<string>();
		for (const file of app.vault.getMarkdownFiles()) {
			const cache = app.metadataCache.getFileCache(file);
			if (!cache) continue;
			const fileTags: string[] = getAllTags(cache) ?? [];
			for (const tag of fileTags) tags.add(tag.replace(/^#/, ""));
			const frontmatter: Record<string, unknown> = cache.frontmatter ?? {};
			for (const key of Object.keys(frontmatter)) {
				if (key === "position") continue;
				const raw = frontmatter[key];
				const set = this.values.get(key) ?? new Set<string>();
				const values: unknown[] = Array.isArray(raw) ? (raw as unknown[]) : [raw];
				for (const value of values) {
					if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
						set.add(String(value).replace(/^\[\[|\]\]$/g, ""));
					}
				}
				this.values.set(key, set);
			}
		}
		this.tags = [...tags].sort((a, b) => a.localeCompare(b));
		this.propertyKeys = [...this.values.keys()].sort((a, b) => a.localeCompare(b));
	}

	propertyValues(key: string): string[] {
		return [...(this.values.get(key) ?? [])].sort((a, b) => a.localeCompare(b));
	}
}

class ListSuggest extends AbstractInputSuggest<string> {
	constructor(
		app: App,
		private readonly input: HTMLInputElement,
		private readonly source: () => string[],
		private readonly onPick: (value: string) => void,
	) {
		super(app, input);
	}

	getSuggestions(query: string): string[] {
		const q = query.toLowerCase().replace(/^#/, "");
		return this.source().filter((v) => v.toLowerCase().includes(q)).slice(0, 50);
	}

	renderSuggestion(value: string, el: HTMLElement): void {
		el.setText(value);
	}

	selectSuggestion(value: string): void {
		this.input.value = value;
		this.onPick(value);
		this.close();
	}
}

class FolderSuggest extends AbstractInputSuggest<TFolder> {
	constructor(app: App, private readonly input: HTMLInputElement, private readonly onPick: (folder: TFolder) => void) {
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
		this.onPick(folder);
		this.close();
	}
}

function renderChips(
	parent: HTMLElement,
	items: ReadonlyArray<string>,
	onRemove: (index: number) => void,
): void {
	const list = parent.createDiv({cls: "amc-moc-chips"});
	items.forEach((label, index) => {
		const chip = list.createSpan({cls: "amc-moc-chip", text: label});
		const remove = chip.createSpan({cls: "amc-moc-chip-remove", attr: {"aria-label": `Remove ${label}`}});
		setIcon(remove, "x");
		remove.addEventListener("click", () => onRemove(index));
	});
}

// ── Form ────────────────────────────────────────────────────

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
 * The MOC options form, shared by the settings tab (templates) and the MOC
 * builder dialog. Mutates `template` in place.
 */
export class MocForm extends Component {
	private vocabulary: VaultVocabulary | null = null;
	private previewComponent: Component | null = null;
	private refreshDerived: () => void = () => {};

	constructor(private readonly host: HTMLElement, private readonly opts: MocFormOptions) {
		super();
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
		const {app, template} = this.opts;
		this.host.empty();
		const body = this.host;
		const previewEl = createDiv();
		const assignmentsEl = createDiv();
		const refresh = debounce(() => {
			this.renderAssignments(assignmentsEl);
			this.renderPreview(previewEl);
		}, 250, true);
		this.refreshDerived = refresh;
		const change = async () => {
			await this.opts.onChange();
			refresh();
		};
		const changeAndRerender = async () => {
			await this.opts.onChange();
			this.render();
		};

		if (this.opts.showName) {
			new Setting(body).setName("Name").addText((text) => text
				.setValue(template.name)
				.onChange(async (value) => {
					template.name = value;
					await this.opts.onChange();
				}));
		}

		// ── Sources ──
		new Setting(body).setName("Sources").setHeading();
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

		new Setting(body).setName("Combine sources").addDropdown((dd) => dd
			.addOptions(MATCH_OPTIONS)
			.setValue(template.match)
			.onChange(async (value) => {
				template.match = value as MocMatch;
				await change();
			}));

		// ── Layout ──
		new Setting(body).setName("Layout").setHeading();
		new Setting(body).setName("Group by").addDropdown((dd) => dd
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
				: "Groups are placed into columns; with fewer groups, fewer columns are used.")
			.addSlider((slider) => slider
				.setLimits(1, MAX_MOC_COLUMNS, 1)
				.setValue(template.columns)
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
				.setDesc("Groups found right now. Automatic places a group in the shortest column.")
				.setHeading();
			body.appendChild(assignmentsEl);
		}

		new Setting(body).setName("Preview").setHeading();
		previewEl.addClass("amc-moc-preview");
		body.appendChild(previewEl);
		refresh();
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
						await this.opts.onChange();
						this.refreshDerived();
					}));
		}
	}

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
