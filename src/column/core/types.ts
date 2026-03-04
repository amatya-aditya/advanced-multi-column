import type {ColumnBackgroundOption, StyleColorOption} from "../../settings";

export type SeparatorLineStyle = "solid" | "dashed" | "dotted" | "double" | "custom";

export interface ColumnStyleData {
	background?: ColumnBackgroundOption;
	borderColor?: StyleColorOption;
	textColor?: StyleColorOption;
	showBorder?: boolean;
	horizontalDividers?: boolean;
	separator?: boolean;
	separatorColor?: StyleColorOption;
	separatorStyle?: SeparatorLineStyle;
	separatorWidth?: number;
	separatorCustomChar?: string;
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
	/** Line number (0-based) of the `%% col-start %%` line */
	lineStart: number;
	/** Line number (0-based) of the `%% col-end %%` line */
	lineEnd: number;
	/** Per-column line ranges: [startLine, endLine] inclusive, 0-based */
	columnLineRanges: [number, number][];
}
