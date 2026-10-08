// Live preview: what columns show, and work done while switching notes.

import assert from "node:assert/strict";

const leafEl = "app.workspace.getLeavesOfType('markdown')[0].view.containerEl";

export default [
	{
		name: "shows footnote definitions written in columns",
		async run(o) {
			await o.call("layout", "FnCols.md");
			await o.sleep(1200);
			const defs = await o.ev(`[...${leafEl}.querySelectorAll(".amc-columns-host .amc-footnote-def")].map((d) => d.innerText.replace(/\\s+/g, " ").trim())`);
			assert.deepEqual(defs, [
				"1 I also added information here",
				"2 This is something I added, bold, see also [^1]",
				"orphan A definition nobody references",
			]);
		},
	},
	{
		name: "hides comments only when the setting is on, and shows the one under the cursor",
		async run(o) {
			try {
				await o.call("layout", "Comments.md");
				await o.call("cursorAfter", "L", "End.");
				await o.sleep(300);
				let text = await o.call("editorText", "L");
				assert.ok(text.includes("an inline comment") && text.includes("A block comment"), "comments hidden while the setting is off");
				await o.call("setting", "hideCommentsInLivePreview", true);
				await o.call("cursorAfter", "L", "End.");
				await o.sleep(300);
				text = await o.call("editorText", "L");
				assert.ok(!text.includes("an inline comment"), "inline comment still shown");
				assert.ok(!text.includes("A block comment"), "block comment still shown");
				assert.ok(text.includes("%%not a comment%%"), "%% in inline code was hidden");
				assert.ok(text.includes("%% inside a code block %%"), "%% in a code block was hidden");
				await o.call("cursorInside", "L", "an inline comment");
				await o.sleep(300);
				assert.ok((await o.call("editorText", "L")).includes("an inline comment"), "comment under the cursor not shown");
			} finally {
				await o.call("setting", "hideCommentsInLivePreview", false);
			}
		},
	},
	{
		name: "switching notes in live preview does not lay out reading view's columns",
		async run(o) {
			await o.call("layout", "Long.md");
			await o.sleep(1500);
			const builds = await o.ev(`(async () => {
				const rv = ${leafEl}.querySelector(".markdown-reading-view");
				let builds = 0;
				const mo = new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.classList?.contains("columns-rv-wrapper")) builds++; });
				mo.observe(rv, {childList: true, subtree: true});
				await __amcTest.open("L", "Long2.md", "source");
				await new Promise((r) => setTimeout(r, 2000));
				mo.disconnect();
				return builds;
			})()`);
			assert.equal(builds, 0);
		},
	},
];
