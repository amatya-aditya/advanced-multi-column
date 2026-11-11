/**
 * Pure geometry for the magnetic column resizer. Kept free of Obsidian and
 * DOM imports so the snapping rules can be unit-tested.
 */

/** Architectural ratios the divider snaps to, as percentages of the pair. */
export const MAGNETIC_RATIOS = [20, 25, 100 / 3, 50, 200 / 3, 75, 80] as const;

/** Default magnetic threshold, in percentage points of the pair. */
export const MAGNETIC_THRESHOLD = 2.5;

export interface SnapResult {
	/** Width of the left group, in the pair's own percentage space. */
	left: number;
	/** Left share of the pair, 0–100. */
	ratio: number;
	/** True when a ratio was within the threshold and the width moved to it. */
	snapped: boolean;
}

/**
 * Snap a pair split to the nearest clean ratio.
 *
 * `left` and `total` are in the document's percentage space (their sum is the
 * pair's total width, e.g. 80 when two 40% groups sit in a row with a third).
 * The ratio is computed in pair space, so a 40/40 pair still snaps at 50/50.
 */
export function snapPairRatio(
	left: number,
	total: number,
	threshold = MAGNETIC_THRESHOLD,
): SnapResult {
	if (!(total > 0)) return {left, ratio: 0, snapped: false};
	const ratio = Math.max(0, Math.min(100, (left / total) * 100));
	let nearest = MAGNETIC_RATIOS[0] as number;
	let bestDistance = Math.abs(ratio - nearest);
	for (const candidate of MAGNETIC_RATIOS) {
		const distance = Math.abs(ratio - candidate);
		if (distance < bestDistance) {
			nearest = candidate;
			bestDistance = distance;
		}
	}
	if (bestDistance > threshold) return {left, ratio, snapped: false};
	return {left: (nearest / 100) * total, ratio: nearest, snapped: true};
}

/** Widths (in percent) that split a row equally across `groups` groups. */
export function equalGroupWidths(groups: number): number[] {
	if (groups <= 0) return [];
	return Array.from({length: groups}, () => 100 / groups);
}

/** Human-readable pill label, e.g. `33% | 67%`. */
export function ratioLabel(left: number, total: number): string {
	if (!(total > 0)) return "50% | 50%";
	const percent = Math.round((left / total) * 100);
	const other = 100 - percent;
	return `${percent}% | ${other}%`;
}
