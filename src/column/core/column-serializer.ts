import {EditorView} from "@codemirror/view";
import {findColumnRegions, serializeColumns} from "./parser";
import type {ColumnData, ColumnLayout, ColumnRegion, ColumnStyleData} from "./types";
import type {ContainerPath} from "./widget-types";

export function insertColumnAfter(columns: ColumnData[], index: number): ColumnData[] {
	const neighbor = columns[index];
	if (neighbor?.stacked) {
		// Adding inside a stack group: keep all widths intact, new column
		// inherits the stacked flag and gets width 0 (group width is max).
		const result = [...columns];
		result.splice(index + 1, 0, {content: "", widthPercent: 0, stacked: true});
		return result;
	}
	// Adding a non-stacked column: reset all widths to equal distribution.
	const normalized = columns.map((col) => ({...col, widthPercent: 0}));
	normalized.splice(index + 1, 0, {content: "", widthPercent: 0});
	return normalized;
}

export function normalizeColumnWidths(columns: ColumnData[]): ColumnData[] {
	return columns.map((col) => ({...col, widthPercent: 0}));
}

export function addChildColumnToContent(content: string): string {
	const nestedRegions = findColumnRegions(content);
	if (nestedRegions.length > 0) {
		const region = nestedRegions[nestedRegions.length - 1]!;
		const nextChildren = [
			...region.columns.map((child) => ({...child, widthPercent: 0})),
			{content: "", widthPercent: 0},
		];
		return (
			content.slice(0, region.from) +
			serializeColumns(nextChildren, region.containerStyle, region.layout) +
			content.slice(region.to)
		);
	}

	const trailingWhitespace = content.match(/\s*$/)?.[0] ?? "";
	const withoutTrailing = content.slice(0, content.length - trailingWhitespace.length);
	const separator = withoutTrailing.length > 0 ? "\n\n" : "";
	const nestedBlock = serializeColumns([{content: "", widthPercent: 0}]);
	return `${withoutTrailing}${separator}${nestedBlock}${trailingWhitespace}`;
}

export function removeColumnAtPath(
	columns: ColumnData[],
	path: ContainerPath,
	removeIndex: number,
): {nextColumns: ColumnData[] | null; removed: boolean} {
	if (path.length === 0) {
		if (removeIndex < 0 || removeIndex >= columns.length) {
			return {nextColumns: columns, removed: false};
		}
		const filtered = columns.filter((_, idx) => idx !== removeIndex);
		if (filtered.length === 0) {
			return {nextColumns: null, removed: true};
		}
		return {
			nextColumns: normalizeColumnWidths(filtered),
			removed: true,
		};
	}

	const [head, ...rest] = path;
	if (!head) return {nextColumns: columns, removed: false};
	const parentColumn = columns[head.columnIndex];
	if (!parentColumn) return {nextColumns: columns, removed: false};

	const regions = findColumnRegions(parentColumn.content).sort((a, b) => a.from - b.from);
	const region = regions[head.regionIndex];
	if (!region) return {nextColumns: columns, removed: false};

	const nestedResult = removeColumnAtPath(region.columns, rest, removeIndex);
	if (!nestedResult.removed) return {nextColumns: columns, removed: false};

	const nextContent =
		nestedResult.nextColumns === null
			? parentColumn.content.slice(0, region.from) +
			  parentColumn.content.slice(region.to)
			: parentColumn.content.slice(0, region.from) +
			  serializeColumns(nestedResult.nextColumns, region.containerStyle, region.layout) +
			  parentColumn.content.slice(region.to);

	const nextColumns = columns.map((column, index) =>
		index === head.columnIndex ? {...column, content: nextContent} : column,
	);
	return {nextColumns, removed: true};
}

export function isSameContainerPath(a: ContainerPath, b: ContainerPath): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		const left = a[i]!;
		const right = b[i]!;
		if (left.columnIndex !== right.columnIndex) return false;
		if (left.regionIndex !== right.regionIndex) return false;
	}
	return true;
}

export function isDestinationInsideMovedColumn(
	sourcePath: ContainerPath,
	sourceIndex: number,
	destinationPath: ContainerPath,
): boolean {
	if (destinationPath.length <= sourcePath.length) return false;
	for (let i = 0; i < sourcePath.length; i++) {
		const left = sourcePath[i]!;
		const right = destinationPath[i]!;
		if (left.columnIndex !== right.columnIndex) return false;
		if (left.regionIndex !== right.regionIndex) return false;
	}
	const next = destinationPath[sourcePath.length];
	return next?.columnIndex === sourceIndex;
}

export function getColumnsAtPath(columns: ColumnData[], path: ContainerPath): ColumnData[] | null {
	if (path.length === 0) return columns;
	const [head, ...rest] = path;
	if (!head) return columns;
	const col = columns[head.columnIndex];
	if (!col) return null;
	const regions = findColumnRegions(col.content).sort((a, b) => a.from - b.from);
	const region = regions[head.regionIndex];
	if (!region) return null;
	return getColumnsAtPath(region.columns, rest);
}

export function updateColumnsAtPath(
	columns: ColumnData[],
	path: ContainerPath,
	updater: (target: ColumnData[]) => ColumnData[],
): ColumnData[] {
	if (path.length === 0) return updater(columns);
	const [head, ...rest] = path;
	if (!head) return updater(columns);
	return columns.map((col, index) => {
		if (index !== head.columnIndex) return col;
		const regions = findColumnRegions(col.content).sort((a, b) => a.from - b.from);
		const region = regions[head.regionIndex];
		if (!region) return col;
		const nextRegionColumns = updateColumnsAtPath(region.columns, rest, updater);
		const nextContent =
			col.content.slice(0, region.from) +
			serializeColumns(nextRegionColumns, region.containerStyle, region.layout) +
			col.content.slice(region.to);
		return {...col, content: nextContent};
	});
}

export function buildStandaloneBlockInsertion(doc: string, cursorPos: number, block: string): string {
	const beforeChar = cursorPos > 0 ? doc[cursorPos - 1] : "";
	const afterChar = cursorPos < doc.length ? doc[cursorPos] : "";

	const parts: string[] = [];
	if (beforeChar && beforeChar !== "\n") parts.push("\n");
	parts.push(block);
	if (afterChar && afterChar !== "\n") parts.push("\n");
	return parts.join("");
}

export function dispatchUpdate(
	region: ColumnRegion,
	columns: ColumnData[],
	view: EditorView,
	containerStyle?: ColumnStyleData,
	layout?: ColumnLayout,
): void {
	const effectiveStyle = containerStyle !== undefined ? containerStyle : region.containerStyle;
	const effectiveLayout = layout !== undefined ? layout : region.layout;
	view.dispatch({
		changes: {
			from: region.from,
			to: region.to,
			insert: serializeColumns(columns, effectiveStyle, effectiveLayout),
		},
	});
}
