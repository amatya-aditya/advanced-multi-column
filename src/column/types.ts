import type {ColumnBackgroundOption, StyleColorOption} from "../settings";

export interface ColumnStyleData {
	background?: ColumnBackgroundOption;
	borderColor?: StyleColorOption;
	textColor?: StyleColorOption;
	showBorder?: boolean;
	horizontalDividers?: boolean;
}

export interface ColumnData {
	content: string;
	widthPercent: number; // 0 means auto/equal
	style?: ColumnStyleData;
}

export interface ColumnRegion {
	/** Document char offset of the first char of `%% col-start %%` */
	from: number;
	/** Document char offset past the last char of `%% col-end %%` */
	to: number;
	/** Parsed columns */
	columns: ColumnData[];
	/** Optional style for the whole column block container */
	containerStyle?: ColumnStyleData;
	/** Line number (0-based) of the `%% col-start %%` line */
	lineStart: number;
	/** Line number (0-based) of the `%% col-end %%` line */
	lineEnd: number;
	/** Per-column line ranges: [startLine, endLine] inclusive, 0-based */
	columnLineRanges: [number, number][];
}
