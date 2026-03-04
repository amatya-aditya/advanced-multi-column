import {EditorView} from "@codemirror/view";
import {findColumnRegions, serializeColumns} from "./parser";
import type {ColumnData, ColumnLayout, ColumnRegion, ColumnStyleData} from "./types";
import type {ContainerPath} from "./widget-types";

export function insertColumnAfter(columns: ColumnData[], index: number): ColumnData[] {
	const neighbor = columns[index];
	if (neighbor?.stacked && neighbor.stacked > 0) {
		// Adding inside a stack group: keep all widths intact, new column
		// inherits the stacked group ID and gets width 0 (group width is max).
		const result = [...columns];
		result.splice(index + 1, 0, {content: "", widthPercent: 0, stacked: neighbor.stacked});
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

/**
 * Remove a column while preserving widths of unrelated columns.
 * Only resets widths within the same stack group as the removed column,
 * or resets all widths if a non-stacked column is removed.
 */
export function removeColumnPreservingWidths(
	columns: ColumnData[],
	removeIndex: number,
): ColumnData[] {
	const removedCol = columns[removeIndex];
	const filtered = columns.filter((_, idx) => idx !== removeIndex);
	const removedStackId = removedCol?.stacked;
	if (!removedStackId || removedStackId <= 0) {
		// Removing a non-stacked column: reset all widths (group count changed)
		return filtered.map((col) => ({...col, widthPercent: 0}));
	}
	// Removing a stacked column: find its stack group siblings (same group ID)
	// and clear their widths (the group width is max of members).
	// Other columns keep their widths.
	const groupIndices = new Set<number>();
	// Walk backward from removeIndex to find start of stack group
	for (let j = removeIndex - 1; j >= 0 && columns[j]!.stacked === removedStackId; j--) {
		groupIndices.add(j);
	}
	// Walk forward from removeIndex to find end of stack group
	for (let j = removeIndex + 1; j < columns.length && columns[j]!.stacked === removedStackId; j++) {
		groupIndices.add(j);
	}
	// If the stack group is now empty (removed the only member), just return filtered
	if (groupIndices.size === 0) {
		return filtered;
	}
	// Reset widths only for the remaining members of the same stack group
	return filtered.map((col, newIdx) => {
		// Map new index back to original index
		const origIdx = newIdx >= removeIndex ? newIdx + 1 : newIdx;
		if (groupIndices.has(origIdx)) {
			return {...col, widthPercent: 0};
		}
		return col;
	});
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
		if (columns.length <= 1) {
			return {nextColumns: null, removed: true};
		}
		return {
			nextColumns: removeColumnPreservingWidths(columns, removeIndex),
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

	// Save scroll position to prevent jump when columns change
	const scrollDOM = view.scrollDOM;
	const savedScrollTop = scrollDOM.scrollTop;

	view.dispatch({
		changes: {
			from: region.from,
			to: region.to,
			insert: serializeColumns(columns, effectiveStyle, effectiveLayout),
		},
	});

	// Restore scroll position after dispatch to prevent jumping to end of file
	requestAnimationFrame(() => {
		scrollDOM.scrollTop = savedScrollTop;
	});
}
