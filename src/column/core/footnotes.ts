/**
 * Note-wide footnotes for content rendered outside Obsidian's own note
 * renderer. Columns (and, in reading view, the text between them) are
 * rendered piece by piece, so a piece never sees the note's `[^label]:`
 * definitions and footnote numbers restart in every piece. This model reads
 * the whole note once and numbers footnotes the way Obsidian does: in order
 * of first reference, counting `^[inline]` footnotes where they appear.
 */

export interface FootnoteDefinition {
	label: string;
	/** Definition text with continuation lines un-indented. */
	markdown: string;
	/** Source offset of the `[^label]:` line. */
	from: number;
}

/** Footnote of a note, in display order. */
export interface NumberedFootnote {
	number: number;
	/** Set for `[^label]` footnotes. */
	label?: string;
	/** Markdown of the footnote body. */
	markdown: string;
	/** Source offset of the definition; undefined for inline footnotes. */
	definitionFrom?: number;
}

interface FootnoteToken {
	from: number;
	/** Normalized label; undefined for an inline footnote. */
	label?: string;
	/** Inline footnote body. */
	inline?: string;
}

/** Footnote numbers of one rendered piece, in source order. */
export interface PieceFootnotes {
	/** Note numbers of the piece's inline footnotes, in order. */
	inlineNumbers: number[];
}

const DEFINITION_RE = /^ {0,3}\[\^([^\]\s][^\]]*)\]:[ \t]?(.*)$/;
const SETEXT_UNDERLINE_RE = /^ {0,3}(=+|-+)[ \t]*$/;
/** Lines that end a footnote's lazy continuation: they start a new block. */
const BLOCK_START_RE = /^ {0,3}(?:([-*_])[ \t]*(?:\1[ \t]*){2,}$|#{1,6}(?:\s|$)|>|`{3,}|~{3,}|[-*+](?:\s|$)|\d{1,9}[.)](?:\s|$)|<|%%)/;
const REFERENCE_RE =/\[\^([^\]\s][^\]]*)\](?!:)/y;

