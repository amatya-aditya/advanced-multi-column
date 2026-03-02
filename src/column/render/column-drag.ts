import {EditorView} from "@codemirror/view";
import {findColumnRegions, serializeColumns} from "../core/parser";
import type {ColumnRegion} from "../core/types";
import type {ContainerPath, ActiveDragState} from "../core/widget-types";
import {getInteractionState} from "../editor/interaction-state";
import {
	getColumnsAtPath,
	removeColumnAtPath,
	updateColumnsAtPath,
	normalizeColumnWidths,
	isSameContainerPath,
	isDestinationInsideMovedColumn,
	buildStandaloneBlockInsertion,
	dispatchUpdate,
} from "../core/column-serializer";
import type {ColumnData} from "../core/types";

/**
 * Resolve the `stacked` flag for a column being inserted at `insertAt`
 * based on its neighbors. If neighbors are stacked, the inserted column
 * should join the stack group; otherwise clear the flag.
 */
function resolveStackedForInsert(target: ColumnData[], insertAt: number): boolean {
	const prev = target[insertAt - 1];
	const next = target[insertAt];
	return !!(prev?.stacked || next?.stacked);
}

export function moveColumnBetweenContainers(
	region: ColumnRegion,
	sourcePath: ContainerPath,
	sourceIndex: number,
	destinationPath: ContainerPath,
	destinationIndex: number,
	view: EditorView,
): void {
	if (isDestinationInsideMovedColumn(sourcePath, sourceIndex, destinationPath)) return;

	const rootColumns = region.columns;
	const sourceColumns = getColumnsAtPath(rootColumns, sourcePath);
	const destinationColumns = getColumnsAtPath(rootColumns, destinationPath);
	if (!sourceColumns || !destinationColumns) return;
	if (sourceIndex < 0 || sourceIndex >= sourceColumns.length) return;
	if (destinationIndex < 0 || destinationIndex >= destinationColumns.length) return;

	const sameContainer = isSameContainerPath(sourcePath, destinationPath);

	const moving = sourceColumns[sourceIndex];
	if (!moving) return;

	if (sameContainer) {
		const adjustedIndex = sourceIndex < destinationIndex
			? destinationIndex - 1
			: destinationIndex;
		if (adjustedIndex === sourceIndex) return;
		const reordered = [...sourceColumns];
		const [removed] = reordered.splice(sourceIndex, 1);
		if (!removed) return;
		const shouldStack = resolveStackedForInsert(reordered, adjustedIndex);
		reordered.splice(adjustedIndex, 0, {...removed, stacked: shouldStack || undefined});
		const nextRoot = updateColumnsAtPath(rootColumns, sourcePath, () => reordered);
		dispatchUpdate(region, nextRoot, view);
		return;
	}

	const removed = removeColumnAtPath(rootColumns, sourcePath, sourceIndex);
	const sourceRemovedRoot = removed.nextColumns;
	if (!removed.removed || !sourceRemovedRoot) return;

	const nextRoot = updateColumnsAtPath(sourceRemovedRoot, destinationPath, (target) => {
		const insertAt = Math.max(0, Math.min(destinationIndex, target.length));
		const shouldStack = resolveStackedForInsert(target, insertAt);
		const inserted = [...target];
		inserted.splice(insertAt, 0, {...moving, widthPercent: 0, stacked: shouldStack || undefined});
		return normalizeColumnWidths(inserted);
	});

	dispatchUpdate(region, nextRoot, view);
}

