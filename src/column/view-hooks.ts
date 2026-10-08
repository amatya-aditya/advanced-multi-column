import {MarkdownView, Plugin, TFile} from "obsidian";

/**
 * Notifications around a markdown view switching notes, which Obsidian has
 * no events for: `file-open` and `layout-change` fire only after the switch.
 * Obsidian's `MarkdownView.loadFile` (another note opens in the pane, or
 * `null` when it closes) and `onClose` are wrapped once and the wrappers
 * restored on unload.
 */
export interface MarkdownViewHooks {
	/**
	 * The view is about to let go of `view.file`, before anything else happens:
	 * the view is still one of the note's users and its editor still holds the
	 * note. `next` is the note it switches to, or null when the view closes.
	 */
	beforeFileChange?(view: MarkdownView, next: TFile | null): void;
	/** The view finished loading a note: its data and editor hold the new note. */
	afterFileLoad?(view: MarkdownView): void;
}

type LoadFile = (this: MarkdownView, file: TFile | null) => Promise<unknown>;
type CloseView = (this: MarkdownView) => Promise<void>;

const listeners: MarkdownViewHooks[] = [];
const loadingViews = new WeakSet<MarkdownView>();

/**
 * Whether the view is loading another note. Until it finishes, `view.file`
 * already names the new note while the view's data is still the old note's.
 */
export function isLoadingFile(view: MarkdownView): boolean {
	return loadingViews.has(view);
}

export function addMarkdownViewHooks(plugin: Plugin, hooks: MarkdownViewHooks): void {
	listeners.push(hooks);
	plugin.register(() => listeners.remove(hooks));
}

/** Run every listener; one that throws must never stop Obsidian loading a note. */
function notify(call: (hooks: MarkdownViewHooks) => void): void {
	for (const hooks of listeners) {
		try {
			call(hooks);
		} catch (error) {
			console.error("[Advanced Multi Column] note switch hook failed", error);
		}
	}
}

export function installMarkdownViewHooks(plugin: Plugin): void {
	const proto = MarkdownView.prototype as unknown as {loadFile: LoadFile; onClose: CloseView};
	const originalLoadFile = proto.loadFile;
	const loadFile: LoadFile = async function (this: MarkdownView, file: TFile | null) {
		if (file === this.file) return originalLoadFile.call(this, file);
		if (this.file) notify((hooks) => hooks.beforeFileChange?.(this, file));
		loadingViews.add(this);
		try {
			return await originalLoadFile.call(this, file);
		} finally {
			loadingViews.delete(this);
			if (file) notify((hooks) => hooks.afterFileLoad?.(this));
		}
	};
	const originalOnClose = proto.onClose;
	// Closing tears the editor down before `loadFile(null)`.
	const onClose: CloseView = function (this: MarkdownView) {
		if (this.file) notify((hooks) => hooks.beforeFileChange?.(this, null));
		return originalOnClose.call(this);
	};
	proto.loadFile = loadFile;
	proto.onClose = onClose;
	plugin.register(() => {
		// Leave a later patch by another plugin in place.
		if (proto.loadFile === loadFile) proto.loadFile = originalLoadFile;
		if (proto.onClose === onClose) proto.onClose = originalOnClose;
	});
}
