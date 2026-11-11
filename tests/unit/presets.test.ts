import assert from "node:assert/strict";
import test from "node:test";
import {
	COLUMN_PRESETS,
	columnPresetClass,
	columnPresetInfo,
	isColumnPreset,
	presetOptions,
} from "../../src/column/core/presets.ts";
import {hasColumnStyle} from "../../src/column/core/column-style.ts";

test("all built-in presets are unique, class-safe and scoped", () => {
	const ids = COLUMN_PRESETS.map((preset) => preset.id);
	assert.equal(new Set(ids).size, ids.length);
	for (const preset of COLUMN_PRESETS) {
		assert.equal(isColumnPreset(preset.id), true);
		assert.equal(columnPresetClass(preset.id), preset.className);
		assert.match(preset.className, /^amc-preset-[a-z-]+$/);
		assert.ok(preset.label.length > 0);
		assert.ok(preset.description.length > 0);
		assert.equal(columnPresetInfo(preset.id)?.id, preset.id);
	}
});

test("unknown presets are rejected rather than written to markers", () => {
	assert.equal(isColumnPreset("apple-glass-unknown"), false);
	assert.equal(isColumnPreset(""), false);
	assert.equal(columnPresetClass("nope"), "");
	assert.equal(columnPresetInfo(undefined), undefined);
});

test("preset options include a None entry first", () => {
	const options = presetOptions("column");
	assert.equal(options[0]!.value, "");
	for (const preset of COLUMN_PRESETS) {
		assert.ok(options.some((option) => option.value === preset.id));
	}
});

test("new style fields count as a real style", () => {
	assert.equal(hasColumnStyle({preset: "apple-card"}), true);
	assert.equal(hasColumnStyle({maxHeight: 320}), true);
	assert.equal(hasColumnStyle({fold: true}), true);
	assert.equal(hasColumnStyle({maxHeight: 5}), false);
	assert.equal(hasColumnStyle({preset: "bogus"}), false);
	assert.equal(hasColumnStyle(undefined), false);
});

test("friendly aliases normalize to canonical preset ids", async () => {
	const {normalizePreset} = await import("../../src/column/core/presets.ts");
	assert.equal(normalizePreset("mint-card"), "soft-mint");
	assert.equal(normalizePreset("glass"), "glass-panel");
	assert.equal(normalizePreset("bento"), "apple-bento");
	assert.equal(normalizePreset("soft-mint"), "soft-mint");
	assert.equal(normalizePreset("unknown"), undefined);
});

test("marker aliases parse to canonical presets", async () => {
	const {findColumnRegions} = await import("../../src/column/core/parser.ts");
	const region = findColumnRegions(
		"%% col-start %%\n%% col-break:50,preset:mint-card %%\nx\n%% col-end %%",
	)[0]!;
	assert.equal(region.columns[0]!.style?.preset, "soft-mint");
});
