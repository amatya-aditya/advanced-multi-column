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
		// Checkboxes were matched to task lines by position, and a callout's
		// task line was not counted: clicking it toggled the next task instead.
		name: "a task checkbox in a column toggles its own line, also in a callout",
		async run(o) {
			await o.call("write", "TaskCols.md", "%% col-start %%\n\n%% col-break %%\n\n- [ ] First\n\n> [!todo] Later\n> - [ ] In callout\n\n- [ ] Last\n\n%% col-break %%\n\nRight\n\n%% col-end %%\n");
			await o.call("layout", "TaskCols.md");
			await o.sleep(1500);
			// The editor's text: the file on disk is saved a moment later.
			const lines = () => o.ev(`app.workspace.getLeavesOfType("markdown")[0].view.editor.getValue().split("\\n").filter((l) => /\\[.\\]/.test(l))`);
			for (const [label, expected] of [
				["In callout", ["- [ ] First", "> - [x] In callout", "- [ ] Last"]],
				["Last", ["- [ ] First", "> - [x] In callout", "- [x] Last"]],
			]) {
				const p = await o.ev(`(() => {
					const li = [...${leafEl}.querySelectorAll(".columns-container .column-preview li")].find((l) => l.textContent.trim().endsWith(${JSON.stringify(label)}));
					const r = li.querySelector("input[type=checkbox]").getBoundingClientRect();
					return {x: r.x + r.width / 2, y: r.y + r.height / 2};
				})()`);
				await o.click(p);
				await o.sleep(1200);
				assert.deepEqual(await lines(), expected, `clicking "${label}"`);
			}
		},
	},
	{
		// Columns are shown without their header line, and edits made in the
		// preview were saved without it: the header was deleted from the note.
		name: "ticking a task or changing a nested block keeps the column's header",
		async run(o) {
			await o.call("write", "HeaderCols.md", "%% col-start %%\n\n%% col-break %%\n\n!note: Plan\n- [ ] First task\n\n%% col-start %%\n\n%% col-break %%\n\nInner\n\n%% col-end %%\n\n%% col-break %%\n\nRight\n\n%% col-end %%\n");
			await o.call("layout", "HeaderCols.md");
			await o.sleep(1500);
			const text = () => o.ev(`app.workspace.getLeavesOfType("markdown")[0].view.editor.getValue()`);
			const point = (selector) => o.ev(`(() => {
				const el = ${leafEl}.querySelector(${JSON.stringify(selector)});
				const r = el.getBoundingClientRect();
				return {x: r.x + r.width / 2, y: r.y + r.height / 2};
			})()`);

			await o.click(await point(".columns-container .column-preview input[type=checkbox]"));
			await o.sleep(1200);
			let t = await text();
			assert.ok(t.includes("- [x] First task"), "the task was not ticked");
			assert.ok(t.includes("!note: Plan"), "ticking the task deleted the column header");

			// Add a column inside the nested block (the + appears on hover).
			await o.send("Input.dispatchMouseEvent", {type: "mouseMoved", ...(await point(".columns-nested .column-item"))});
			await o.sleep(300);
			await o.click(await point(".columns-nested .column-item [aria-label='Add column to the right']"));
			await o.sleep(1200);
			t = await text();
			assert.equal((t.match(/col-break/g) ?? []).length, 4, "the nested column was not added");
			assert.ok(t.includes("!note: Plan"), "adding a nested column deleted the column header");
		},
	},
	{
		// The style menu saved its pending box style first, then wrote the
		// layout over the block's old range: the style was lost and the rest
		// of the old end marker was left behind ("%% col-end %%% col-end %%").
		name: "changing the layout after a box style keeps both, and the block intact",
		async run(o) {
			await o.call("write", "LayoutCols.md", "# L\n\n%% col-start %%\n\n%% col-break %%\n\nLeft\n\n%% col-break %%\n\nRight\n\n%% col-end %%\n\nAfter\n");
			await o.call("layout", "LayoutCols.md");
			await o.sleep(1500);
			const p = await o.ev(`(() => {
				const r = ${leafEl}.querySelector(".columns-container .column-item").getBoundingClientRect();
				return {x: r.x + r.width / 2, y: r.y + 20};
			})()`);
			await o.send("Input.dispatchMouseEvent", {type: "mousePressed", ...p, button: "right", buttons: 2, clickCount: 1});
			await o.send("Input.dispatchMouseEvent", {type: "mouseReleased", ...p, button: "right", buttons: 0, clickCount: 1});
			await o.sleep(500);
			const menu = (js) => o.ev(`(() => { const m = document.querySelector(".columns-style-popover"); ${js} })()`);
			await menu(`[...m.querySelectorAll("[role=tab]")].find((b) => b.textContent.trim() === "All columns").click(); return true;`);
			await o.sleep(300);
			await menu(`const s = m.querySelector("select[aria-label='Box background']"); s.value = "secondary"; s.dispatchEvent(new Event("change", {bubbles: true})); return true;`);
			await o.sleep(300);
			await menu(`[...m.querySelectorAll(".amc-menu-layout button")].find((b) => b.textContent.trim() === "Stacked").click(); return true;`);
			await o.sleep(1200);
			const text = await o.ev(`app.workspace.getLeavesOfType("markdown")[0].view.editor.getValue()`);
			assert.match(text, /%% col-start:[^%]*b:secondary/, "the box background was lost");
			assert.match(text, /%% col-start:[^%]*l:stack/, "the layout was not saved");
			assert.ok(text.endsWith("%% col-end %%\n\nAfter\n"), `the block's end is damaged:\n${text}`);
		},
	},
	{
		// The header buttons saved the pending style first, then acted on the
		// block's old range and columns: the action was dropped.
		name: "a style menu button after a style change keeps both",
		async run(o) {
			await o.call("write", "MenuCols.md", "# M\n\n%% col-start %%\n\n%% col-break %%\n\nLeft\n\n%% col-break %%\n\nRight\n\n%% col-end %%\n\nAfter\n");
			await o.call("layout", "MenuCols.md");
			await o.sleep(1500);
			const p = await o.ev(`(() => {
				const r = ${leafEl}.querySelector(".columns-container .column-item").getBoundingClientRect();
				return {x: r.x + r.width / 2, y: r.y + 20};
			})()`);
			await o.send("Input.dispatchMouseEvent", {type: "mousePressed", ...p, button: "right", buttons: 2, clickCount: 1});
			await o.send("Input.dispatchMouseEvent", {type: "mouseReleased", ...p, button: "right", buttons: 0, clickCount: 1});
			await o.sleep(500);
			const menu = (js) => o.ev(`(() => { const m = document.querySelector(".columns-style-popover"); ${js} })()`);
			await menu(`[...m.querySelectorAll("[role=tab]")].find((b) => b.textContent.trim() === "This column").click(); return true;`);
			await o.sleep(300);
			await menu(`const s = m.querySelector("select[aria-label='Background']"); s.value = "blue-soft"; s.dispatchEvent(new Event("change", {bubbles: true})); return true;`);
			await o.sleep(300);
			await menu(`m.querySelector("[aria-label='Add column']").click(); return true;`);
			await o.sleep(1200);
			const text = await o.ev(`app.workspace.getLeavesOfType("markdown")[0].view.editor.getValue()`);
			assert.equal((text.match(/col-break/g) ?? []).length, 3, `the column was not added:\n${text}`);
			assert.match(text, /col-break:[^%]*b:blue-soft/, "the background was lost");
			assert.ok(text.endsWith("%% col-end %%\n\nAfter\n"), `the block's end is damaged:\n${text}`);
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