export function moveColumnBetweenBlocks(
	region: ColumnRegion,
	sourceDrag: ActiveDragState,
	destinationPath: ContainerPath,
	destinationIndex: number,
	view: EditorView,
): void {
	const doc = view.state.doc.toString();
	const regions = findColumnRegions(doc);
	const sourceRegion = regions.find((r) => r.from === sourceDrag.sourceRegionFrom);
	const destinationRegion = regions.find((r) => r.from === region.from);
	if (!sourceRegion || !destinationRegion) return;

	if (sourceRegion.from === destinationRegion.from) {
		moveColumnBetweenContainers(
			region,
			sourceDrag.sourcePath,
			sourceDrag.sourceIndex,
			destinationPath,
			destinationIndex,
			view,
		);
		return;
	}

	const sourceColumns = getColumnsAtPath(sourceRegion.columns, sourceDrag.sourcePath);
	const destinationColumns = getColumnsAtPath(destinationRegion.columns, destinationPath);
	if (!sourceColumns || !destinationColumns) return;
	if (sourceDrag.sourceIndex < 0 || sourceDrag.sourceIndex >= sourceColumns.length) return;
	if (destinationIndex < 0 || destinationIndex >= destinationColumns.length) return;

	const moving = sourceColumns[sourceDrag.sourceIndex];
	if (!moving) return;

	const removed = removeColumnAtPath(
		sourceRegion.columns,
		sourceDrag.sourcePath,
		sourceDrag.sourceIndex,
	);
	if (!removed.removed) return;
	const nextSourceRoot = removed.nextColumns;
	const nextDestinationRoot = updateColumnsAtPath(
		destinationRegion.columns,
		destinationPath,
		(target) => {
			const insertAt = Math.max(0, Math.min(destinationIndex, target.length));
			const shouldStack = resolveStackedForInsert(target, insertAt);
			const inserted = [...target];
			inserted.splice(insertAt, 0, {...moving, widthPercent: 0, stacked: shouldStack || undefined});
			return normalizeColumnWidths(inserted);
		},
	);

	const sourceReplacement =
		nextSourceRoot === null
			? ""
			: serializeColumns(nextSourceRoot, sourceRegion.containerStyle, sourceRegion.layout);

	const changes = [
		{
			from: sourceRegion.from,
			to: sourceRegion.to,
			insert: sourceReplacement,
		},
		{
			from: destinationRegion.from,
			to: destinationRegion.to,
			insert: serializeColumns(nextDestinationRoot, destinationRegion.containerStyle, destinationRegion.layout),
		},
	].sort((a, b) => a.from - b.from);

	view.dispatch({changes});
}

export function moveColumnToCursorBlock(sourceDrag: ActiveDragState, view: EditorView, dropPos?: number): void {
	const doc = view.state.doc.toString();
	const regions = findColumnRegions(doc);
	const sourceRegion = regions.find((r) => r.from === sourceDrag.sourceRegionFrom);
	if (!sourceRegion) return;

	const sourceColumns = getColumnsAtPath(sourceRegion.columns, sourceDrag.sourcePath);
	if (!sourceColumns) return;
	if (sourceDrag.sourceIndex < 0 || sourceDrag.sourceIndex >= sourceColumns.length) return;

	const moving = sourceColumns[sourceDrag.sourceIndex];
	if (!moving) return;

	const removed = removeColumnAtPath(
		sourceRegion.columns,
		sourceDrag.sourcePath,
		sourceDrag.sourceIndex,
	);
	if (!removed.removed) return;
	const nextSourceRoot = removed.nextColumns;

	let insertPos = dropPos ?? view.state.selection.main.head;
	if (insertPos >= sourceRegion.from && insertPos <= sourceRegion.to) {
		insertPos = sourceRegion.to;
	}
	const standaloneBlock = serializeColumns([{...moving, widthPercent: 0, stacked: undefined}]);
	const insertion = buildStandaloneBlockInsertion(doc, insertPos, standaloneBlock);
	const sourceReplacement =
		nextSourceRoot === null
			? ""
			: serializeColumns(nextSourceRoot, sourceRegion.containerStyle, sourceRegion.layout);

	const changes = [
		{
			from: sourceRegion.from,
			to: sourceRegion.to,
			insert: sourceReplacement,
		},
		{
			from: insertPos,
			to: insertPos,
			insert: insertion,
		},
	].sort((a, b) => a.from - b.from);

	view.dispatch({changes});
}

/**
 * Resolve a line-boundary insertion position from mouse coordinates.
 * Returns the document offset at the start of the nearest line boundary,
 * snapping to the closest gap between lines.
 */
