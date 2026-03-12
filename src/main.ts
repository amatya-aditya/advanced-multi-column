import {Editor, Menu, MenuItem, Plugin} from "obsidian";
import {ColumnsPluginSettings, ColumnsSettingTab, DEFAULT_SETTINGS} from "./settings";
import {setPluginInstance} from "./column/core/plugin-ref";
import {registerReadingView} from "./column/reading-view";
import {columnDecorations} from "./column/cm/state-field";
import {buildRuntimeStyles} from "./column/runtime-styles";

export default class ColumnsPlugin extends Plugin {
	settings: ColumnsPluginSettings;
	private runtimeStyleSheet: CSSStyleSheet | null = null;
	private cleanupReadingView: (() => void) | null = null;

	async onload() {
		await this.loadSettings();
		this.applyRuntimeStyles();
		setPluginInstance(this);

		// CM6 extension for Live Preview
		this.registerEditorExtension(columnDecorations);

		// Reading view processor (code block fallback)
		this.cleanupReadingView = registerReadingView(this);

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
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<ColumnsPluginSettings>,
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
		if (typeof s.enableSlashSuggest !== "boolean") s.enableSlashSuggest = DEFAULT_SETTINGS.enableSlashSuggest;
		if (typeof s.inheritStyleOnAdd !== "boolean") s.inheritStyleOnAdd = DEFAULT_SETTINGS.inheritStyleOnAdd;
		if (typeof s.showContainerBorder !== "boolean") s.showContainerBorder = DEFAULT_SETTINGS.showContainerBorder;
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.applyRuntimeStyles();
	}

	private applyRuntimeStyles(): void {
		const styleSheet = this.ensureRuntimeStyleSheet();
		if (!styleSheet) return;
		styleSheet.replaceSync(buildRuntimeStyles(this.settings));
	}

	private ensureRuntimeStyleSheet(): CSSStyleSheet | null {
		if (this.runtimeStyleSheet) return this.runtimeStyleSheet;
		if (typeof CSSStyleSheet === "undefined") return null;
		if (!("adoptedStyleSheets" in document)) return null;

		const sheet = new CSSStyleSheet();
		const adoptedTarget = document as Document & {
			adoptedStyleSheets: CSSStyleSheet[];
		};
		adoptedTarget.adoptedStyleSheets = [...adoptedTarget.adoptedStyleSheets, sheet];
		this.runtimeStyleSheet = sheet;
		return sheet;
	}

	private detachRuntimeStyleSheet(): void {
		const sheet = this.runtimeStyleSheet;
		if (!sheet) return;
		if ("adoptedStyleSheets" in document) {
			const adoptedTarget = document as Document & {
				adoptedStyleSheets: CSSStyleSheet[];
			};
			adoptedTarget.adoptedStyleSheets = adoptedTarget.adoptedStyleSheets.filter(
				(existing) => existing !== sheet,
			);
		}
		this.runtimeStyleSheet = null;
	}
}
