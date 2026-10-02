import {Editor, MarkdownView, Menu, MenuItem, Plugin} from "obsidian";
import type {EditorView} from "@codemirror/view";
import {ColumnsPluginSettings, ColumnsSettingTab, DEFAULT_SETTINGS} from "./settings";
import {setPluginInstance} from "./column/core/plugin-ref";
import {registerReadingView} from "./column/reading-view";
import {columnDecorations, refreshColumnWidgets} from "./column/cm/state-field";
import {buildRuntimeStyles} from "./column/runtime-styles";
import {collapsePropertiesInOpenNotes, registerDefaultPropertyFolding} from "./properties-fold";

export default class ColumnsPlugin extends Plugin {
	settings!: ColumnsPluginSettings;
	private runtimeStyleSheet: CSSStyleSheet | null = null;
	private runtimeStyleEl: HTMLStyleElement | null = null;
	private cleanupReadingView: (() => void) | null = null;
	private cleanupPropertyFolding: (() => void) | null = null;
	private lastLiveRenderFingerprint = "";

	async onload() {
		await this.loadSettings();
		this.lastLiveRenderFingerprint = this.liveRenderFingerprint();
		this.applyRuntimeStyles();
		setPluginInstance(this);

		// CM6 extension for Live Preview
		this.registerEditorExtension(columnDecorations);

		// Reading view processor (code block fallback)
		this.cleanupReadingView = registerReadingView(this);
		this.cleanupPropertyFolding = registerDefaultPropertyFolding(this);

		// ── Commands ──────────────────────────────────────────────

		this.addCommand({
			id: "insert-2-columns",
			name: "Insert 2-wide layout",
			editorCallback: (editor: Editor) => this.insertColumns(editor, 2),
		});

		this.addCommand({
			id: "insert-3-columns",
			name: "Insert 3-wide layout",
			editorCallback: (editor: Editor) => this.insertColumns(editor, 3),
		});

		this.addCommand({
			id: "insert-4-columns",
			name: "Insert 4-wide layout",
			editorCallback: (editor: Editor) => this.insertColumns(editor, 4),
		});

		this.addCommand({
			id: "insert-column-block",
			name: "Insert layout (custom count)",
			editorCallback: (editor: Editor) => {
				this.insertColumns(editor, this.settings.defaultColumnCount);
			},
		});

		this.addCommand({
			id: "insert-nested-layout",
			name: "Insert nested layout (parent + children)",
			editorCallback: (editor: Editor) => {
				this.insertNestedTemplate(editor);
			},
		});

		this.addSettingTab(new ColumnsSettingTab(this.app, this));

		// ── Editor context menu ──────────────────────────────────
		this.registerEvent(
			this.app.workspace.on("editor-menu", (menu: Menu, editor: Editor) => {
				menu.addItem((item) =>
					item
						.setSection("insert")
						.setTitle("Insert 2 columns")
						.setIcon("columns-2")
						.onClick(() => this.insertColumns(editor, 2)),
				);
				menu.addItem((item) =>
					item
						.setSection("insert")
						.setTitle("Insert 3 columns")
						.setIcon("columns-3")
						.onClick(() => this.insertColumns(editor, 3)),
				);
				menu.addItem((item) => {
					item
						.setSection("insert")
						.setTitle("Insert layout")
						.setIcon("layout-grid");
					const sub = (item as MenuItem & {setSubmenu: () => Menu}).setSubmenu();
					sub.addItem((s: MenuItem) => s.setTitle("Nested columns").setIcon("git-merge")
						.onClick(() => this.insertNestedTemplate(editor)));
					sub.addItem((s: MenuItem) => s.setTitle("Sidebar + content").setIcon("panel-left")
						.onClick(() => this.insertSidebarLayout(editor)));
					sub.addItem((s: MenuItem) => s.setTitle("Stacked + wide").setIcon("rows-3")
						.onClick(() => this.insertStackedLayout(editor)));
					sub.addItem((s: MenuItem) => s.setTitle("Cornell notes").setIcon("notebook-pen")
						.onClick(() => this.insertCornellTemplate(editor)));
					sub.addItem((s: MenuItem) => s.setTitle("Kanban board").setIcon("kanban")
						.onClick(() => this.insertKanbanTemplate(editor)));
					sub.addItem((s: MenuItem) => s.setTitle("Info card").setIcon("id-card")
						.onClick(() => this.insertInfoCardTemplate(editor)));
				});
			}),
		);
	}

