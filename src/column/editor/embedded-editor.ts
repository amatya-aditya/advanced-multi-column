import {App, Component, Editor, MarkdownFileInfo, TFile} from "obsidian";
import {EditorSelection, Extension, Prec} from "@codemirror/state";
import {EditorView, KeyBinding, keymap, placeholder as placeholderExt, ViewUpdate} from "@codemirror/view";
import {getPluginInstance} from "../core/plugin-ref";

/**
 * Embedded live-preview markdown editor for column editing.
 *
 * Obsidian does not expose its internal `MarkdownEditor` class (the editor
 * used for editable embeds, canvas cards and live-preview tables), so it is
 * resolved at runtime from the markdown embed registry. This is the same
 * technique used by the Kanban and Meta Bind plugins (credits to mgmeyers
 * and Fevol). When resolution fails — e.g. after a breaking Obsidian
 * update — callers fall back to the plain-textarea column editor.
 */

// ── Internal (non-public) API shapes ────────────────────────

interface WidgetEditorView extends Component {
	editable: boolean;
	editMode?: unknown;
	showEditor(): void;
}

interface EmbedRegistry {
	embedByExtension?: {
		md?: (
			context: {app: App; containerEl: HTMLElement; state?: unknown},
			file: TFile | null,
			subpath: string,
		) => WidgetEditorView;
	};
}

export interface InternalMarkdownEditor extends Component {
	editor: Editor;
	cm: EditorView;
	editorEl: HTMLElement;
	set(data: string, clear?: boolean): void;
	destroy(): void;
	onUpdate(update: ViewUpdate, changed: boolean): void;
	buildLocalExtensions(): Extension[];
}

interface EmbeddedEditorOwner {
	app: App;
	scroll: number;
	editMode: unknown;
	showSearch(): void;
	toggleMode(): void;
	onMarkdownScroll(): void;
	getMode(): string;
	readonly editor: Editor | undefined;
	readonly file: TFile | null;
	readonly path: string;
}

type InternalMarkdownEditorConstructor = new (
	app: App,
	container: HTMLElement,
	owner: EmbeddedEditorOwner,
) => InternalMarkdownEditor;

// ── Editor class resolution ─────────────────────────────────

let cachedEditorClass: InternalMarkdownEditorConstructor | null | undefined;

function resolveEditorClass(app: App): InternalMarkdownEditorConstructor | null {
	if (cachedEditorClass !== undefined) return cachedEditorClass;
	cachedEditorClass = null;
	let temp: WidgetEditorView | null = null;
	try {
		const registry = (app as App & {embedRegistry?: EmbedRegistry}).embedRegistry;
		const createMdEmbed = registry?.embedByExtension?.md;
		if (!createMdEmbed) return null;

		// Create a throwaway editable markdown embed just to grab the
		// prototype of the internal MarkdownEditor class.
		temp = createMdEmbed(
			{app, containerEl: createDiv(), state: {}},
			null,
			"",
		);
		temp.load();
		temp.editable = true;
		temp.showEditor();
		if (temp.editMode) {
			const proto: unknown = Object.getPrototypeOf(Object.getPrototypeOf(temp.editMode));
			const ctor = (proto as {constructor?: unknown} | null)?.constructor;
			if (typeof ctor === "function") {
				cachedEditorClass = ctor as InternalMarkdownEditorConstructor;
			}
		}
	} catch {
		cachedEditorClass = null;
	} finally {
		try {
			temp?.unload();
		} catch {
			// Best-effort cleanup when probing an unsupported internal API.
		}
	}
	return cachedEditorClass;
}

export function isEmbeddedEditorAvailable(): boolean {
	try {
		return resolveEditorClass(getPluginInstance().app) !== null;
	} catch {
		return false;
	}
}

// ── App proxy ───────────────────────────────────────────────

/**
 * Proxy the app so the embedded editor never shows line numbers or fold
 * gutters, regardless of the user's editor settings (mirrors Kanban).
 */
function createEditorAppProxy(app: App): App {
	return new Proxy(app, {
		get(target, prop, receiver) {
			if (prop === "vault") {
				return new Proxy(app.vault, {
					get(vaultTarget, vaultProp, vaultReceiver) {
						if (vaultProp === "config") {
							const config = Reflect.get(vaultTarget, vaultProp, vaultReceiver) as object;
							return new Proxy(config, {
								get(configTarget, configProp, configReceiver) {
									if (
										configProp === "showLineNumber"
										|| configProp === "foldHeading"
										|| configProp === "foldIndent"
									) {
										return false;
									}
									return Reflect.get(configTarget, configProp, configReceiver) as unknown;
								},
							});
						}
						return Reflect.get(vaultTarget, vaultProp, vaultReceiver) as unknown;
					},
				});
			}
			return Reflect.get(target, prop, receiver) as unknown;
		},
	});
}

// ── Public factory ──────────────────────────────────────────

