import type {ColumnBackgroundOption, StyleColorOption} from "../../settings";
import type {ColumnPreset} from "./presets";

export type SeparatorLineStyle = "solid" | "dashed" | "dotted" | "double" | "custom";

export interface ColumnStyleData {
	background?: ColumnBackgroundOption;
	borderColor?: StyleColorOption;
	textColor?: StyleColorOption;
	showBorder?: boolean;
	/** Show only left border (callout-style) instead of full border */
	leftBorder?: boolean;
	horizontalDividers?: boolean;
	separator?: boolean;
	separatorColor?: StyleColorOption;
	separatorStyle?: SeparatorLineStyle;
	separatorWidth?: number;
	separatorCustomChar?: string;
	/** Named design preset (`preset:<name>`), see core/presets. */
	preset?: ColumnPreset;
	/** Cap the column body at this height in px (`mh:<px>`). */
	maxHeight?: number;
	/** Show a fold chevron in the column header (`fold:1`). */
	fold?: boolean;
}

export interface ColumnData {
	content: string;
	widthPercent: number; // 0 means auto/equal
	style?: ColumnStyleData;
	/** Stack group ID: 0/undefined = not stacked, positive number = stack group */
	stacked?: number;
}

export type ColumnLayout = "row" | "stack";

export interface ColumnRegion {
	/** Document char offset of the first char of `%% col-start %%` */
	from: number;
	/** Document char offset past the last char of `%% col-end %%` */
	to: number;
	/** Parsed columns */
	columns: ColumnData[];
	/** Optional style for the whole column block container */
	containerStyle?: ColumnStyleData;
	/** Layout direction: "row" (side-by-side, default) or "stack" (top-to-bottom) */
	layout?: ColumnLayout;
	/** MOC template that generates this block (`moc:<id>` on col-start). */
	mocId?: string;
	/**
	 * Virtual MOC block (`v:1`): only a compact marker is stored; matching
	 * links are resolved in memory at render time and never written to disk.
	 */
	virtual?: boolean;
	/** Line number (0-based) of the `%% col-start %%` line */
	lineStart: number;
	/** Line number (0-based) of the `%% col-end %%` line */
	lineEnd: number;
	/** Per-column line ranges: [startLine, endLine] inclusive, 0-based */
	columnLineRanges: [number, number][];
	/**
	 * Per-column trimmed content ranges as character offsets. For a top-level
	 * region these are document offsets; nested/scanned strings use offsets
	 * into that string. Empty columns have from === to (the insertion point).
	 * Used by the real-time sub-editor mirror to map local changes back into
	 * the note without re-serializing the whole block.
	 */
	columnContentRanges: [number, number][];
}
