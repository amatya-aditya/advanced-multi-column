// Reading view: rendering, note switching, scroll positions and rebuilds.

import assert from "node:assert/strict";
import {fixture} from "../lib/fixtures.mjs";

const leafSelector = "app.workspace.getLeavesOfType('markdown')[0].view.containerEl";

/** Open `to` in pane L while recording what reading view shows on every frame. */
function switchWhileWatching(o, to, ms = 3000) {
	return o.ev(`(async () => {
		const watching = __amcTest.watchReading("L", ${ms});
		await new Promise((r) => setTimeout(r, 50));
		__amcTest.open("L", ${JSON.stringify(to)}, "preview");
		return await watching;
	})()`);
}

/** The first frame where another note's columns, or the note without columns, were on screen. */
function badFrame(samples) {
	return samples.find((s) => s.error || (s.layer && s.layer !== s.file) || s.nativeVisible > 0) ?? null;
}

export default [
	{
		name: "shows the columns of a note embedded in another note's columns (#31)",
		async run(o) {
			await o.call("layout", "I31A.md", undefined, "preview");
			let nested = 0;
			for (let i = 0; i < 40 && nested < 1; i++) {
				await o.sleep(100);
				nested = await o.ev(`${leafSelector}.querySelectorAll(".internal-embed .internal-embed .columns-container").length`);
			}
			assert.ok(nested >= 1, "the nested note's columns were not laid out");
		},
	},
	{
		name: "folds headings and lists in columns and outside them (#30)",
		async run(o) {
			await o.call("layout", "I30.md", undefined, "preview");
			await o.sleep(1000);
			const r = await o.ev(`(async () => {
				const w = ${leafSelector}.querySelector(".columns-rv-wrapper");
				// Nested items only: a folded item still contains its children's text.
				const vis = (needle) => [...w.querySelectorAll("p, li li")].some((e) => e.textContent.includes(needle) && e.getClientRects().length > 0);
				w.querySelector(".column-preview h2 .collapse-indicator").click();
				[...w.querySelectorAll("li")].find((li) => li.textContent.includes("outer item")).querySelector(".collapse-indicator").click();
				await new Promise((r) => setTimeout(r, 200));
				return {insideText: vis("Text under inside heading"), outerChild: vis("child item 2"), tail: vis("Tail text")};
			})()`);
			assert.deepEqual(r, {insideText: false, outerChild: false, tail: true});
		},
	},
	{
		name: "switching long notes never shows another note's columns or the note without columns",
		async run(o) {
			await o.call("layout", "Long.md", undefined, "preview");
			await o.sleep(2500);
			for (const to of ["Long2.md", "Long.md"]) {
				const samples = await switchWhileWatching(o, to);
				assert.equal(badFrame(samples), null, `bad frame switching to ${to}: ${JSON.stringify(badFrame(samples))}`);
				const shown = samples.filter((s) => s.layer === to);
				assert.ok(shown.length > 0, `${to}'s columns never appeared`);
				// Once shown, the columns stay where they are (no jump when the header appears).
				const tops = new Set(shown.map((s) => s.headingTop));
				assert.ok(Math.max(...tops) - Math.min(...tops) <= 2, `columns moved after appearing: ${[...tops]}`);
			}
		},
	},
	...[["Long.md", "Long2.md"], ["LongPlain.md", "LongPlain2.md"], ["Long.md", "LongPlain.md"], ["LongPlain.md", "Long.md"]].map(([from, to]) => ({
		name: `going back to a note returns to where it was read (${from} -> ${to} -> back)`,
		async run(o) {
			await o.call("layout", from, undefined, "preview");
			await o.sleep(2500);
			await o.call("scrollReading", "L", 30000);
			await o.sleep(1000);
			const before = await o.call("reading", "L");
			await o.call("open", "L", to, "preview");
			await o.sleep(2500);
			await o.call("back", "L");
			await o.sleep(3000);
			const after = await o.call("reading", "L");
			assert.equal(after.file, from);
			assert.ok(Math.abs(after.scrollTop - before.scrollTop) < 400, `scroll ${before.scrollTop} -> ${after.scrollTop}`);
		},
	})),
	{
		name: "keeps the reading position when the note is saved",
		async run(o) {
			await o.call("layout", "Long.md", "Long.md", "preview", "source");
			await o.sleep(2500);
			await o.call("scrollReading", "L", 20000);
			await o.sleep(800);
			const before = await o.call("reading", "L");
			await o.call("editLine", "R", "in section 2.", "Edited line in section 2.");
			await o.sleep(2000);
			const after = await o.call("reading", "L");
			assert.ok(Math.abs(after.scrollTop - before.scrollTop) < 50, `scroll ${before.scrollTop} -> ${after.scrollTop}`);
			assert.equal(after.top, before.top);
			await o.call("editLine", "R", "Edited line in section 2.", "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. [[A]] and [[Plain]] in section 2.");
		},
	},
	{
		name: "a save rebuilds only the blocks that changed, and footnotes are renumbered",
		async run(o) {
			await o.call("write", "ReuseFn.md", fixture("ReuseFn.md"));
			await o.call("layout", "ReuseFn.md", "ReuseFn.md", "preview", "source");
			await o.sleep(1500);
			await o.call("markBlocks", "L");
			await o.call("editLine", "R", "Middle text.", "Middle text EDITED.");
			await o.sleep(1500);
			assert.deepEqual(await o.call("blockIds", "L"), ["0", "1", "new", "3", "4"]);
			assert.ok((await o.call("reading", "L")).text.includes("Middle text EDITED."));
			assert.equal((await o.ev(`${leafSelector}.querySelectorAll(".columns-rv-wrapper .internal-embed .columns-container").length`)) >= 1, true, "the embed in a reused block lost its columns");
			await o.call("editLine", "R", "Intro with a footnote", "Intro[^z] with a footnote[^a].\n\n[^z]: Footnote Z.");
			await o.sleep(1500);
			assert.deepEqual(await o.call("footnoteRefs", "L"), ["[1]", "[2]", "[3]", "[4]"]);
		},
	},
	{
		name: "switching from live preview to reading view never shows the note without columns",
		async run(o) {
			await o.call("layout", "Plain.md");
			await o.call("open", "L", "Long.md", "source");
			await o.sleep(2000);
			const samples = await o.ev(`(async () => {
				const watching = __amcTest.watchReading("L", 2500);
				await new Promise((r) => setTimeout(r, 50));
				app.commands.executeCommandById("markdown:toggle-preview");
				return await watching;
			})()`);
			const shownNative = samples.find((s) => s.nativeVisible > 0);
			assert.equal(shownNative, undefined, `the note showed without columns: ${JSON.stringify(shownNative)}`);
			assert.ok(samples.some((s) => s.layer === "Long.md"), "the columns never appeared");
		},
	},
];
