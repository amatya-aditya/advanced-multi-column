import {App, Editor, MarkdownFileInfo, MarkdownView, Menu, MenuItem, Notice, Plugin, SuggestModal, TFile} from "obsidian";
import type {EditorView} from "@codemirror/view";
import {ColumnsPluginSettings, DEFAULT_SETTINGS} from "./settings";
import {ColumnsSettingTab, MOC_PAGE_NAME} from "./settings-tab";
import {setPluginInstance} from "./column/core/plugin-ref";
import {registerReadingView} from "./column/reading-view";
import {columnDecorations, refreshColumnWidgets} from "./column/cm/state-field";
import {registerColumnEditFlush} from "./column/editor/edit-flush";
import {buildRuntimeStyles, RuntimeStyleSheets} from "./column/runtime-styles";
import {closeActivePopover} from "./column/render/style-context-menu";
import {collapsePropertiesInOpenNotes, registerDefaultPropertyFolding} from "./properties-fold";
import {LAYOUT_TEMPLATES, LayoutTemplate} from "./layouts";
import {MocSync} from "./moc/sync";
import {openMocEditor, openNewMocBuilder} from "./moc/builder-modal";
import {generateMocBlock} from "./moc/generate";
import {MocTemplate, sanitizeMocTemplate} from "./moc/types";

class MocTemplateModal extends SuggestModal<MocTemplate> {
	constructor(app: App, private readonly templates: MocTemplate[], private readonly onPick: (t: MocTemplate) => void) {
		super(app);
		this.setPlaceholder("Choose a MOC template");
	}

	getSuggestions(query: string): MocTemplate[] {
		const q = query.toLowerCase();
		return this.templates.filter((t) => t.name.toLowerCase().includes(q));
	}

	renderSuggestion(template: MocTemplate, el: HTMLElement): void {
		el.setText(template.name || template.id);
	}

	onChooseSuggestion(template: MocTemplate): void {
		this.onPick(template);
	}
}

export default class ColumnsPlugin extends Plugin {
	settings!: ColumnsPluginSettings;
	private readonly runtimeStyles = new RuntimeStyleSheets();
	private cleanupReadingView: (() => void) | null = null;
	private cleanupPropertyFolding: (() => void) | null = null;
	private lastLiveRenderFingerprint = "";
	private settingTab!: ColumnsSettingTab;
	mocSync!: MocSync;

	async onload() {
		await this.loadSettings();
		this.lastLiveRenderFingerprint = this.liveRenderFingerprint();
		this.attachRuntimeStyles();
		setPluginInstance(this);

		// CM6 extension for Live Preview
		this.registerEditorExtension(columnDecorations);
		registerColumnEditFlush(this);

		// Reading view processor (code block fallback)
		this.cleanupReadingView = registerReadingView(this);
		this.cleanupPropertyFolding = registerDefaultPropertyFolding(this);

		// ── Commands ──────────────────────────────────────────────

		for (const layout of LAYOUT_TEMPLATES) {
			this.addCommand({
				id: layout.id,
				name: layout.name,
				icon: layout.icon,
				editorCallback: (editor: Editor) => this.insertLayout(editor, layout),
			});
		}

		this.settingTab = new ColumnsSettingTab(this.app, this);
		this.addSettingTab(this.settingTab);

		// ── MOC (map of content) ────────────────────────────────
		this.mocSync = new MocSync(this);
		this.mocSync.register();
		this.addCommand({
			id: "create-moc",
			name: "New MOC",
			icon: "list-plus",
			editorCheckCallback: (checking: boolean, editor: Editor, ctx: MarkdownView | MarkdownFileInfo) => {
				if (!this.settings.enableMoc) return false;
				if (!checking) openNewMocBuilder(this, editor, ctx.file);
				return true;
			},
		});
		this.addCommand({
			id: "insert-moc",
			name: "Insert MOC from template",
			icon: "list-tree",
			editorCheckCallback: (checking: boolean, editor: Editor, ctx: MarkdownView | MarkdownFileInfo) => {
				if (!this.settings.enableMoc) return false;
				if (!checking) {
					new MocTemplateModal(this.app, this.mocTemplates(), (template) => {
						this.insertMoc(editor, template, ctx.file);
					}).open();
				}
				return true;
			},
		});

		// ── Editor context menu ──────────────────────────────────
		this.registerEvent(
			this.app.workspace.on("editor-menu", (menu: Menu, editor: Editor, info: MarkdownView | MarkdownFileInfo) => {
				for (const layout of LAYOUT_TEMPLATES.filter((l) => l.quick)) {
					menu.addItem((item) =>
						item
							.setSection("insert")
							.setTitle(layout.menuTitle)
							.setIcon(layout.icon)
							.onClick(() => this.insertLayout(editor, layout)),
					);
				}
				menu.addItem((item) => {
					item
						.setSection("insert")
						.setTitle("Insert layout")
						.setIcon("layout-grid");
					const sub = (item as MenuItem & {setSubmenu: () => Menu}).setSubmenu();
					for (const layout of LAYOUT_TEMPLATES.filter((l) => !l.quick)) {
						sub.addItem((s: MenuItem) => s
							.setTitle(layout.menuTitle)
							.setIcon(layout.icon)
							.onClick(() => this.insertLayout(editor, layout)));
					}
				});
				if (!this.settings.enableMoc) return;
				menu.addItem((item) => {
					item
						.setSection("insert")
						.setTitle("Insert MOC")
						.setIcon("list-tree");
					const sub = (item as MenuItem & {setSubmenu: () => Menu}).setSubmenu();
					sub.addItem((s: MenuItem) => s
						.setTitle("New MOC…")
						.setIcon("list-plus")
						.onClick(() => openNewMocBuilder(this, editor, info.file)));
					const templates = this.mocTemplates();
					if (templates.length > 0) sub.addSeparator();
					for (const template of templates) {
						sub.addItem((s: MenuItem) => s
							.setTitle(template.name || template.id)
							.setIcon("list-tree")
							.onClick(() => this.insertMoc(editor, template, info.file)));
					}
					sub.addSeparator();
					sub.addItem((s: MenuItem) => s
						.setTitle("Manage MOC templates…")
						.setIcon("settings")
						.onClick(() => this.openMocSettings()));
				});
			}),
		);
	}