function resolveDropPosition(x: number, y: number, view: EditorView): number | null {
	const target = document.elementFromPoint(x, y);
	if (!(target instanceof HTMLElement) || !view.dom.contains(target)
		|| target.closest(".columns-container") || target.closest(".column-item")) {
		return null;
	}
	const pos = view.posAtCoords({x, y});
	if (pos === null) return null;

	// Snap to the nearest line boundary (start or end of the line)
	const line = view.state.doc.lineAt(pos);
	const midOffset = (line.from + line.to) / 2;
	// If mouse is in the top half of the line, insert before; otherwise after
	return pos <= midOffset ? line.from : line.to;
}

export function startDragPointerTracking(
	initialEvent: DragEvent,
	view: EditorView,
): void {
	const iState = getInteractionState(view);
	if (iState.cleanupActiveDragTracking) {
		iState.cleanupActiveDragTracking();
		iState.cleanupActiveDragTracking = null;
	}

	iState.activeDragPoint = {x: initialEvent.clientX, y: initialEvent.clientY};
	iState.resolvedDropPos = null;

	const showCursorIndicator = (x: number, y: number) => {
		const dropPos = resolveDropPosition(x, y, view);
		if (dropPos === null) {
			iState.resolvedDropPos = null;
			hideCursorDropIndicator(view);
			return;
		}
		iState.resolvedDropPos = dropPos;
		// Get the coordinates for the resolved line boundary position
		const coords = view.coordsAtPos(dropPos);
		if (!coords) {
			hideCursorDropIndicator(view);
			return;
		}
		showCursorDropIndicator(view, coords.top);
	};

	const updatePoint = (event: DragEvent) => {
		iState.activeDragPoint = {x: event.clientX, y: event.clientY};
		showCursorIndicator(event.clientX, event.clientY);
	};

	document.addEventListener("dragover", updatePoint, true);
	document.addEventListener("drop", updatePoint, true);
	iState.cleanupActiveDragTracking = () => {
		document.removeEventListener("dragover", updatePoint, true);
		document.removeEventListener("drop", updatePoint, true);
	};
}

export function showCursorDropIndicator(view: EditorView, top: number): void {
	const iState = getInteractionState(view);
	if (!iState.cursorDropIndicator) {
		iState.cursorDropIndicator = document.createElement("div");
		iState.cursorDropIndicator.className = "amc-cursor-drop-indicator";
	}
	const scrollDom = view.scrollDOM;
	const scrollRect = scrollDom.getBoundingClientRect();
	const contentDom = view.contentDOM;
	const contentRect = contentDom.getBoundingClientRect();
	iState.cursorDropIndicator.style.top = `${top - scrollRect.top + scrollDom.scrollTop}px`;
	iState.cursorDropIndicator.style.left = `${contentRect.left - scrollRect.left + scrollDom.scrollLeft}px`;
	iState.cursorDropIndicator.style.width = `${contentRect.width}px`;
	if (iState.cursorDropIndicator.parentElement !== scrollDom) {
		scrollDom.appendChild(iState.cursorDropIndicator);
	}
}

export function hideCursorDropIndicator(view: EditorView): void {
	getInteractionState(view).cursorDropIndicator?.remove();
}

export function stopDragPointerTracking(view: EditorView): void {
	const iState = getInteractionState(view);
	if (iState.cleanupActiveDragTracking) {
		iState.cleanupActiveDragTracking();
		iState.cleanupActiveDragTracking = null;
	}
	iState.activeDragPoint = null;
	iState.resolvedDropPos = null;
	hideCursorDropIndicator(view);
}

export function resolveDragPoint(event: DragEvent, view: EditorView): {x: number; y: number} | null {
	const hasPoint = Number.isFinite(event.clientX) && Number.isFinite(event.clientY);
	if (hasPoint && (event.clientX !== 0 || event.clientY !== 0)) {
		return {x: event.clientX, y: event.clientY};
	}
	return getInteractionState(view).activeDragPoint;
}