export interface EmbeddedEditorOptions {
	value: string;
	/** Note that owns the column; links and suggestions resolve against it. */
	sourcePath?: string;
	placeholder?: string;
	onEscape: () => void;
	onBlur: () => void;
	onChange?: (update: ViewUpdate) => void;
	/** Return true when the paste event was handled. */
	onPaste?: (e: ClipboardEvent, editor: InternalMarkdownEditor) => boolean;
	/** Highest-precedence Tab handler. Return true when handled. */
	onTab?: (shift: boolean) => boolean;
}

export interface EmbeddedEditorHandle {
	readonly value: string;
	editor: InternalMarkdownEditor;
	containerEl: HTMLElement;
	setSelection(anchor: number, head?: number): void;
	focus(): void;
	destroy(): void;
}

export function createEmbeddedEditor(
	hostEl: HTMLElement,
	options: EmbeddedEditorOptions,
): EmbeddedEditorHandle | null {
	const plugin = getPluginInstance();
	const app = plugin.app;
	const Base = resolveEditorClass(app);
	if (!Base) return null;

	let instance: InternalMarkdownEditor | null = null;

	// Captured once: while this editor is focused it becomes the workspace's
	// activeEditor, and workspace.getActiveFile() consults activeEditor.file —
	// resolving the file lazily through getActiveFile() would recurse.
	const ownerFile = options.sourcePath ? app.vault.getAbstractFileByPath(options.sourcePath) : null;
	const contextFile = ownerFile instanceof TFile ? ownerFile : app.workspace.getActiveFile();

	const owner: EmbeddedEditorOwner = {
		app,
		scroll: 0,
		editMode: null,
		showSearch: () => {},
		toggleMode: () => {},
		onMarkdownScroll: () => {},
		getMode: () => "source",
		get editor() {
			return instance?.editor;
		},
		get file() {
			return contextFile;
		},
		get path() {
			return contextFile?.path ?? "";
		},
	};

	class EmbeddedColumnEditor extends Base {
		updateBottomPadding(): void {}

		onUpdate(update: ViewUpdate, changed: boolean): void {
			super.onUpdate(update, changed);
			if (changed) options.onChange?.(update);
		}

		buildLocalExtensions(): Extension[] {
			const extensions = super.buildLocalExtensions();

			if (options.placeholder) {
				extensions.push(placeholderExt(options.placeholder));
			}

			// Route editor commands and suggests to this editor while focused.
			// stopPropagation: the widget lives inside the note's editor, so
			// the focusin would bubble into the outer editor's own handler,
			// which would claim activeEditor for the MarkdownView right back.
			// Deferred set: mirrors how Obsidian itself assigns activeEditor.
			extensions.push(
				Prec.highest(
					EditorView.domEventHandlers({
						focusin: (evt) => {
							evt.stopPropagation();
							evt.win.setTimeout(() => {
								if (this.cm.hasFocus) {
									app.workspace.activeEditor = owner as unknown as MarkdownFileInfo;
								}
							});
							return false;
						},
					}),
				),
			);

			if (options.onPaste) {
				extensions.push(
					Prec.high(
						EditorView.domEventHandlers({
							paste: (e) => options.onPaste!(e, this),
						}),
					),
				);
			}

			const keys: KeyBinding[] = [
				{
					key: "Escape",
					run: () => {
						options.onEscape();
						return true;
					},
					preventDefault: true,
				},
			];
			if (options.onTab) {
				keys.push({
					key: "Tab",
					run: () => options.onTab!(false),
					shift: () => options.onTab!(true),
				});
			}
			extensions.push(Prec.highest(keymap.of(keys)));

			return extensions;
		}
	}

	const containerEl = hostEl.createDiv({cls: "amc-embedded-editor cm-table-widget"});

	let editor: InternalMarkdownEditor;
	try {
		editor = new EmbeddedColumnEditor(createEditorAppProxy(app), containerEl, owner);
		instance = editor;
		owner.editMode = editor;
		editor.load();
		editor.set(options.value);
	} catch {
		try {
			instance?.unload();
		} catch {
			// Best-effort component cleanup after partial initialization.
		}
		try {
			instance?.destroy();
		} catch {
			// Best-effort editor cleanup after partial initialization.
		}
		containerEl.remove();
		return null;
	}

	// Chrome fires a blur event when the editor is removed from the DOM,
	// hence the loaded guard (see Fevol's embeddable editor gist).
	editor.cm.contentDOM.addEventListener("blur", () => {
		if ((editor as unknown as {_loaded?: boolean})._loaded) options.onBlur();
	});

	let destroyed = false;

	return {
		editor,
		containerEl,
		get value() {
			return editor.cm.state.doc.toString();
		},
		setSelection(anchor: number, head?: number) {
			const max = editor.cm.state.doc.length;
			editor.cm.dispatch({
				selection: EditorSelection.range(
					Math.min(anchor, max),
					Math.min(head ?? anchor, max),
				),
			});
		},
		focus() {
			editor.cm.focus();
		},
		destroy() {
			if (destroyed) return;
			destroyed = true;
			try {
				if (app.workspace.activeEditor === (owner as unknown as MarkdownFileInfo)) {
					app.workspace.activeEditor = null;
				}
				editor.unload();
				editor.destroy();
			} catch {
				// Best-effort teardown of internal editor state.
			}
			containerEl.remove();
		},
	};
}
