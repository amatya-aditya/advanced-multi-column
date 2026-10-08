import {Component} from "obsidian";
import {mayHaveFootnotes} from "./core/footnotes";
import type {NoteFootnotes} from "./core/footnotes";
import type ColumnsPlugin from "../main";

/**
 * Reuse of reading view's rendered blocks between builds of the same note.
 *
 * The column layer is a sequence of top-level blocks: the text between
 * column blocks, and the column blocks. Every change to the note (each save
 * while it is edited elsewhere) rebuilt all of them, which froze a long note
 * for most of a second. A block whose source, and whatever else its rendering
 * depends on, did not change is moved into the new layer instead.
 */

/** A top-level block of the layer. */
export interface LayerBlock {
	/** What the block was rendered from (see blockKey). */
	key: string;
	el: HTMLElement;
	/** Owns what was rendered into `el`, so a moved block keeps working. */
	component: Component;
	/** Not rendered yet: `el` is a placeholder (see buildWrapper's deferred blocks). */
	pending?: boolean;
}

/** The previous build's blocks, taken by key at most once each. */
export class BlockReuse {
	private readonly byKey = new Map<string, LayerBlock[]>();
	/** Blocks the new build took over; the rest are unloaded with the old layer. */
	readonly taken = new Set<LayerBlock>();

	constructor(blocks: readonly LayerBlock[]) {
		for (const block of blocks) {
			if (block.pending) continue;
			const list = this.byKey.get(block.key);
			if (list) list.push(block);
			else this.byKey.set(block.key, [block]);
		}
	}

	take(key: string): LayerBlock | null {
		const block = this.byKey.get(key)?.shift() ?? null;
		if (block) this.taken.add(block);
		return block;
	}
}

/** Unload the blocks a build created and did not take over from the previous one. */
export function unloadNewBlocks(blocks: readonly LayerBlock[], reuse: BlockReuse): void {
	for (const block of blocks) if (!reuse.taken.has(block)) block.component.unload();
}

/** Unload the blocks of a layer the next build did not take over. */
export function unloadUntakenBlocks(blocks: readonly LayerBlock[], reuse: BlockReuse | null): void {
	for (const block of blocks) if (!reuse?.taken.has(block)) block.component.unload();
}

/**
 * Everything besides a block's source that its rendering depends on:
 * the settings baked into column headers, and, for blocks with footnote
 * syntax, the note's footnotes (their numbers and text).
 */
export function blockContext(plugin: ColumnsPlugin, footnotes: NoteFootnotes | null | undefined): {plain: string; withFootnotes: string} {
	const s = plugin.settings;
	const plain = JSON.stringify([s.enableHeaders, s.headerTypes]);
	const notes = footnotes ? JSON.stringify(footnotes.list.map((f) => [f.label ?? "", f.markdown])) : "";
	return {plain, withFootnotes: `${plain}\u0000${notes}`};
}

export function blockKey(kind: "text" | "columns", source: string, context: {plain: string; withFootnotes: string}): string {
	return `${kind}\u0000${mayHaveFootnotes(source) ? context.withFootnotes : context.plain}\u0000${source}`;
}
