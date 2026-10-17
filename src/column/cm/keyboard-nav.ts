import {Prec} from "@codemirror/state";
import {EditorView, keymap} from "@codemirror/view";
import {EDIT_KEY_ATTR, ENTER_EDIT_EVENT} from "../editor/live-edit";
import type {EnterEditAt} from "../editor/live-edit";
import {columnBlocks} from "./state-field";

/**
 * Arrow keys in and out of column blocks in live preview. A block is atomic
 * in the note's editor, so the cursor jumped over it: Arrow Down on the line
 * above a block opens its first column, Arrow Up on the line below opens its
 * last. Leaving a column's first or last line returns to the note
 * (see leaveColumnBlock).
 */

/** Block directly below (1) or above (-1) the cursor, when it is on the adjacent visual line. */
function adjacentBlock(view: EditorView, dir: 1 | -1): {from: number; to: number} | null {
	const sel = view.state.selection.main;
	if (!sel.empty) return null;
	const head = sel.head;
	const line = view.state.doc.lineAt(head);
	// On a wrapped line, only from its last (or first) visual row.
	if (view.moveToLineBoundary(sel, dir === 1, true).head !== (dir === 1 ? line.to : line.from)) return null;
	for (const block of columnBlocks(view.state)) {
		if (dir === 1 && (block.from === line.to + 1 || block.from === head)) return block;
		if (dir === -1 && (block.to === line.from - 1 || block.to === head)) return block;
	}
	return null;
}

/** The rendered widget of the block starting at `from`. */
function blockHost(view: EditorView, from: number): HTMLElement | null {
	for (const host of Array.from(view.contentDOM.querySelectorAll<HTMLElement>(".amc-columns-host"))) {
		try {
			if (view.posAtDOM(host) === from) return host;
		} catch {
			// Not part of this editor's document.
		}
	}
	return null;
}

function enterBlock(view: EditorView, dir: 1 | -1): boolean {
	const block = adjacentBlock(view, dir);
	if (!block) return false;
	const host = blockHost(view, block.from);
	if (!host) return false;
	// Top-level columns with an editor (columns holding nested blocks have none).
	const columns = Array.from(host.querySelectorAll<HTMLElement>(`[${EDIT_KEY_ATTR}]`))
		.filter((el) => /^c\d+$/.test(el.getAttribute(EDIT_KEY_ATTR) ?? ""));
	const target = dir === 1 ? columns[0] : columns[columns.length - 1];
	if (!target) return false;
	const at: EnterEditAt = dir === 1 ? "start" : "end";
	target.dispatchEvent(new CustomEvent(ENTER_EDIT_EVENT, {detail: at}));
	return true;
}

// Highest: Obsidian's own arrow key handling runs before Prec.high keymaps.
export const columnKeyboardNav = Prec.highest(keymap.of([
	{key: "ArrowDown", run: (view) => enterBlock(view, 1)},
	{key: "ArrowUp", run: (view) => enterBlock(view, -1)},
]));

/** Put the note's cursor on the line above (-1) or below (1) the block starting at `from`. */
export function leaveColumnBlock(view: EditorView, from: number, dir: 1 | -1): void {
	const block = columnBlocks(view.state).find((b) => b.from === from);
	if (!block) return;
	const length = view.state.doc.length;
	const pos = dir === -1 ? Math.max(0, block.from - 1) : Math.min(length, block.to + 1);
	view.dispatch({selection: {anchor: pos}, scrollIntoView: true});
	view.focus();
}
