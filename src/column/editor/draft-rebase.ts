/**
 * Rebasing an open column draft onto text that changed underneath it, e.g.
 * when the note is edited in another pane while a column editor is open.
 */

export interface DraftState {
	value: string;
	cursorStart: number;
	cursorEnd: number;
}

interface TextEdit {
	from: number;
	to: number;
	insert: string;
}

/** The one range `next` replaced in `prev` (common prefix and suffix kept). */
function diffText(prev: string, next: string): TextEdit {
	const max = Math.min(prev.length, next.length);
	let start = 0;
	while (start < max && prev.charCodeAt(start) === next.charCodeAt(start)) start++;
	let end = 0;
	while (end < max - start && prev.charCodeAt(prev.length - 1 - end) === next.charCodeAt(next.length - 1 - end)) end++;
	return {from: start, to: prev.length - end, insert: next.slice(start, next.length - end)};
}

function applyEdits(base: string, first: TextEdit, second: TextEdit): string {
	return base.slice(0, first.from) + first.insert + base.slice(first.to, second.from) + second.insert + base.slice(second.to);
}

/** Map an offset in the text before `edit` to the text after it. */
function mapOffset(offset: number, edit: TextEdit): number {
	if (offset <= edit.from) return offset;
	if (offset >= edit.to) return offset + edit.insert.length - (edit.to - edit.from);
	return edit.from + edit.insert.length;
}

/**
 * Rebase a draft started from `base` onto `current`. An untouched draft takes
 * the new text. Otherwise both edits are kept when they touch different parts
 * of the text; when they overlap, the draft wins, as it would have if it was
 * committed first.
 */
export function rebaseDraft<T extends DraftState>(draft: T, base: string, current: string): T {
	const value = draft.value;
	if (current === base || current === value) return draft;
	const theirs = diffText(base, current);
	if (value === base) {
		return {
			...draft,
			value: current,
			cursorStart: Math.min(current.length, mapOffset(draft.cursorStart, theirs)),
			cursorEnd: Math.min(current.length, mapOffset(draft.cursorEnd, theirs)),
		};
	}
	const mine = diffText(base, value);
	let merged: string;
	if (mine.to <= theirs.from) merged = applyEdits(base, mine, theirs);
	else if (theirs.to <= mine.from) merged = applyEdits(base, theirs, mine);
	else return draft;
	// The cursor is in the draft; only text inserted before it moves it.
	const shift = theirs.to <= mine.from ? theirs.insert.length - (theirs.to - theirs.from) : 0;
	return {
		...draft,
		value: merged,
		cursorStart: Math.min(merged.length, draft.cursorStart + shift),
		cursorEnd: Math.min(merged.length, draft.cursorEnd + shift),
	};
}
