import assert from "node:assert/strict";
import test from "node:test";
import {
	findColumnRegions,
	isColumnMarkerLine,
	serializeColumns,
	serializeVirtualMocMarker,
} from "../../src/column/core/parser.ts";

function onlyRegion(text: string) {
	const regions = findColumnRegions(text);
	assert.equal(regions.length, 1, `expected exactly one region in:\n${text}`);
	return regions[0]!;
}

test("legacy markers still parse with widths, styles and exact content offsets", () => {
	const doc = [
		"before",
		"%% col-start %%",
		"",
		"%% col-break:40,b:blue-soft %%",
		"**Alpha**",
		"",
		"%% col-break:60 %%",
		"Beta",
		"%% col-end %%",
		"after",
	].join("\n");
	const region = onlyRegion(doc);
	assert.equal(region.from, doc.indexOf("%% col-start"));
	assert.equal(region.to, doc.indexOf("%% col-end") + "%% col-end %%".length);
	assert.equal(region.columns.length, 2);
	assert.equal(region.columns[0]!.content, "**Alpha**");
	assert.equal(region.columns[0]!.widthPercent, 40);
	assert.equal(region.columns[0]!.style?.background, "blue-soft");
	assert.equal(region.columns[1]!.content, "Beta");
	assert.equal(region.columns[1]!.widthPercent, 60);

	assert.equal(
		doc.slice(region.columnContentRanges[0]![0], region.columnContentRanges[0]![1]),
		"**Alpha**",
	);
	assert.equal(
		doc.slice(region.columnContentRanges[1]![0], region.columnContentRanges[1]![1]),
		"Beta",
	);
});

test("content before the first col-break is ignored, as before", () => {
	const region = onlyRegion("%% col-start %%\nignored intro\n%% col-break %%\nkept\n%% col-end %%");
	assert.equal(region.columns.length, 1);
	assert.equal(region.columns[0]!.content, "kept");
});

test("empty columns expose a usable insertion point", () => {
	const doc = "%% col-start %%\n%% col-break:50 %%\n%% col-break:50 %%\n%% col-end %%";
	const region = onlyRegion(doc);
	for (const [from, to] of region.columnContentRanges) {
		assert.equal(from, to);
		assert.ok(from >= 0 && from <= doc.length);
	}
});

test("markers inside a fenced code block are ignored (reading view / nested path)", () => {
	const doc = [
		"```markdown",
		"%% col-start %%",
		"%% col-break %%",
		"not a column",
		"%% col-end %%",
		"```",
		"",
		"%% col-start %%",
		"%% col-break %%",
		"real",
		"%% col-end %%",
	].join("\n");
	const regions = findColumnRegions(doc);
	assert.equal(regions.length, 1);
	assert.equal(regions[0]!.columns[0]!.content, "real");
});

test("markers inside raw HTML blocks with blank lines do not leak", () => {
	const doc = [
		"<div>",
		"",
		"%% col-start %%",
		"%% col-break %%",
		"leak",
		"%% col-end %%",
		"",
		"</div>",
	].join("\n");
	assert.equal(findColumnRegions(doc).length, 0);
});

test("markers inside block math are ignored", () => {
	const doc = ["$$", "%% col-start %%", "%% col-break %%", "%% col-end %%", "$$"].join("\n");
	assert.equal(findColumnRegions(doc).length, 0);
});

test("a syntax-tree predicate excludes marker positions in live preview", () => {
	const doc = "%% col-start %%\n%% col-break %%\nx\n%% col-end %%";
	const blocked = doc.indexOf("%% col-start");
	const regions = findColumnRegions(doc, {
		isIgnoredPosition: (pos) => pos >= blocked && pos < blocked + 2,
	});
	assert.equal(regions.length, 0);
});

test("serialize → parse round-trips named presets, max height and fold", () => {
	const block = serializeColumns(
		[
			{
				content: "Hello",
				widthPercent: 50,
				style: {preset: "soft-mint", maxHeight: 320, fold: true},
			},
			{content: "World", widthPercent: 50},
		],
		{preset: "apple-bento"},
		"stack",
		"moc-1",
	);
	const region = onlyRegion(block);
	assert.equal(region.mocId, "moc-1");
	assert.equal(region.layout, "stack");
	assert.equal(region.containerStyle?.preset, "apple-bento");
	assert.equal(region.columns[0]!.style?.preset, "soft-mint");
	assert.equal(region.columns[0]!.style?.maxHeight, 320);
	assert.equal(region.columns[0]!.style?.fold, true);
	assert.match(block, /preset:apple-bento/);
	assert.match(block, /mh:320/);
	assert.match(block, /fold:1/);
});

test("virtual MOC markers parse as an empty region carrying the template id", () => {
	const marker = serializeVirtualMocMarker("moc-2", {preset: "apple-bento"});
	const region = onlyRegion(marker);
	assert.equal(region.virtual, true);
	assert.equal(region.mocId, "moc-2");
	assert.equal(region.columns.length, 0);
	assert.equal(region.containerStyle?.preset, "apple-bento");
});