	onunload() {
		this.cleanupReadingView?.();
		this.cleanupReadingView = null;
		this.cleanupPropertyFolding?.();
		this.cleanupPropertyFolding = null;
		setPluginInstance(null);
		this.detachRuntimeStyleSheet();
	}

	private insertColumns(editor: Editor, count: number): void {
		const parts: string[] = ["%% col-start %%"];
		for (let i = 0; i < count; i++) {
			parts.push("%% col-break:b:secondary %%");
			parts.push(`Column ${i + 1}`);
		}
		parts.push("%% col-end %%");
		this.insertTemplate(editor, parts);
	}

	private insertNestedTemplate(editor: Editor): void {
		this.insertTemplate(editor, [
			"%% col-start %%",
			"%% col-break:40,b:secondary %%",
			"Top-level content.",
			"%% col-break:60,b:secondary %%",
			"This column contains nested columns.",
			"",
			"%% col-start %%",
			"%% col-break:b:secondary %%",
			"Child column 1",
			"%% col-break:b:secondary %%",
			"Child column 2",
			"%% col-end %%",
			"%% col-end %%",
		]);
	}

	private insertSidebarLayout(editor: Editor): void {
		this.insertTemplate(editor, [
			"%% col-start %%",
			"%% col-break:30,b:secondary %%",
			"Sidebar",
			"%% col-break:70,b:secondary %%",
			"Main content",
			"%% col-end %%",
		]);
	}

	private insertStackedLayout(editor: Editor): void {
		this.insertTemplate(editor, [
			"%% col-start %%",
			"%% col-break:40,stk:1,b:secondary %%",
			"Stacked row 1",
			"%% col-break:stk:1,b:secondary %%",
			"Stacked row 2",
			"%% col-break:stk:1,b:secondary %%",
			"Stacked row 3",
			"%% col-break:60,b:secondary %%",
			"Wide column",
			"%% col-end %%",
		]);
	}

	private insertCornellTemplate(editor: Editor): void {
		this.insertTemplate(editor, [
			"%% col-start %%",
			"%% col-break:stk:1,b:secondary %%",
			"**Topic / Title**",
			"%% col-break:30,stk:1,b:secondary %%",
			"**Cues / Questions**",
			"",
			"- Key term 1",
			"- Key question",
			"- Concept",
			"%% col-break:70,b:secondary %%",
			"**Notes**",
			"",
			"Main lecture or reading notes go here.",
			"%% col-end %%",
		]);
	}

	private insertKanbanTemplate(editor: Editor): void {
		this.insertTemplate(editor, [
			"%% col-start:sb:1,bc:muted %%",
			"%% col-break:b:alt,sb:1,bc:gray %%",
			"### Backlog",
			"- [ ] Task 1",
			"- [ ] Task 2",
			"%% col-break:b:cyan-soft,sb:1,bc:cyan %%",
			"### In Progress",
			"- [ ] Task 3",
			"%% col-break:b:yellow-soft,sb:1,bc:yellow %%",
			"### Review",
			"- [ ] Task 4",
			"%% col-break:b:green-soft,sb:1,bc:green %%",
			"### Done",
			"- [x] Task 5",
			"%% col-end %%",
		]);
	}

