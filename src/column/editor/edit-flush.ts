import {MarkdownView, Plugin} from "obsidian";
import {addMarkdownViewHooks} from "../view-hooks";
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

/**
 * Column text lives only in the open column editor until it closes, so commit
 * it whenever a note is about to go away:
 * - A pane lets go of a note (another note opens in it, or it closes): commit
 *   before the switch starts (see view-hooks). The pane is then still one of
 *   the note's users, so the commit reaches other panes showing the note and
 *   is saved with it. Saving the draft later, once the editor was torn down,
 *   raced the pane's own save and Obsidian's merge into the other pane (lost
 *   or duplicated text).
 * - Obsidian quits: closing the app closes no editor first.
 */
export function registerColumnEditFlush(plugin: Plugin): void {
	addMarkdownViewHooks(plugin, {beforeFileChange: (view) => commitOpenColumnEditors(view)});

	plugin.registerEvent(plugin.app.workspace.on("quit", (tasks) => {
		for (const leaf of plugin.app.workspace.getLeavesOfType("markdown")) {
			const view = leaf.view;
			if (view instanceof MarkdownView && commitOpenColumnEditors(view)) tasks.add(() => view.save());
		}
	}));
}
