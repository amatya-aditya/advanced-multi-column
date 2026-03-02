import {getPluginInstance} from "../core/plugin-ref";
import {COLOR_CSS} from "../core/column-style";
import type {ColumnData} from "../core/types";
import type {StyleColorOption} from "../../settings";
import type {ColumnGroup} from "./column-renderer";
import {groupColumns, getColumnElements} from "./column-renderer";

let widthCacheKey = "";
let widthCacheResult: number[] = [];

export function resolveEffectiveWidths(columns: ColumnData[]): number[] {
	if (columns.length === 0) return [];
	const key = columns.map((c) => c.widthPercent).join(",");
	if (key === widthCacheKey) return widthCacheResult;

	const fallback = 100 / columns.length;
	const raw = columns.map((col) => (col.widthPercent > 0 ? col.widthPercent : fallback));
	const sum = raw.reduce((acc, value) => acc + value, 0);
	const result = sum <= 0
		? columns.map(() => fallback)
		: raw.map((value) => (value / sum) * 100);

	widthCacheKey = key;
	widthCacheResult = result;
	return result;
}

/**
 * Compute effective widths at the group level, matching how the renderer
 * actually sizes stack groups and individual columns.
 * Each group's representative width is the max widthPercent of its columns.
 */
function resolveGroupEffectiveWidths(groups: ColumnGroup[], columns: ColumnData[]): number[] {
	if (groups.length === 0) return [];
	const fallback = 100 / groups.length;
	const raw = groups.map((g) => {
		const maxW = Math.max(...g.indices.map((idx) => columns[idx]!.widthPercent));
		return maxW > 0 ? maxW : fallback;
	});
	const sum = raw.reduce((a, b) => a + b, 0);
	return sum <= 0
		? groups.map(() => fallback)
		: raw.map((w) => (w / sum) * 100);
}

export function increaseColumnWidth(columns: ColumnData[], index: number): ColumnData[] | null {
	if (columns.length < 2) return null;

	const min = getPluginInstance().settings.minColumnWidthPercent;
	const widthStep = 10;
	const base = resolveEffectiveWidths(columns);

	const donors = base
		.map((w, i) => ({w, i}))
		.filter((entry) => entry.i !== index && entry.w > min)
		.sort((a, b) => b.w - a.w);
	const donor = donors[0];
	if (!donor) return null;

	const maxTarget = 100 - min * (columns.length - 1);
	const targetCurrent = base[index]!;
	const availableForTarget = Math.max(0, maxTarget - targetCurrent);
	const availableFromDonor = Math.max(0, donor.w - min);
	const delta = Math.min(widthStep, availableForTarget, availableFromDonor);
	if (delta <= 0) return null;

	const next = [...base];
	next[index] = targetCurrent + delta;
	next[donor.i] = donor.w - delta;

	return columns.map((col, i) => ({
		...col,
		widthPercent: Math.round(next[i]!),
	}));
}

/**
 * Unified resize handle builder for both top-level and nested column containers.
 * `onColumnsChange` receives the updated columns array when the resize completes.
 */