export function normalizeFootnoteLabel(label: string): string {
	return label.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Cheap check before doing any footnote work. */
export function mayHaveFootnotes(text: string): boolean {
	return text.includes("[^") || text.includes("^[");
}

/**
 * Blank out code and comments so their brackets are never read as
 * footnotes. Offsets are kept: every masked character becomes a space.
 */
function maskIgnored(text: string): string {
	const chars = text.split("");
	const blank = (from: number, to: number) => {
		for (let i = from; i < to; i++) if (chars[i] !== "\n") chars[i] = " ";
	};

	// Fenced code blocks.
	const fenceRe = /^ {0,3}(`{3,}|~{3,})[^\n]*$/gm;
	let open: {from: number; fence: string} | null = null;
	for (let m = fenceRe.exec(text); m; m = fenceRe.exec(text)) {
		const fence = m[1]!;
		if (!open) {
			open = {from: m.index, fence};
		} else if (fence[0] === open.fence[0] && fence.length >= open.fence.length) {
			blank(open.from, m.index + m[0].length);
			open = null;
		}
	}
	if (open) blank(open.from, text.length);

	let masked = chars.join("");
	// Comments (`%% … %%`, also across lines) and inline code.
	for (const re of [/%%[\s\S]*?(?:%%|$)/g, /(`+)[^`\n][\s\S]*?\1/g]) {
		masked = masked.replace(re, (match) => match.replace(/[^\n]/g, " "));
	}
	return masked;
}

/** Index past the `]` closing an inline footnote opened at `open` (the `[`). */
function closeInline(text: string, open: number): number {
	let depth = 0;
	for (let i = open; i < text.length; i++) {
		const ch = text[i];
		if (ch === "\\") {
			i++;
		} else if (ch === "[") {
			depth++;
		} else if (ch === "]") {
			depth--;
			if (depth === 0) return i + 1;
		} else if (ch === "\n" && text[i + 1] === "\n") {
			return -1;
		}
	}
	return -1;
}

/** A `[^label]:` definition block as written in the source. */
export interface DefinitionBlock {
	from: number;
	to: number;
	label: string;
	markdown: string;
}

/**
 * Footnote definitions of `text`. `blocks`, when given, receives every
 * definition block in source order, duplicates included.
 */
function parseDefinitions(
	text: string,
	masked: string,
	blocks?: DefinitionBlock[],
): Map<string, FootnoteDefinition> {
	const definitions = new Map<string, FootnoteDefinition>();
	const lines = masked.split("\n");
	const rawLines = text.split("\n");
	let offset = 0;
	const lineStarts: number[] = [];
	for (const line of rawLines) {
		lineStarts.push(offset);
		offset += line.length + 1;
	}

	for (let i = 0; i < lines.length; i++) {
		const m = DEFINITION_RE.exec(lines[i]!);
		if (!m) continue;
		const body = [DEFINITION_RE.exec(rawLines[i]!)?.[2] ?? m[2]!];
		let j = i + 1;
		let afterBlank = false;
		// Lazy continuation, then indented blocks after blank lines.
		while (j < lines.length) {
			const line = rawLines[j]!;
			if (line.trim() === "") {
				const next = rawLines[j + 1];
				if (next !== undefined && /^( {4}|\t)/.test(next)) {
					body.push("");
					afterBlank = true;
					j++;
					continue;
				}
				break;
			}
			if (afterBlank) {
				if (!/^( {4}|\t)/.test(line)) break;
			} else if (
				// Obsidian's renderer would read `[^x]: text` above `---` as a
				// heading; the editor shows a definition and a rule, and so do
				// the columns (see NoteFootnotes.prepare).
				SETEXT_UNDERLINE_RE.test(line)
				|| DEFINITION_RE.test(lines[j]!)
				|| BLOCK_START_RE.test(line)
			) {
				break;
			}
			body.push(line.replace(/^( {1,4}|\t)/, ""));
			j++;
		}
		// Trailing blank lines are not part of the definition.
		let last = j - 1;
		while (last > i && rawLines[last]!.trim() === "") last--;
		const markdown = body.join("\n").trim();
		blocks?.push({from: lineStarts[i]!, to: lineStarts[last]! + rawLines[last]!.length, label: m[1]!, markdown});
		const label = normalizeFootnoteLabel(m[1]!);
		// The first definition of a label wins, as in Obsidian.
		if (!definitions.has(label)) {
			definitions.set(label, {label: m[1]!, markdown, from: lineStarts[i]!});
		}
		i = j - 1;
	}
	return definitions;
}

/** Text of the placeholder paragraph standing in for definition `index`. */
export function definitionPlaceholder(index: number): string {
	return `amcfootnotedefinition${index}placeholder`;
}

/**
 * Live Preview shows footnote definitions where they are written, as the
 * editor does. Replace each definition block of `piece` with a placeholder
 * paragraph (see definitionPlaceholder) to swap for the rendered definition,
 * so the renderer neither drops it nor moves it to a list at the end.
 */
export function extractFootnoteDefinitions(piece: string): {body: string; definitions: DefinitionBlock[]} {
	if (!mayHaveFootnotes(piece)) return {body: piece, definitions: []};
	const definitions: DefinitionBlock[] = [];
	parseDefinitions(piece, maskIgnored(piece), definitions);
	let body = piece;
	for (let i = definitions.length - 1; i >= 0; i--) {
		const {from, to} = definitions[i]!;
		body = `${body.slice(0, from)}\n\n${definitionPlaceholder(i)}\n\n${body.slice(to)}`;
	}
	return {body, definitions};
}

/** References and inline footnotes in source order. */
function scanTokens(masked: string, text: string): FootnoteToken[] {
	const tokens: FootnoteToken[] = [];
	for (let i = 0; i < masked.length; i++) {
		const ch = masked[i];
		if (ch === "^" && masked[i + 1] === "[" && masked[i - 1] !== "\\") {
			const end = closeInline(masked, i + 1);
			if (end > 0) {
				tokens.push({from: i, inline: text.slice(i + 2, end - 1)});
				i = end - 1;
			}
		} else if (ch === "[" && masked[i + 1] === "^") {
			// `(?!:)` skips the `[^label]:` marker of a definition.
			REFERENCE_RE.lastIndex = i;
			const m = REFERENCE_RE.exec(masked);
			if (m) {
				tokens.push({from: i, label: normalizeFootnoteLabel(m[1]!)});
				i += m[0].length - 1;
			}
		}
	}
	return tokens;
}

export class NoteFootnotes {
	/** Footnotes in display order. */
	readonly list: NumberedFootnote[] = [];
	private readonly numberByLabel = new Map<string, number>();
	private readonly inlineTokens: {from: number; number: number}[] = [];
	private cursor: number;

	private constructor(
		private readonly text: string,
		readonly definitions: Map<string, FootnoteDefinition>,
		tokens: FootnoteToken[],
		private readonly base: number,
	) {
		this.cursor = base;
		for (const token of tokens) {
			if (token.inline !== undefined) {
				const number = this.list.length + 1;
				this.list.push({number, markdown: token.inline});
				this.inlineTokens.push({from: token.from, number});
				continue;
			}
			const label = token.label!;
			const definition = definitions.get(label);
			// A reference without a definition stays plain text.
			if (!definition || this.numberByLabel.has(label)) continue;
			const number = this.list.length + 1;
			this.numberByLabel.set(label, number);
			this.list.push({number, label: definition.label, markdown: definition.markdown, definitionFrom: definition.from});
		}
	}

	/**
	 * Read a note's footnotes. `base` is where the caller's first piece can
	 * start (pieces are located from there on). Null when the note has none.
	 */
	static parse(text: string, base = 0): NoteFootnotes | null {
		if (!mayHaveFootnotes(text)) return null;
		const masked = maskIgnored(text);
		const tokens = scanTokens(masked, text);
		if (tokens.length === 0) return null;
		return new NoteFootnotes(text, parseDefinitions(text, masked), tokens, base);
	}

	/** Whether any reference in the note resolves to a footnote. */
	get isEmpty(): boolean {
		return this.list.length === 0;
	}

	numberOf(label: string): number | undefined {
		return this.numberByLabel.get(normalizeFootnoteLabel(label));
	}

	/**
	 * Markdown to render for a piece. The piece's own definition blocks are
	 * removed — the note's footnotes are listed separately — and the
	 * definitions it uses are appended, so its references render as
	 * footnotes instead of plain text. With
	 * `keepUndefined`, references without a definition get an empty one, so
	 * they still render as references (Live Preview shows them that way).
	 */
	prepare(piece: string, keepUndefined = false): string {
		if (!mayHaveFootnotes(piece)) return piece;
		const masked = maskIgnored(piece);
		const blocks: DefinitionBlock[] = [];
		parseDefinitions(piece, masked, blocks);
		let body = piece;
		// Blank lines in place of each block keep a following `---` a rule.
		for (const {from, to} of blocks.reverse()) {
			body = `${body.slice(0, from)}\n${body.slice(to)}`;
		}
		const needed: FootnoteDefinition[] = [];
		const seen = new Set<string>();
		for (const token of scanTokens(masked, piece)) {
			if (!token.label || seen.has(token.label)) continue;
			seen.add(token.label);
			const definition = this.definitions.get(token.label);
			if (definition) {
				needed.push(definition);
			} else if (keepUndefined) {
				needed.push({label: token.label, markdown: "&#8203;", from: -1});
			}
		}
		if (needed.length === 0) return body;
		const defs = needed.map((d) => {
			const [first, ...rest] = d.markdown.split("\n");
			return [`[^${d.label}]: ${first}`, ...rest.map((line) => (line ? `    ${line}` : line))].join("\n");
		});
		return `${body.replace(/\s+$/, "")}\n\n${defs.join("\n")}\n`;
	}

	/**
	 * Find a piece in the note (pieces are located in source order) and
	 * return the note numbers of its inline footnotes.
	 */
	locate(piece: string): PieceFootnotes {
		if (!piece.includes("^[")) return {inlineNumbers: []};
		let at = this.text.indexOf(piece, this.cursor);
		if (at < 0) at = this.text.indexOf(piece, this.base);
		if (at < 0) return {inlineNumbers: []};
		this.cursor = at + piece.length;
		const end = at + piece.length;
		return {
			inlineNumbers: this.inlineTokens.filter((t) => t.from >= at && t.from < end).map((t) => t.number),
		};
	}
}
