import {syntaxTree} from "@codemirror/language";
import {EditorState, Range, StateField, Transaction} from "@codemirror/state";
import {Decoration, DecorationSet, EditorView} from "@codemirror/view";
import {editorLivePreviewField} from "obsidian";
import {getPluginInstance} from "../core/plugin-ref";
import {columnBlocks} from "./state-field";

/**
 * Optional (setting "Hide comments in live preview"): hide `%% … %%` comments
 * in live preview, as reading view does. Like other markdown syntax in live
 * preview, a comment shows while the cursor or a selection touches it, so it
 * can still be edited. Comments inside column blocks are left to the column
 * widget, which renders without them already.
 */

interface CommentRange {
	from: number;
	to: number;
	/** The comment fills whole lines: hide the lines, not just their text. */
	block: boolean;
}

interface HiddenComments {
	enabled: boolean;
	comments: CommentRange[];
	decorations: DecorationSet;
}

function isEnabled(state: EditorState): boolean {
	try {
		const settings = getPluginInstance().settings;
		if (!settings.hideCommentsInLivePreview || !settings.enableLivePreview) return false;
	} catch {
		return false;
	}
	return state.field(editorLivePreviewField, false) === true;
}

/** Comments in the document, from the parsed syntax tree (never in code). */
function findComments(state: EditorState): CommentRange[] {
	const comments: CommentRange[] = [];
	const doc = state.doc;
	let start = -1;
	syntaxTree(state).iterate({
		enter: (node) => {
			if (node.name.includes("comment-start")) {
				start = node.from;
			} else if (node.name.includes("comment-end") && start >= 0) {
				const from = start, to = node.to;
				start = -1;
				const first = doc.lineAt(from), last = doc.lineAt(to);
				const block = doc.sliceString(first.from, from).trim() === "" && doc.sliceString(to, last.to).trim() === "";
				comments.push(block ? {from: first.from, to: last.to, block} : {from, to, block});
			}
		},
	});
	return comments;
}

function buildDecorations(state: EditorState, comments: CommentRange[]): DecorationSet {
	const columns = columnBlocks(state);
	const selection = state.selection.ranges;
	const ranges: Range<Decoration>[] = [];
	for (const comment of comments) {
		if (comment.to <= comment.from) continue;
		// The cursor or a selection touches the comment: show it for editing.
		if (selection.some((r) => r.from <= comment.to && r.to >= comment.from)) continue;
		let insideColumns = false;
		columns.between(comment.from, comment.to, () => {
			insideColumns = true;
			return false;
		});
		if (insideColumns) continue;
		ranges.push(Decoration.replace({block: comment.block}).range(comment.from, comment.to));
	}
	return Decoration.set(ranges, true);
}

function compute(state: EditorState, comments?: CommentRange[]): HiddenComments {
	if (!isEnabled(state)) return {enabled: false, comments: [], decorations: Decoration.none};
	const found = comments ?? findComments(state);
	return {enabled: true, comments: found, decorations: buildDecorations(state, found)};
}

function treeChanged(tr: Transaction): boolean {
	return syntaxTree(tr.startState) !== syntaxTree(tr.state);
}

const hiddenCommentsField = StateField.define<HiddenComments>({
	create: (state) => compute(state),
	update(value, tr) {
		if (value.enabled !== isEnabled(tr.state) || tr.docChanged || treeChanged(tr)) return compute(tr.state);
		if (!value.enabled) return value;
		// Only the cursor moved: show or hide comments next to it.
		if (tr.selection) return compute(tr.state, value.comments);
		return value;
	},
	provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});

export const hideComments = [hiddenCommentsField];
