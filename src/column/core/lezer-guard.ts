import {syntaxTree} from "@codemirror/language";
import type {EditorState} from "@codemirror/state";
import type {SyntaxNode} from "@lezer/common";

/**
 * Lezer node names whose text must never be interpreted as a column marker.
 *
 * Obsidian's markdown parser uses the standard CM6 markdown node names; the
 * lowercase set also covers older parser builds and the `HyperMD` aliases.
 * `Comment` is intentionally absent: `%% ... %%` *is* an Obsidian comment and
 * our markers live inside one.
 */
const IGNORED_NODE_NAMES = new Set([
	"fencedcode",
	"codeblock",
	"inlinecode",
	"codetext",
	"math",
	"inlinemath",
	"blockmath",
	"htmlblock",
	"commentblock",
	"processinginstruction",
	"script",
	"style",
]);

function isIgnoredNode(node: SyntaxNode): boolean {
	const name = node.name.toLowerCase();
	if (IGNORED_NODE_NAMES.has(name)) return true;
	// Obsidian wraps fenced blocks in `HyperMD-codeblock` elements but the
	// syntax node is still FencedCode; this catches parser variants such as
	// `FencedCodeBlock`.
	return name.includes("fencedcode") || name.includes("codeblock") || name.includes("inlinecode");
}

/** Walk from the innermost node at `pos` to the document root. */
function touchesIgnoredNode(node: SyntaxNode, pos: number): boolean {
	let current: SyntaxNode | null = node;
	while (current) {
		// Strict containment avoids treating a marker line immediately after
		// a closing fence as part of that fence.
		if (isIgnoredNode(current) && current.from < pos && current.to > pos) return true;
		current = current.parent;
	}
	return false;
}

/**
 * Check both sides of the position: at a block boundary `resolveInner(pos, 1)`
 * can return the sibling after the boundary, while `-1` returns the block that
 * contains the character before it. A marker line is ignored if either side is
 * inside code/math.
 */
export function isCodeOrMathAt(state: EditorState, pos: number): boolean {
	const tree = syntaxTree(state);
	const clamped = Math.max(0, Math.min(pos, state.doc.length));
	return touchesIgnoredNode(tree.resolveInner(clamped, 1), clamped)
		|| touchesIgnoredNode(tree.resolveInner(clamped, -1), clamped);
}

/** Ignore predicate to pass to `findColumnRegions` from live preview. */
export function livePreviewIgnorePredicate(state: EditorState): (pos: number) => boolean {
	return (pos) => isCodeOrMathAt(state, pos);
}
