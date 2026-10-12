// Live preview: text typed in a column is never lost or duplicated.

import assert from "node:assert/strict";
import {fixture} from "../lib/fixtures.mjs";

let n = 0;
const token = () => `tok${Date.now().toString(36)}x${++n}`;
const count = (text, t) => text.split(t).length - 1;

/** Poll `check` until it returns a truthy value or `ms` pass; returns the last value. */
async function waitFor(o, check, ms = 4000) {
	const end = Date.now() + ms;
	let value;
	while (Date.now() < end) {
		value = await check();
		if (value) return value;
		await o.sleep(100);
	}
	return value;
}

/**
 * Press a key until `check` passes (at most three times). Synthetic key
 * presses are occasionally dropped while the test window does not have the
 * operating system's focus; a real user would just press again.
 */
async function pressUntil(o, press, check) {
	for (let i = 0; i < 3; i++) {
		await press();
		if (await waitFor(o, check, 800)) return true;
	}
	return false;
}

/** Wait until every token is in the note, then return how often each one is there. */
async function savedCounts(o, path, tokens) {
	let text = "";
	await waitFor(o, async () => {
		text = await o.call("read", path);
		return tokens.every((t) => text.includes(t));
	});
	// A little longer, so a duplicate written late is caught too.
	await o.sleep(500);
	text = await o.call("read", path);
	return tokens.map((t) => count(text, t));
}

/**
 * Click into column `index` of a pane until its editor is open and has the
 * keyboard focus, then type a token; returns the token.
 */
async function typeInColumn(o, side, index) {
	let hit = "";
	for (let attempt = 0; attempt < 3; attempt++) {
		const p = await waitFor(o, () => o.call("columnPoint", side, index), 2000);
		assert.ok(p, `no column ${index} in pane ${side}`);
		hit = await o.call("hitAt", p.x, p.y);
		await o.click(p);
		const ready = await waitFor(o, async () => await o.call("isEditingColumn", side) && await o.call("focusInColumnEditor", side), 600);
		if (ready) {
			const t = token();
			await o.type(` ${t}`);
			return t;
		}
		await o.call("closeModals");
	}
	assert.fail(`clicking the column did not open its editor (click landed on ${hit})`);
}

export default [
	{
		name: "keeps column edits when another note is opened from the file explorer",
		async run(o) {
			await o.call("write", "A.md", fixture("A.md"));
			for (let round = 0; round < 4; round++) {
				await o.call("layout", "A.md");
				const t = await typeInColumn(o, "L", round % 2);
				await o.sleep(Math.floor(Math.random() * 150));
				const target = round % 2 ? "B.md" : "Plain.md";
				await o.click(await o.call("explorerPoint", target));
				assert.ok(await waitFor(o, async () => await o.call("activeFile") === target), `${target} did not open`);
				assert.deepEqual(await savedCounts(o, "A.md", [t]), [1], `round ${round}: edit not saved exactly once`);
			}
		},
	},
	{
		name: "keeps column edits when another note is opened with the quick switcher",
		async run(o) {
			await o.call("layout", "A.md");
			const t = await typeInColumn(o, "L", 0);
			// The command Ctrl+O runs (synthetic shortcuts are unreliable, see pressUntil).
			await o.ev(`app.commands.executeCommandById("switcher:open")`);
			assert.ok(await waitFor(o, () => o.call("quickSwitcherOpen"), 2000), "the quick switcher did not open");
			// Obsidian may show the switcher in a window of its own, which key
			// presses sent to the main window don't reach: type and pick through it.
			assert.ok(await o.call("quickSwitch", "Plain2"), "the quick switcher did not find Plain2");
			assert.ok(await waitFor(o, async () => await o.call("activeFile") === "Plain2.md"), "Plain2 did not open");
			assert.deepEqual(await savedCounts(o, "A.md", [t]), [1]);
		},
	},
	{
		name: "keeps column edits when the tab is closed",
		async run(o) {
			await o.call("layout", "A.md", "Plain.md");
			const t = await typeInColumn(o, "L", 1);
			// The command Ctrl+W runs (synthetic shortcuts are unreliable, see pressUntil).
			await o.ev(`app.commands.executeCommandById("workspace:close")`);
			assert.ok(await waitFor(o, async () => await o.call("markdownLeafCount") === 1, 2000), "the tab did not close");
			assert.deepEqual(await savedCounts(o, "A.md", [t]), [1]);
		},
	},
	...["escape", "explorer", "close"].map((ending) => ({
		name: `same note in two panes: drafts in both panes are kept (${ending})`,
		async run(o) {
			await o.call("write", "C2.md", fixture("C2.md"));
			await o.call("layout", "C2.md", "C2.md");
			await o.call("startTrace", "C2.md");
			const left = await typeInColumn(o, "L", 0);
			await o.call("note", "typed left");
			await o.sleep(100);
			const right = await typeInColumn(o, "R", 1);
			await o.call("note", "typed right");
			await o.sleep(100);
			if (ending === "escape") await pressUntil(o, () => o.key("Escape"), async () => !(await o.call("isEditingColumn", "R")));
			if (ending === "explorer") await o.click(await o.call("explorerPoint", "Plain.md"));
			if (ending === "close") await o.ev(`app.commands.executeCommandById("workspace:close")`);
			const counts = await savedCounts(o, "C2.md", [left, right]);
			assert.deepEqual(counts, [1, 1], `each pane's text must be saved exactly once (left, right): ${counts}; open editors: ${await o.call("openColumnEditors")}
${await o.call("trace")}`);
			assert.equal(await o.call("closeModals"), "", "an unsaved-edit dialog appeared");
		},
	})),
	{
		name: "same column open in both panes: the other pane does not undo an edit",
		async run(o) {
			await o.call("write", "C2.md", fixture("C2.md"));
			await o.call("layout", "C2.md", "C2.md");
			const t = await typeInColumn(o, "L", 0);
			await o.click(await o.call("columnPoint", "R", 0));
			await o.sleep(500);
			await pressUntil(o, () => o.key("Escape"), async () => !(await o.call("isEditingColumn", "R")));
			assert.deepEqual(await savedCounts(o, "C2.md", [t]), [1]);
		},
	},
];
