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

/** Screen point of the first element in pane L's column layer matching `selector`, or null. */
function layerPoint(o, selector) {
	return o.ev(`(() => {
		const el = ${leafSelector}.querySelector(".columns-rv-wrapper " + ${JSON.stringify(selector)});
		if (!el) return null;
		const r = el.getBoundingClientRect();
		return {x: Math.round(r.left + Math.min(5, r.width / 2)), y: Math.round(r.top + r.height / 2)};
	})()`);
}

/** Press and release a mouse button ("left", "middle", "right") at a point. */
async function press(o, pt, button) {
	await o.send("Input.dispatchMouseEvent", {type: "mouseMoved", x: pt.x, y: pt.y});
	await o.send("Input.dispatchMouseEvent", {type: "mousePressed", x: pt.x, y: pt.y, button, clickCount: 1});
	await o.sleep(40);
	await o.send("Input.dispatchMouseEvent", {type: "mouseReleased", x: pt.x, y: pt.y, button, clickCount: 1});
	await o.sleep(600);
}

const menuTitles = (o) => o.ev(`[...document.querySelectorAll(".menu .menu-item-title")].map((t) => t.textContent)`);

/** The first frame where another note's columns, or the note without columns, were on screen. */
function badFrame(samples) {
	return samples.find((s) => s.error || (s.layer && s.layer !== s.file) || s.nativeVisible > 0) ?? null;
}