	onunload() {
		this.cleanupReadingView?.();
		this.cleanupReadingView = null;
		this.cleanupPropertyFolding?.();
		this.cleanupPropertyFolding = null;
		closeActivePopover();
		setPluginInstance(null);
		this.runtimeStyles.detachAll();
	}

	private insertMoc(editor: Editor, template: MocTemplate, file: TFile | null): void {
		if (!file) {
			new Notice("Open a note to insert a MOC.");
			return;
		}
		const block = generateMocBlock(this.app, template, file.path);
		editor.replaceSelection("\n" + block + "\n");
		void this.mocSync.track(file.path);
	}

	/** Reusable MOC templates (excludes single-MOC options). */
	private mocTemplates(): MocTemplate[] {
		return this.settings.mocTemplates.filter((t) => !t.inline);
	}

	/** Open the MOC builder for an inserted MOC block. */
	editMoc(mocId: string, sourcePath: string): void {
		openMocEditor(this, mocId, sourcePath);
	}

	private openMocSettings(): void {
		const setting = (this.app as App & {
			setting?: {
				open(): void;
				openTabById(id: string): unknown;
				openPagePath?(id: string, path: string[]): unknown;
			};
		}).setting;
		if (!setting) return;
		setting.open();
		if (!setting.openPagePath?.(this.manifest.id, [MOC_PAGE_NAME])) {
			setting.openTabById(this.manifest.id);
		}
	}

	private insertLayout(editor: Editor, layout: LayoutTemplate): void {
		editor.replaceSelection("\n" + layout.lines(this.settings).join("\n") + "\n");
	}