test("marker line helper stays compatible with all legacy forms", () => {
	assert.equal(isColumnMarkerLine("%% col-start %%"), true);
	assert.equal(isColumnMarkerLine("%%   col-break:50,b:blue-soft   %%"), true);
	assert.equal(isColumnMarkerLine("%% col-end %%"), true);
	assert.equal(isColumnMarkerLine("  %% col-end %%  "), true);
	assert.equal(isColumnMarkerLine("%% not-a-marker %%"), false);
});

test("widths summing over 100% fall back to equal, preserving content", () => {
	const region = onlyRegion(
		"%% col-start %%\n%% col-break:70 %%\na\n%% col-break:70 %%\nb\n%% col-end %%",
	);
	assert.deepEqual(region.columns.map((column) => column.widthPercent), [0, 0]);
	assert.deepEqual(region.columns.map((column) => column.content), ["a", "b"]);
});

test("a fenced block inside a column keeps its own col-break lines as content", () => {
	const doc = [
		"%% col-start %%",
		"%% col-break %%",
		"```markdown",
		"%% col-break %%",
		"%% col-end %%",
		"```",
		"after",
		"%% col-end %%",
	].join("\n");
	const region = onlyRegion(doc);
	assert.equal(region.columns.length, 1);
	assert.match(region.columns[0]!.content, /%% col-break %%/);
	assert.match(region.columns[0]!.content, /after/);
});

test("an HTML block with blank lines inside a column does not leak its col-break", () => {
	const doc = [
		"%% col-start %%",
		"%% col-break %%",
		"<div>",
		"",
		"%% col-break %%",
		"inside html",
		"",
		"</div>",
		"tail",
		"%% col-end %%",
	].join("\n");
	const region = onlyRegion(doc);
	assert.equal(region.columns.length, 1, "the inner break must stay inside the column");
	assert.match(region.columns[0]!.content, /inside html/);
	assert.match(region.columns[0]!.content, /tail/);
});

test("multi-line content offsets point at the exact trimmed text", () => {
	const doc = [
		"%% col-start %%",
		"",
		"%% col-break:30 %%",
		"",
		"line one",
		"",
		"line two",
		"",
		"%% col-break:70 %%",
		"  padded  ",
		"%% col-end %%",
	].join("\n");
	const region = onlyRegion(doc);
	assert.equal(region.columns[0]!.content, "line one\n\nline two");
	assert.equal(
		doc.slice(region.columnContentRanges[0]![0], region.columnContentRanges[0]![1]),
		"line one\n\nline two",
	);
	assert.equal(region.columns[1]!.content, "padded");
	assert.equal(
		doc.slice(region.columnContentRanges[1]![0], region.columnContentRanges[1]![1]),
		"padded",
	);
});

test("CRLF documents keep valid offsets and content", () => {
	const doc = "%% col-start %%\r\n%% col-break %%\r\nhello\r\n%% col-end %%";
	const region = onlyRegion(doc);
	assert.equal(region.columns[0]!.content, "hello");
	assert.equal(
		doc.slice(region.columnContentRanges[0]![0], region.columnContentRanges[0]![1]),
		"hello",
	);
});

test("line numbers and marker ranges are reported for every region", () => {
	const doc = "intro\n%% col-start %%\n%% col-break %%\nx\n%% col-end %%";
	const region = onlyRegion(doc);
	assert.equal(region.lineStart, 1);
	assert.equal(region.lineEnd, 4);
	assert.deepEqual(region.columnLineRanges, [[3, 3]]);
});

test("frontmatter with marker-looking lines is ignored", () => {
	const doc = ["---", "%% col-start %%", "%% col-end %%", "---", "body"].join("\n");
	assert.equal(findColumnRegions(doc).length, 0);
});

test("max height is clamped to the supported 80–4000px range", () => {
	const small = onlyRegion("%% col-start %%\n%% col-break:mh:20 %%\nx\n%% col-end %%");
	assert.equal(small.columns[0]!.style?.maxHeight, undefined);
	const large = onlyRegion("%% col-start %%\n%% col-break:mh:99999 %%\nx\n%% col-end %%");
	assert.equal(large.columns[0]!.style?.maxHeight, undefined);
	const ok = onlyRegion("%% col-start %%\n%% col-break:mh:320 %%\nx\n%% col-end %%");
	assert.equal(ok.columns[0]!.style?.maxHeight, 320);
});

test("unknown preset tokens are dropped but the explicit style survives", () => {
	const region = onlyRegion(
		"%% col-start %%\n%% col-break:50,preset:not-real,b:blue-soft %%\nx\n%% col-end %%",
	);
	assert.equal(region.columns[0]!.style?.preset, undefined);
	assert.equal(region.columns[0]!.style?.background, "blue-soft");
});
