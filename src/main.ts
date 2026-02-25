import {Editor, Menu, Plugin} from "obsidian";
import {ColumnsPluginSettings, ColumnsSettingTab, DEFAULT_SETTINGS} from "./settings";
import {setPluginInstance} from "./column/plugin-ref";
import {registerReadingView} from "./column/reading-view";
import {columnDecorations} from "./column/state-field";
import {buildRuntimeStyles} from "./column/runtime-styles";

export default class ColumnsPlugin extends Plugin {
	settings: ColumnsPluginSettings;
	private runtimeStyleSheet: CSSStyleSheet | null = null;

	async onload() {
		await this.loadSettings();
		this.applyRuntimeStyles();
		setPluginInstance(this);

		// CM6 extension for Live Preview
		this.registerEditorExtension(columnDecorations);

		// Reading view processor (code block fallback)
		registerReadingView(this);

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
				menu.addItem((item) =>
					item
						.setSection("insert")
						.setTitle("Insert nested columns")
						.setIcon("git-merge")
						.onClick(() => this.insertNestedTemplate(editor)),
				);
			}),
		);
	}

	onunload() {
		setPluginInstance(null);
		this.detachRuntimeStyleSheet();
	}

	private insertColumns(editor: Editor, count: number): void {
		const parts: string[] = ["%% col-start %%"];
		for (let i = 0; i < count; i++) {
			parts.push("%% col-break %%");
			parts.push(`Column ${i + 1}`);
		}
		parts.push("%% col-end %%");
		this.insertTemplate(editor, parts);
	}

	private insertNestedTemplate(editor: Editor): void {
		this.insertTemplate(editor, [
			"%% col-start %%",
			"%% col-break:40 %%",
			"# Column 1",
			"Top-level content.",
			"%% col-break:60 %%",
			"# Parent column",
			"This column contains nested columns.",
			"",
			"%% col-start %%",
			"%% col-break %%",
			"## Child column 1",
			"Nested content.",
			"%% col-break %%",
			"## Child column 2",
			"Nested content.",
			"%% col-end %%",
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
