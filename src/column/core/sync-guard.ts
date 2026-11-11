import {Annotation} from "@codemirror/state";

/**
 * Marks a main-document transaction that mirrors a change made in an embedded
 * column sub-editor. The state field keeps the existing block widget (and the
 * open sub-editor) alive instead of rebuilding it.
 */
export const SubEditorSyncAnnotation = Annotation.define<boolean>();

/**
 * Short-lived hold that keeps column widgets from being torn down while a
 * transaction the plugin itself initiates (a parent undo/redo, a pane sync)
 * is in flight.
 *
 * The state field cannot see the EditorView that dispatched a transaction, so
 * this is a synchronous, module-level counter: only the transaction dispatched
 * inside `beginStructuralHold()` / `endStructuralHold()` observes it. Widgets
 * are refreshed in place instead of being rebuilt, which keeps the embedded
 * column editor and its DOM alive.
 */
let holdDepth = 0;

export function beginStructuralHold(): void {
	holdDepth++;
}

export function endStructuralHold(): void {
	holdDepth = Math.max(0, holdDepth - 1);
}

export function isStructuralHoldActive(): boolean {
	return holdDepth > 0;
}
