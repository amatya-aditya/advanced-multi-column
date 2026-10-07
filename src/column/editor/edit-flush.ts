import {MarkdownView, Plugin, TFile} from "obsidian";
import {EDIT_KEY_ATTR, FORCE_COMMIT_EVENT} from "./live-edit";

/**
 * Commit the open column editors of a view into its note. Commits go straight
 * into the view's editor, synchronously. Returns whether any were open.
 */
function commitOpenColumnEditors(view: MarkdownView): boolean {
	const open = view.containerEl.querySelectorAll(`[${EDIT_KEY_ATTR}].is-editing`);
	if (open.length === 0) return false;
	open.forEach((el) => el.dispatchEvent(new CustomEvent(FORCE_COMMIT_EVENT)));
	// Other panes showing the note get the change through this, which the
	// editor only calls after a short delay; the pane may be gone by then.
	(view as unknown as {onInternalDataChange?: () => void}).onInternalDataChange?.();
	return true;
}

type LoadFile = (this: MarkdownView, file: TFile | null) => Promise<unknown>;
type CloseView = (this: MarkdownView) => Promise<void>;

/**
 * Column text lives only in the open column editor until it closes, so commit
 * it whenever a note is about to go away:
 * - A pane lets go of a note: commit first thing in `loadFile` (another note
 *   opens in the pane) or `onClose` (the pane closes; it tears down the
 *   editor before `loadFile`). The pane is then still one of the note's
 *   users, so the commit reaches other panes showing the note and is saved
 *   with it. Saving the draft later, once the editor was torn down, raced the
 *   pane's own save and Obsidian's merge into the other pane (lost or
 *   duplicated text). By `onUnloadFile` the pane is no longer a user.
 * - Obsidian quits: closing the app closes no editor first.
 */
export function registerColumnEditFlush(plugin: Plugin): void {
	const proto = MarkdownView.prototype as unknown as {loadFile: LoadFile; onClose: CloseView};
	const originalLoadFile = proto.loadFile;
	const loadFile: LoadFile = function (this: MarkdownView, file: TFile | null) {
		if (this.file && file !== this.file) commitOpenColumnEditors(this);
		return originalLoadFile.call(this, file);
	};
	const originalOnClose = proto.onClose;
	const onClose: CloseView = function (this: MarkdownView) {
		commitOpenColumnEditors(this);
		return originalOnClose.call(this);
	};
	proto.loadFile = loadFile;
	proto.onClose = onClose;
	plugin.register(() => {
		// Leave a later patch by another plugin in place.
		if (proto.loadFile === loadFile) proto.loadFile = originalLoadFile;
		if (proto.onClose === onClose) proto.onClose = originalOnClose;
	});

	plugin.registerEvent(plugin.app.workspace.on("quit", (tasks) => {
		for (const leaf of plugin.app.workspace.getLeavesOfType("markdown")) {
			const view = leaf.view;
			if (view instanceof MarkdownView && commitOpenColumnEditors(view)) tasks.add(() => view.save());
		}
	}));
}