	async loadSettings() {
		const savedData = ((await this.loadData()) ?? {}) as Partial<ColumnsPluginSettings> & {
			hideNoteProperties?: boolean;
		};
		if (
			typeof savedData.foldNotePropertiesByDefault !== "boolean"
			&& typeof savedData.hideNoteProperties === "boolean"
		) {
			savedData.foldNotePropertiesByDefault = savedData.hideNoteProperties;
		}
		delete savedData.hideNoteProperties;

		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			savedData,
		);
		this.validateSettings();
	}

	private validateSettings(): void {
		const s = this.settings;
		// Type-check numeric fields
		if (typeof s.defaultColumnCount !== "number" || !Number.isFinite(s.defaultColumnCount)) {
			s.defaultColumnCount = DEFAULT_SETTINGS.defaultColumnCount;
		}
		if (typeof s.minColumnWidthPercent !== "number" || !Number.isFinite(s.minColumnWidthPercent)) {
			s.minColumnWidthPercent = DEFAULT_SETTINGS.minColumnWidthPercent;
		}
		// Ensure minColumnWidthPercent * defaultColumnCount <= 100%
		if (s.minColumnWidthPercent * s.defaultColumnCount > 100) {
			s.minColumnWidthPercent = Math.floor(100 / s.defaultColumnCount);
		}
		// Clamp ranges
		s.defaultColumnCount = Math.max(2, Math.min(6, Math.round(s.defaultColumnCount)));
		s.minColumnWidthPercent = Math.max(5, Math.min(30, s.minColumnWidthPercent));
		// Type-check boolean fields
		if (typeof s.showDragHandles !== "boolean") s.showDragHandles = DEFAULT_SETTINGS.showDragHandles;
		if (typeof s.enableLivePreview !== "boolean") s.enableLivePreview = DEFAULT_SETTINGS.enableLivePreview;
		if (typeof s.enableReadingView !== "boolean") s.enableReadingView = DEFAULT_SETTINGS.enableReadingView;
		if (typeof s.foldNotePropertiesByDefault !== "boolean") {
			s.foldNotePropertiesByDefault = DEFAULT_SETTINGS.foldNotePropertiesByDefault;
		}
		if (typeof s.enableSlashSuggest !== "boolean") s.enableSlashSuggest = DEFAULT_SETTINGS.enableSlashSuggest;
		if (typeof s.inheritStyleOnAdd !== "boolean") s.inheritStyleOnAdd = DEFAULT_SETTINGS.inheritStyleOnAdd;
		if (typeof s.showContainerBorder !== "boolean") s.showContainerBorder = DEFAULT_SETTINGS.showContainerBorder;
		if (typeof s.enableMoc !== "boolean") s.enableMoc = DEFAULT_SETTINGS.enableMoc;
		if (typeof s.stackOnNarrowScreens !== "boolean") s.stackOnNarrowScreens = DEFAULT_SETTINGS.stackOnNarrowScreens;
		if (typeof s.narrowBreakpointPx !== "number" || !Number.isFinite(s.narrowBreakpointPx)) {
			s.narrowBreakpointPx = DEFAULT_SETTINGS.narrowBreakpointPx;
		}
		s.narrowBreakpointPx = Math.max(300, Math.min(1200, Math.round(s.narrowBreakpointPx)));
		const rawTemplates: unknown = s.mocTemplates;
		s.mocTemplates = Array.isArray(rawTemplates)
			? rawTemplates.map(sanitizeMocTemplate).filter((t): t is MocTemplate => t !== null)
			: DEFAULT_SETTINGS.mocTemplates.map((t) => ({...t}));
		const rawNotes: unknown = s.mocNotes;
		s.mocNotes = Array.isArray(rawNotes) ? rawNotes.filter((p): p is string => typeof p === "string") : [];
	}

	collapsePropertiesInOpenNotes(): void {
		collapsePropertiesInOpenNotes(this);
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.applyRuntimeStyles();
		const fingerprint = this.liveRenderFingerprint();
		if (fingerprint !== this.lastLiveRenderFingerprint) {
			this.lastLiveRenderFingerprint = fingerprint;
			this.refreshLivePreviewColumns();
		}
	}

	/** Settings that are baked into rendered live preview widgets (not CSS). */
	private liveRenderFingerprint(): string {
		const s = this.settings;
		return JSON.stringify([s.enableLivePreview, s.enableHeaders, s.headerTypes, s.enableSlashSuggest]);
	}

	/** Re-render live preview columns so rendering settings take effect. */
	private refreshLivePreviewColumns(): void {
		const views: EditorView[] = [];
		this.app.workspace.iterateAllLeaves((leaf) => {
			if (!(leaf.view instanceof MarkdownView)) return;
			const cm = (leaf.view.editor as Editor & {cm?: EditorView}).cm;
			if (cm) views.push(cm);
		});
		refreshColumnWidgets(views);
	}

	private applyRuntimeStyles(): void {
		this.runtimeStyles.update(buildRuntimeStyles(this.settings));
	}

	/**
	 * Give every window that shows notes the runtime styles: the main window
	 * now, popouts already open, and popouts opened later.
	 */
	private attachRuntimeStyles(): void {
		this.applyRuntimeStyles();
		const {workspace} = this.app;
		this.runtimeStyles.attach(workspace.containerEl.ownerDocument);
		const attachOpenWindows = () => workspace.iterateAllLeaves((leaf) => {
			this.runtimeStyles.attach(leaf.view.containerEl.ownerDocument);
		});
		attachOpenWindows();
		workspace.onLayoutReady(attachOpenWindows);
		this.registerEvent(workspace.on("window-open", (win) => this.runtimeStyles.attach(win.doc)));
		this.registerEvent(workspace.on("window-close", (win) => this.runtimeStyles.detach(win.doc)));
	}
}
