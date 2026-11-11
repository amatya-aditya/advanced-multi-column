import assert from "node:assert/strict";
import test from "node:test";
import {
	equalGroupWidths,
	MAGNETIC_RATIOS,
	ratioLabel,
	snapPairRatio,
} from "../../src/column/render/resize-math.ts";

test("snaps a divider to clean architectural ratios within the threshold", () => {
	const at33 = snapPairRatio(34, 100);
	assert.equal(at33.snapped, true);
	assert.ok(Math.abs(at33.left - 100 / 3) < 1e-9);

	const at50 = snapPairRatio(48.2, 100);
	assert.equal(at50.snapped, true);
	assert.equal(at50.left, 50);

	const at75 = snapPairRatio(76.5, 100);
	assert.equal(at75.snapped, true);
	assert.equal(at75.left, 75);
});

test("leaves a split alone outside the magnetic threshold", () => {
	const result = snapPairRatio(41, 100);
	assert.equal(result.snapped, false);
	assert.equal(result.left, 41);
});

test("snaps in the pair's own percentage space", () => {
	// Two 40% groups in a three-column row: half of the pair is 40, not 50.
	const result = snapPairRatio(38, 80);
	assert.equal(result.snapped, true);
	assert.equal(result.left, 40);
	assert.equal(result.ratio, 50);
});

test("every advertised ratio is reachable", () => {
	for (const ratio of MAGNETIC_RATIOS) {
		const left = (ratio / 100) * 100;
		const result = snapPairRatio(left + 1.2, 100);
		assert.equal(result.snapped, true);
		assert.ok(Math.abs(result.ratio - ratio) < 1e-9);
	}
});

test("equal widths sum to 100 and handle empty rows", () => {
	assert.deepEqual(equalGroupWidths(0), []);
	const three = equalGroupWidths(3);
	assert.equal(three.length, 3);
	assert.ok(Math.abs(three.reduce((a, b) => a + b, 0) - 100) < 1e-9);
});

test("ratio labels are rounded pair percentages", () => {
	assert.equal(ratioLabel(33.333, 100), "33% | 67%");
	assert.equal(ratioLabel(50, 100), "50% | 50%");
	assert.equal(ratioLabel(40, 80), "50% | 50%");
	assert.equal(ratioLabel(0, 0), "50% | 50%");
});