export function shouldInsertDraggedBlockAtCursor(event: DragEvent, view: EditorView): boolean {
	const point = resolveDragPoint(event, view);
	if (!point) return false;
	const target = document.elementFromPoint(point.x, point.y);
	if (!(target instanceof HTMLElement)) return false;
	if (!view.dom.contains(target)) return false;
	if (target.closest(".columns-container")) return false;
	if (target.closest(".column-item")) return false;
	return true;
}

export function wireDragItem(
	item: HTMLElement,
	handle: HTMLElement,
	containerPath: ContainerPath,
	index: number,
	view: EditorView,
	region: ColumnRegion,
): void {
	handle.addEventListener("mousedown", (e) => {
		e.stopPropagation();
		item.setAttribute("draggable", "true");
	});

	item.addEventListener("mousedown", (e) => {
		if (e.altKey) {
			e.stopPropagation();
			item.setAttribute("draggable", "true");
		}
	});

	item.addEventListener("dragstart", (e: DragEvent) => {
		if (e.target !== item) return;
		e.stopPropagation();
		if (!e.dataTransfer) return;
		e.dataTransfer.effectAllowed = "move";
		e.dataTransfer.setData("text/plain", "");
		getInteractionState(view).activeDragState = {
			sourceRegionFrom: region.from,
			sourcePath: containerPath.map((entry) => ({...entry})),
			sourceIndex: index,
			dropHandled: false,
		};
		startDragPointerTracking(e, view);
		item.classList.add("column-dragging");
	});

	item.addEventListener("dragover", (e: DragEvent) => {
		if (!getInteractionState(view).activeDragState) return;
		e.preventDefault();
		e.stopPropagation();
		if (e.dataTransfer) e.dataTransfer.dropEffect = "move";

		const rect = item.getBoundingClientRect();
		const inStackGroup = item.closest(".columns-stack-group") !== null;
		const dropBefore = inStackGroup
			? e.clientY < rect.top + rect.height / 2
			: e.clientX < rect.left + rect.width / 2;
		item.classList.toggle("column-drop-before", dropBefore);
		item.classList.toggle("column-drop-after", !dropBefore);
		item.classList.add("column-drag-over");
	});

	item.addEventListener("dragleave", () => {
		item.classList.remove("column-drag-over", "column-drop-before", "column-drop-after");
	});

	item.addEventListener("drop", (e: DragEvent) => {
		const dropIState = getInteractionState(view);
		if (!dropIState.activeDragState) return;
		e.preventDefault();
		e.stopPropagation();
		if (!e.dataTransfer) return;

		const rect = item.getBoundingClientRect();
		const inStackGroup = item.closest(".columns-stack-group") !== null;
		const dropBefore = inStackGroup
			? e.clientY < rect.top + rect.height / 2
			: e.clientX < rect.left + rect.width / 2;
		const dropIndex = dropBefore ? index : index + 1;

		item.classList.remove("column-drag-over", "column-drop-before", "column-drop-after");
		const source = dropIState.activeDragState;
		source.dropHandled = true;
		if (source.sourceRegionFrom === region.from) {
			moveColumnBetweenContainers(
				region,
				source.sourcePath,
				source.sourceIndex,
				containerPath,
				dropIndex,
				view,
			);
			return;
		}
		moveColumnBetweenBlocks(region, source, containerPath, dropIndex, view);
	});

	item.addEventListener("dragend", (e: DragEvent) => {
		if (e.target !== item) return;
		e.stopPropagation();
		item.classList.remove("column-dragging", "column-drag-over", "column-drop-before", "column-drop-after");
		item.setAttribute("draggable", "false");
		const endIState = getInteractionState(view);
		const source = endIState.activeDragState;
		if (
			source &&
			!source.dropHandled &&
			shouldInsertDraggedBlockAtCursor(e, view)
		) {
			const dropPos = endIState.resolvedDropPos ?? undefined;
			moveColumnToCursorBlock(source, view, dropPos);
		}
		endIState.activeDragState = null;
		stopDragPointerTracking(view);
	});
}