export default [
	{
		name: "markers inside an HTML block don't show above the columns (#38)",
		async run(o) {
			await o.call("layout", "Center.md", undefined, "preview");
			await o.sleep(1000);
			const shown = await o.ev(`[...${leafSelector}.querySelectorAll(".markdown-preview-sizer > div")]
				.filter((d) => d.offsetHeight > 0 && !d.closest(".amc-reading-columns-host") && d.innerText.includes("%%"))
				.map((d) => d.innerText)`);
			assert.deepEqual(shown, []);
			assert.equal(await o.ev(`${leafSelector}.querySelectorAll(".columns-rv-wrapper img").length`), 2);
		},
	},
	{
		name: "hovering a link shows the page preview, in columns and outside them",
		async run(o) {
			await o.call("layout", "Hover.md", undefined, "preview");
			await o.sleep(1000);
			for (const name of ["Plain", "Plain2"]) {
				await o.ev(`document.querySelectorAll(".hover-popover").forEach((p) => p.remove())`);
				await o.send("Input.dispatchMouseEvent", {type: "mouseMoved", x: 5, y: 300});
				await o.sleep(200);
				const pt = await o.ev(`(() => {
					const a = [...${leafSelector}.querySelectorAll(".columns-rv-wrapper a.internal-link")].find((a) => a.textContent === ${JSON.stringify(name)});
					const r = a.getBoundingClientRect();
					return {x: Math.round(r.left + 5), y: Math.round(r.top + r.height / 2)};
				})()`);
				await o.send("Input.dispatchMouseEvent", {type: "mouseMoved", x: pt.x, y: pt.y});
				let shown = 0;
				for (let i = 0; i < 20 && !shown; i++) {
					await o.sleep(100);
					shown = await o.ev(`document.querySelectorAll(".hover-popover").length`);
				}
				assert.ok(shown > 0, `no page preview for [[${name}]]`);
			}
		},
	},
	{
		name: "a link in columns: middle-click opens a tab, right-click shows the link menu, dragging drags the link",
		async run(o) {
			await o.call("layout", "Links.md", undefined, "preview");
			await o.sleep(1000);
			const link = await layerPoint(o, "a.internal-link");

			await press(o, link, "right");
			const titles = await menuTitles(o);
			await o.key("Escape");
			assert.ok(titles.includes("Open in new tab") && titles.includes("Copy"), `link menu: ${titles}`);

			const dragged = await o.ev(`(() => {
				const a = ${leafSelector}.querySelector(".columns-rv-wrapper a.internal-link");
				a.dispatchEvent(new DragEvent("dragstart", {bubbles: true, cancelable: true, dataTransfer: new DataTransfer()}));
				const d = app.dragManager.draggable;
				app.dragManager.draggable = null;
				document.querySelectorAll(".drag-ghost").forEach((g) => g.remove());
				return d ? d.type + ":" + d.linktext : null;
			})()`);
			assert.equal(dragged, "link:Plain");

			await press(o, link, "middle");
			const files = await o.ev(`app.workspace.getLeavesOfType("markdown").map((l) => l.view.file?.path)`);
			assert.deepEqual(files, ["Links.md", "Plain.md"]);
		},
	},
	{
		name: "external links, tags and images in columns act as in Obsidian's view; text has no menu",
		async run(o) {
			await o.call("layout", "Links.md", undefined, "preview");
			await o.sleep(1000);
			await o.ev(`(() => { window.__amcOpen = window.open; window.__amcOpened = []; window.open = (...a) => { window.__amcOpened.push(a); return null; }; return true; })()`);
			try {
				await press(o, await layerPoint(o, "a.external-link"), "left");
				assert.deepEqual(await o.ev(`window.__amcOpened`), [["https://example.com/amc", ""]]);
			} finally {
				await o.ev(`(() => { window.open = window.__amcOpen; return true; })()`);
			}

			await press(o, await layerPoint(o, "a.tag"), "left");
			assert.equal(await o.ev(`app.workspace.getLeavesOfType("search")[0]?.view.getQuery()`), "tag:#amctag");

			await press(o, await layerPoint(o, "img"), "left");
			assert.equal(await o.ev(`document.querySelectorAll(".lightbox").length`), 1, "the image viewer did not open");
			await o.key("Escape");
			await o.sleep(300);
			await o.ev(`document.querySelectorAll(".lightbox").forEach((l) => l.remove())`);

			const words = await o.ev(`(() => {
				const p = [...${leafSelector}.querySelectorAll(".columns-rv-wrapper p")].find((e) => e.textContent === "Plain words.");
				const r = p.getBoundingClientRect();
				return {x: Math.round(r.left + 10), y: Math.round(r.top + r.height / 2)};
			})()`);
			await press(o, words, "right");
			assert.deepEqual(await menuTitles(o), []);
		},
	},
	{
		name: "a link in a note embedded in columns opens once, from the embedded note",
		async run(o) {
			await o.call("layout", "Links.md", undefined, "preview");
			await o.sleep(1000);
			const calls = await o.ev(`(async () => {
				const ws = app.workspace;
				const original = ws.openLinkText;
				const calls = [];
				ws.openLinkText = function (...args) { calls.push(args.slice(0, 2)); return original.apply(this, args); };
				try {
					${leafSelector}.querySelector(".columns-rv-wrapper .internal-embed a.internal-link").click();
					await new Promise((r) => setTimeout(r, 500));
				} finally {
					ws.openLinkText = original;
				}
				return calls;
			})()`);
			assert.deepEqual(calls, [["Plain2", "Linky.md"]]);
		},
	},
	{
		name: "a reading view in a background tab keeps its position, and is there again when shown",
		async run(o) {
			await o.call("layout", "Long.md", undefined, "preview");
			await o.sleep(2500);
			await o.call("scrollReading", "L", 6000);
			await o.sleep(1000);
			const line = () => o.ev(`app.workspace.getLeavesOfType("markdown")[0].view.previewMode.getScroll()`);
			const before = await line();
			await o.ev(`(async () => { window.__amcTab = app.workspace.getLeaf("tab"); await window.__amcTab.openFile(app.vault.getAbstractFileByPath("Plain.md")); return true; })()`);
			await o.sleep(800);
			const hidden = await line();
			await o.ev(`(() => { app.workspace.setActiveLeaf(app.workspace.getLeavesOfType("markdown")[0], {focus: true}); return true; })()`);
			await o.sleep(1500);
			const shown = await o.call("reading", "L");
			// Later tests lay out their panes from the first one; leave it active.
			await o.ev(`(() => { window.__amcTab.detach(); app.workspace.setActiveLeaf(app.workspace.getLeavesOfType("markdown")[0], {focus: true}); return true; })()`);
			assert.ok(Math.abs(hidden - before) < 1, `background tab reports line ${hidden}, was ${before}`);
			assert.ok(Math.abs(shown.scrollTop - 6000) <= 2, `shown again at ${shown.scrollTop}, was 6000`);
		},
	},
	{
		name: "the columns stay put when the note's header scrolls out of Obsidian's render",
		async run(o) {
			await o.call("layout", "Long.md", undefined, "preview");
			await o.sleep(2500);
			const tops = await o.ev(`(async () => {
				const pv = ${leafSelector}.querySelector(".markdown-reading-view .markdown-preview-view");
				const host = pv.querySelector(".amc-reading-columns-host");
				const tops = new Set();
				for (const y of [0, 1500, 4000, 1500, 0]) {
					pv.scrollTop = y;
					await new Promise((r) => setTimeout(r, 300));
					tops.add(Math.round(host.getBoundingClientRect().top - pv.getBoundingClientRect().top + pv.scrollTop));
				}
				return [...tops];
			})()`);
			assert.equal(tops.length, 1, `the columns moved: ${tops}`);
		},
	},
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
		// Meta Bind inputs write a property on every keystroke; a rebuild took
		// focus away from the input being typed in.
		name: "a property save keeps the columns, and a field typed in inside them keeps focus",
		async run(o) {
			await o.call("write", "Props.md", "---\nname: Aria\n---\n# Props\n\n%% col-start %%\n\n%% col-break %%\n\nLeft\n\n%% col-break %%\n\nRight\n\n%% col-end %%\n");
			await o.call("layout", "Props.md", undefined, "preview");
			await o.sleep(1500);
			const focusField = () => o.ev(`(() => {
				const col = ${leafSelector}.querySelector(".columns-rv-wrapper .column-item");
				const input = col.querySelector("input.e2e-field") ?? col.createEl("input", {cls: "e2e-field", value: "typing"});
				input.focus();
				input.setSelectionRange(3, 3);
				return document.activeElement === input;
			})()`);
			const state = () => o.ev(`(() => {
				const w = ${leafSelector}.querySelector(".columns-rv-wrapper");
				const a = document.activeElement;
				return {sameLayer: w?.dataset.e2eLayer === "1", focused: a?.classList.contains("e2e-field") ?? false, caret: a?.selectionStart ?? null};
			})()`);
			const setName = (value) => o.ev(`app.fileManager.processFrontMatter(app.vault.getAbstractFileByPath("Props.md"), (fm) => { fm.name = ${JSON.stringify(value)}; })`);

			await o.ev(`${leafSelector}.querySelector(".columns-rv-wrapper").dataset.e2eLayer = "1"`);
			assert.ok(await focusField(), "could not focus the test field");
			await setName("Arianna");
			await o.sleep(1500);
			assert.deepEqual(await state(), {sameLayer: true, focused: true, caret: 3}, "a property changed in place rebuilt the columns");

			// A save that adds frontmatter lines rebuilds the layer (blocks are
			// tagged with source lines); the field must keep focus and caret.
			await setName("Arianna\nWindrunner");
			await o.sleep(1500);
			const after = await state();
			assert.equal(after.sameLayer, false, "adding frontmatter lines did not rebuild the layer");
			assert.equal(after.focused, true, "the field lost focus when the layer was rebuilt");
			assert.equal(after.caret, 3, "the field lost its caret position");
		},
	},
	{
		name: "a long note shows its first screen before the rest is rendered, then renders the rest",
		async run(o) {
			await o.call("layout", "Plain.md", undefined, "preview");
			const r = await o.ev(`(async () => {
				__amcTest.open("L", "Long2.md", "preview");
				let firstShown = null;
				const t0 = performance.now();
				while (performance.now() - t0 < 8000) {
					await new Promise((r) => setTimeout(r, 20));
					const w = ${leafSelector}.querySelector(".markdown-preview-view .columns-rv-wrapper");
					if (w?.dataset.columnsSourcePath !== "Long2.md") continue;
					const deferred = w.querySelectorAll(":scope > .amc-rv-deferred").length;
					if (firstShown === null) firstShown = deferred;
					if (deferred === 0) return {firstShown, done: true};
				}
				return {firstShown, done: false};
			})()`);
			assert.ok(r.firstShown > 0, "the whole note was rendered before it showed");
			assert.ok(r.done, "the rest of the note was never rendered");
		},
	},
	{
		name: "jumping far into a long note that is still being rendered lands on rendered text",
		async run(o) {
			await o.call("layout", "Plain.md", undefined, "preview");
			const r = await o.ev(`(async () => {
				const view = app.workspace.getLeavesOfType("markdown")[0].view;
				__amcTest.open("L", "Long.md", "preview");
				for (let i = 0; i < 200; i++) {
					await new Promise((r) => setTimeout(r, 20));
					const w = view.containerEl.querySelector(".markdown-preview-view .columns-rv-wrapper");
					if (w?.dataset.columnsSourcePath === "Long.md" && w.querySelector(":scope > .amc-rv-deferred")) break;
				}
				const line = view.data.split("\\n").findIndex((l) => l === "## Section 270");
				view.previewMode.renderer.applyScroll(line);
				const top = __amcTest.reading("L").top;
				return {line, top};
			})()`);
			assert.ok(r.line > 0, "Long.md has no section 270");
			assert.equal(r.top, "Section 270");
		},
	},
	...["preview", "source"].map((mode) => ({
		name: `stacked columns stay inside the container's border (${mode === "preview" ? "reading view" : "live preview"})`,
		async run(o) {
			await o.call("layout", "Stacked.md", undefined, mode);
			await o.sleep(1000);
			assert.deepEqual(await o.call("columnsOutside", "L"), []);
		},
	})),
	...["preview", "source"].map((mode) => ({
		name: `columns stacked on a narrow screen keep their dividers, as lines between them (${mode === "preview" ? "reading view" : "live preview"})`,
		async run(o) {
			try {
				// Wider than the pane: the columns stack.
				await o.call("setting", "narrowBreakpointPx", 1200);
				await o.call("layout", "Sep.md", undefined, mode);
				await o.sleep(1000);
				assert.deepEqual(await o.call("columnsOutside", "L"), []);
				assert.deepEqual(await o.call("dividers", "L"), ["horizontal", "horizontal red"]);
			} finally {
				await o.call("setting", "narrowBreakpointPx", 480);
			}
		},
	})),
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
