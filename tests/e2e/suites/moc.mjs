// MOCs: which notes a template's rules list (#43).

import assert from "node:assert/strict";

const plugin = `app.plugins.plugins["advanced-multi-column"]`;

/** Notes in three folders; #keep on the notes in MocB and MocC. */
async function writeNotes(o) {
	await o.ev(`(async () => {
		for (const f of ["MocA", "MocB", "MocC"]) if (!app.vault.getAbstractFileByPath(f)) await app.vault.createFolder(f);
		return true;
	})()`);
	for (const [path, text] of [
		["MocA/a1.md", "# a1\n"],
		["MocB/b1.md", "# b1\n\n#keep\n"],
		["MocC/c1.md", "# c1\n\n#keep\n"],
	]) await o.call("write", path, text);
	await o.sleep(800);
}

/** Generate a MOC from `template` into a fresh note; returns the linked note names and headings. */
async function listMoc(o, template) {
	return o.ev(`(async () => {
		const p = ${plugin};
		const saved = p.settings.mocTemplates;
		p.settings.mocTemplates = [${JSON.stringify(template)}];
		try {
			const path = "MocList.md";
			const existing = app.vault.getAbstractFileByPath(path);
			if (existing) await app.vault.delete(existing);
			const file = await app.vault.create(path, "%% col-start:moc:" + ${JSON.stringify(template.id)} + " %%\\n%% col-break %%\\n%% col-end %%\\n");
			await p.mocSync.refreshFile(file);
			const text = await app.vault.read(file);
			return {
				links: [...text.matchAll(/\\[\\[([^\\]|]+)/g)].map((m) => m[1].split("/").pop()).sort(),
				headings: [...text.matchAll(/^### (.+)$/gm)].map((m) => m[1]).sort(),
			};
		} finally {
			p.settings.mocTemplates = saved;
		}
	})()`);
}

const base = {
	inline: false, groupBy: "subfolder", groupProperty: "", columns: 3, assignments: {}, hiddenGroups: [],
	sort: "name", sortReverse: false, showHeadings: true, showBullets: true, maxPerGroup: 0,
};
const folder = (op, path) => ({type: "folder", op, mode: "fixed", folder: path, includeSubfolders: true});

export default [
	{
		name: "a MOC lists the notes of several folders joined with Or, grouped by folder",
		async run(o) {
			await writeNotes(o);
			const moc = await listMoc(o, {...base, id: "moc-or", name: "Or", rules: [folder("and", "MocA"), folder("or", "MocB")]});
			assert.deepEqual(moc.links, ["a1", "b1"]);
			assert.deepEqual(moc.headings, ["MocA", "MocB"]);
		},
	},
	{
		name: "MOC rules are combined from top to bottom: A or B, and a tag",
		async run(o) {
			await writeNotes(o);
			const rules = [folder("and", "MocA"), folder("or", "MocB"), {type: "tag", op: "and", tag: "keep"}];
			const moc = await listMoc(o, {...base, id: "moc-order", name: "Order", rules});
			// (MocA or MocB) and #keep; "and before or" would also list a1.
			assert.deepEqual(moc.links, ["b1"]);
		},
	},
	{
		name: "a MOC template saved before rules existed keeps listing the same notes",
		async run(o) {
			await writeNotes(o);
			const migrated = await o.ev(`(async () => {
				const p = ${plugin};
				const original = {...p.settings};
				const legacy = {id: "moc-legacy", name: "Legacy", folderMode: "fixed", folder: "MocB", includeSubfolders: true, tags: ["keep"], properties: [], match: "any", groupBy: "none"};
				try {
					await p.saveData({...original, mocTemplates: [legacy]});
					await p.loadSettings();
					return p.settings.mocTemplates[0];
				} finally {
					await p.saveData(original);
					await p.loadSettings();
				}
			})()`);
			assert.deepEqual(migrated.rules, [
				{type: "folder", op: "or", mode: "fixed", folder: "MocB", includeSubfolders: true},
				{type: "tag", op: "or", tag: "keep"},
			]);
			// MocB or #keep: b1 by folder, c1 by tag.
			const moc = await listMoc(o, migrated);
			assert.deepEqual(moc.links, ["b1", "c1"]);
		},
	},
];