export function buildResizeHandle(
	container: HTMLElement,
	resizeIndex: number,
	columns: ColumnData[],
	onColumnsChange: (nextColumns: ColumnData[]) => void,
): void {
	const handle = document.createElement("div");
	handle.className = "column-resize-handle";

	// Apply separator styling from the left column
	const leftCol = columns[resizeIndex];
	const sepStyle = leftCol?.style;
	if (sepStyle?.separator) {
		handle.classList.add("has-separator");
		const color = COLOR_CSS[sepStyle.separatorColor as StyleColorOption ?? "gray"] ?? COLOR_CSS.gray;
		handle.style.setProperty("--sep-color", color);
		if (sepStyle.separatorWidth) {
			handle.style.setProperty("--sep-width", `${sepStyle.separatorWidth}px`);
		}
		if (sepStyle.separatorStyle === "custom" && sepStyle.separatorCustomChar) {
			handle.classList.add("has-separator-custom");
			handle.dataset.sepChar = sepStyle.separatorCustomChar;
		} else if (sepStyle.separatorStyle && sepStyle.separatorStyle !== "custom") {
			handle.style.setProperty("--sep-style", sepStyle.separatorStyle);
		}
	}

	container.appendChild(handle);

	let startX = 0;
	let startLeftPct = 0;
	let totalPct = 0;
	let containerWidth = 0;

	const groups = groupColumns(columns);
	const handleShrink = (groups.length - 1) * 8 / groups.length;

	// Find which groups contain the resize boundary columns
	const leftGroupIdx = groups.findIndex((g) => g.indices.includes(resizeIndex));
	const rightGroupIdx = groups.findIndex((g) => g.indices.includes(resizeIndex + 1));

	const resolveResizeEl = (colEl: HTMLElement | undefined): HTMLElement | undefined => {
		if (!colEl) return undefined;
		const stackGroup = colEl.closest<HTMLElement>(".columns-stack-group");
		return stackGroup ?? colEl;
	};

	const computeNewSizes = (dx: number): {newLeft: number; newRight: number} => {
		const delta = (dx / containerWidth) * 100;
		const min = getPluginInstance().settings.minColumnWidthPercent;
		const newLeft = Math.max(min, Math.min(totalPct - min, startLeftPct + delta));
		return {newLeft, newRight: totalPct - newLeft};
	};

	const onMouseMove = (e: MouseEvent) => {
		if (containerWidth === 0) return;
		const {newLeft, newRight} = computeNewSizes(e.clientX - startX);

		const items = getColumnElements(container);
		const leftEl = resolveResizeEl(items[resizeIndex]);
		const rightEl = resolveResizeEl(items[resizeIndex + 1]);
		if (leftEl) leftEl.style.flex = `0 0 calc(${newLeft}% - ${handleShrink.toFixed(1)}px)`;
		if (rightEl) rightEl.style.flex = `0 0 calc(${newRight}% - ${handleShrink.toFixed(1)}px)`;
	};

	const onMouseUp = (e: MouseEvent) => {
		document.removeEventListener("mousemove", onMouseMove);
		document.removeEventListener("mouseup", onMouseUp);
		container.classList.remove("columns-resizing");
		handle.classList.remove("is-active");

		const {newLeft, newRight} = computeNewSizes(e.clientX - startX);

		// Compute explicit widths for ALL groups so no group is left at
		// widthPercent:0 (which would create inconsistent flex behavior).
		const groupWidths = resolveGroupEffectiveWidths(groups, columns);
		const finalGroupWidths = groupWidths.map((w, gi) => {
			if (gi === leftGroupIdx) return newLeft;
			if (gi === rightGroupIdx) return newRight;
			return w;
		});

		const updated = columns.map((col, i) => {
			const gi = groups.findIndex((g) => g.indices.includes(i));
			if (gi < 0) return col;
			// Only store width on the first column of each group to avoid
			// sum > 100% when multiple stacked columns each carry the group width.
			const isFirstInGroup = groups[gi]!.indices[0] === i;
			return {...col, widthPercent: isFirstInGroup ? Math.round(finalGroupWidths[gi]!) : 0};
		});
		onColumnsChange(updated);
	};

	handle.addEventListener("mousedown", (e) => {
		e.preventDefault();
		e.stopPropagation();
		startX = e.clientX;
		containerWidth = container.getBoundingClientRect().width;
		container.classList.add("columns-resizing");
		handle.classList.add("is-active");

		// Use group-level effective widths for the total (guarantees correct sum),
		// but use the DOM pixel ratio for the split to avoid visual jump.
		const groupWidths = resolveGroupEffectiveWidths(groups, columns);
		const gLeftPct = leftGroupIdx >= 0 ? groupWidths[leftGroupIdx]! : 50;
		const gRightPct = rightGroupIdx >= 0 ? groupWidths[rightGroupIdx]! : 50;
		totalPct = gLeftPct + gRightPct;

		const items = getColumnElements(container);
		const leftEl = resolveResizeEl(items[resizeIndex]);
		const rightEl = resolveResizeEl(items[resizeIndex + 1]);
		const leftPx = leftEl ? leftEl.getBoundingClientRect().width : 0;
		const rightPx = rightEl ? rightEl.getBoundingClientRect().width : 0;
		const totalPx = leftPx + rightPx;
		if (totalPx > 0) {
			const ratio = leftPx / totalPx;
			startLeftPct = ratio * totalPct;
		} else {
			startLeftPct = gLeftPct;
		}

		document.addEventListener("mousemove", onMouseMove);
		document.addEventListener("mouseup", onMouseUp);
	});
}
