// Runs last: closes Obsidian.

import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";

export default [
	{
		name: "keeps column edits when Obsidian is closed while a column is being edited",
		closesObsidian: true,
		async run(o) {
			await o.call("layout", "A.md");
			const p = await o.call("columnPoint", "L", 0);
			await o.click(p);
			await o.sleep(250);
			assert.ok(await o.call("isEditingColumn", "L"));
			const t = `quit${Date.now().toString(36)}`;
			await o.type(` ${t}`);
			await o.sleep(150);
			// Not awaited: the page goes away.
			o.send("Runtime.evaluate", {expression: "setTimeout(() => window.close(), 10)"});
			await o.sleep(4000);
			assert.ok(readFileSync(join(o.vaultDir, "A.md"), "utf8").includes(t), "the column edit was not saved");
		},
	},
];
