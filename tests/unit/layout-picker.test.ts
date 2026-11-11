import assert from "node:assert/strict";
import test from "node:test";
import {PICKER_TEMPLATES} from "../../src/layout-picker-templates.ts";
import {findColumnRegions} from "../../src/column/core/parser.ts";

test("every picker template inserts exactly one valid top-level column block", () => {
	for (const template of PICKER_TEMPLATES) {
		const doc = template.lines.join("\n");
		const regions = findColumnRegions(doc);
		assert.equal(regions.length, 1, `${template.id} should produce one top-level region`);
		const region = regions[0]!;
		assert.equal(region.from, 0, `${template.id} should start with its col-start marker`);
		assert.equal(region.to, doc.length, `${template.id} should end with its col-end marker`);
		assert.ok(region.columns.length >= 2, `${template.id} should have at least two columns`);
		assert.equal(region.containerStyle?.preset, template.id === "two-equal"
			|| template.id === "sidebar-main"
			|| template.id === "main-inspector"
			? undefined
			: "apple-bento");
	}
});

test("the Bento grid nests a two-column grid inside its 60% column", () => {
	const template = PICKER_TEMPLATES.find((t) => t.id === "apple-bento")!;
	const outer = findColumnRegions(template.lines.join("\n"))[0]!;
	assert.equal(outer.columns.length, 2);
	assert.equal(outer.columns[0]!.widthPercent, 40);
	assert.equal(outer.columns[1]!.widthPercent, 60);
	const nested = findColumnRegions(outer.columns[1]!.content);
	assert.equal(nested.length, 2, "the 60% column should contain two stacked nested rows");
	for (const region of nested) {
		assert.equal(region.columns.length, 2);
		assert.equal(region.columns[0]!.widthPercent, 50);
		assert.equal(region.columns[1]!.widthPercent, 50);
	}
});

test("Holy Grail inserts 20 / 60 / 20", () => {
	const template = PICKER_TEMPLATES.find((t) => t.id === "holy-grail")!;
	const region = findColumnRegions(template.lines.join("\n"))[0]!;
	assert.deepEqual(region.columns.map((column) => column.widthPercent), [20, 60, 20]);
});

function assertLeafContentHasNoMarkers(region: ReturnType<typeof findColumnRegions>[number], id: string): void {
	for (const column of region.columns) {
		const nested = findColumnRegions(column.content);
		if (nested.length > 0) {
			for (const child of nested) assertLeafContentHasNoMarkers(child, id);
			continue;
		}
		assert.ok(!/^%%\s*col-(start|break|end)/m.test(column.content.trim()), id);
	}
}

test("template markers never leak into leaf column content", () => {
	for (const template of PICKER_TEMPLATES) {
		const region = findColumnRegions(template.lines.join("\n"))[0]!;
		assertLeafContentHasNoMarkers(region, template.id);
	}
});