	private insertInfoCardTemplate(editor: Editor): void {
		this.insertTemplate(editor, [
			"%% col-start:sb:1,bc:muted %%",
			"%% col-break:35,b:accent-soft,sb:1,bc:accent,sep:1,sc:accent %%",
			"### Subject Name",
			"",
			"| | |",
			"| --- | --- |",
			"| **Field** | Value |",
			"| **Category** | Type |",
			"| **Date** | 2025-01 |",
			"%% col-break:65 %%",
			"### Details",
			"",
			"Main content and description.",
			"%% col-end %%",
		]);
	}

	private insertTemplate(editor: Editor, lines: string[]): void {
		editor.replaceSelection("\n" + lines.join("\n") + "\n");
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
		if (typeof s.stackOnNarrowScreens !== "boolean") s.stackOnNarrowScreens = DEFAULT_SETTINGS.stackOnNarrowScreens;
		if (typeof s.narrowBreakpointPx !== "number" || !Number.isFinite(s.narrowBreakpointPx)) {
			s.narrowBreakpointPx = DEFAULT_SETTINGS.narrowBreakpointPx;
		}
		s.narrowBreakpointPx = Math.max(300, Math.min(1200, Math.round(s.narrowBreakpointPx)));
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
		const css = buildRuntimeStyles(this.settings);

		// Preferred path: a constructed stylesheet adopted by the document.
		const styleSheet = this.ensureRuntimeStyleSheet();
		if (styleSheet) {
			try {
				styleSheet.replaceSync(css);
				return;
			} catch {
				// Constructed stylesheets can fail under some runtimes; fall through.
				this.detachRuntimeStyleSheet();
			}
		}

		// Fallback: a plain <style> element. Works everywhere and never throws.
		this.ensureRuntimeStyleEl().textContent = css;
	}

	/** Document to attach runtime styles to. Tolerates a missing activeDocument
	 *  so plugin load can never throw on environments where it is unavailable. */
	private getStyleDocument(): Document {
		return (window.activeDocument as Document | undefined) ?? window.document;
	}

	private ensureRuntimeStyleSheet(): CSSStyleSheet | null {
		if (this.runtimeStyleSheet) return this.runtimeStyleSheet;
		try {
			const doc = this.getStyleDocument();
			if (!doc || !("adoptedStyleSheets" in doc)) return null;

			// Construct in the target document's own realm to avoid
			// cross-document adoption errors in newer Chromium.
			const view = doc.defaultView ?? window;
			if (typeof view.CSSStyleSheet === "undefined") return null;

			const sheet = new view.CSSStyleSheet();
			const adoptedTarget = doc as Document & {
				adoptedStyleSheets: CSSStyleSheet[];
			};
			adoptedTarget.adoptedStyleSheets = [...adoptedTarget.adoptedStyleSheets, sheet];
			this.runtimeStyleSheet = sheet;
			return sheet;
		} catch {
			return null;
		}
	}

	private ensureRuntimeStyleEl(): HTMLStyleElement {
		if (this.runtimeStyleEl?.isConnected) return this.runtimeStyleEl;
		const doc = this.getStyleDocument();
		const el = doc.createElement("style");
		el.id = "amc-runtime-styles";
		(doc.head ?? doc.documentElement).appendChild(el);
		this.runtimeStyleEl = el;
		return el;
	}

	private detachRuntimeStyleSheet(): void {
		const sheet = this.runtimeStyleSheet;
		this.runtimeStyleSheet = null;
		if (sheet) {
			try {
				const doc = this.getStyleDocument();
				if ("adoptedStyleSheets" in doc) {
					const adoptedTarget = doc as Document & {
						adoptedStyleSheets: CSSStyleSheet[];
					};
					adoptedTarget.adoptedStyleSheets = adoptedTarget.adoptedStyleSheets.filter(
						(existing) => existing !== sheet,
					);
				}
			} catch {
				// Ignore detach failures during teardown.
			}
		}

		if (this.runtimeStyleEl) {
			this.runtimeStyleEl.remove();
			this.runtimeStyleEl = null;
		}
	}
}
