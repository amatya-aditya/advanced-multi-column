import {isColumnMarkerLine} from "./parser";

/** Result of removing the column markers from one note. */
export interface MarkerRemoval {
	text: string;
	/** Marker lines removed. */
	removed: number;
	/** Marker lines left alone because they are inside a fenced code block. */
	inCode: number;
}

/** Opening or closing fence of a code block: up to 3 spaces, then ``` or ~~~. */
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;

/**
 * Remove this plugin's column markers (`%% col-start %%`, `%% col-break %%`,
 * `%% col-end %%`, with any payload) from a note and keep everything else, so
 * the columns' content reads as ordinary text in the same order.
 *
 * Only whole marker lines are removed: other comments, callout columns and
 * markers inside fenced code blocks (syntax examples) are left as they are.
 * A removed marker leaves at most one blank line: the blank line after it is
 * dropped when there is one before it, and one is added when it sat between
 * two lines of text, which would otherwise merge into one paragraph.
 */
export function removeColumnMarkers(text: string): MarkerRemoval {
	const lines = text.split("\n");
	const out: string[] = [];
	let removed = 0;
	let inCode = 0;
	let fence: string | null = null;
	/** What the line after a removed marker needs: its blank dropped, or a blank before it. */
	let after: "drop-blank" | "need-blank" | null = null;
	const isBlank = (line: string | undefined) => line === undefined || line.trim() === "";
	const push = (line: string) => {
		if (after === "need-blank" && !isBlank(line)) out.push(line.endsWith("\r") ? "\r" : "");
		after = null;
		out.push(line);
	};

	for (const line of lines) {
		const fenceMatch = line.match(FENCE_RE);
		if (fence) {
			const closing = fenceMatch && fenceMatch[1]![0] === fence[0]
				&& fenceMatch[1]!.length >= fence.length && line.trim() === fenceMatch[1];
			if (closing) fence = null;
			else if (isColumnMarkerLine(line)) inCode++;
			push(line);
			continue;
		}
		if (fenceMatch) {
			fence = fenceMatch[1]!;
			push(line);
			continue;
		}
		if (isColumnMarkerLine(line)) {
			removed++;
			if (after === null) after = isBlank(out[out.length - 1]) ? "drop-blank" : "need-blank";
			continue;
		}
		if (after === "drop-blank" && isBlank(line)) {
			after = null;
			continue;
		}
		push(line);
	}
	return removed > 0 ? {text: out.join("\n"), removed, inCode} : {text, removed, inCode};
}
