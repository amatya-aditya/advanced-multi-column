import {editorInfoField} from "obsidian";
import type {EditorView} from "@codemirror/view";

/**
 * Send an editor's text to the other panes showing the same note now, rather
 * than after the editor's short delay. Each pane sends its whole text, so when
 * two panes commit column edits within that delay (a column editor in one pane
 * commits as the other pane's editor commits), the later one overwrote the
 * earlier one's change.
 */
export function syncOtherPanes(view: EditorView): void {
	const info = view.state.field(editorInfoField, false) as {onInternalDataChange?: () => void} | undefined;
	info?.onInternalDataChange?.();
}
