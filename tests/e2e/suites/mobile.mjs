// Phone layout (Obsidian's mobile emulation). Switching it reloads the app,
// so these run late and restore the desktop app and page helpers afterwards.

import assert from "node:assert/strict";
import {installHelpers} from "../lib/obsidian.mjs";

const leafEl = "app.workspace.getLeavesOfType('markdown')[0].view.containerEl";

/** Turn mobile emulation on or off and wait for the reloaded app. */
async function emulateMobile(o, on) {
	await o.ev(`(app.emulateMobile(${on}), true)`).catch(() => null);
	for (let i = 0; i < 60; i++) {
		await o.sleep(500);
		const ready = await o.ev(`!!(window.app?.workspace?.layoutReady && app.isMobile === ${on} && app.plugins?.plugins["advanced-multi-column"])`).catch(() => false);
		if (ready) break;
	}
	await o.sleep(1000);
	await installHelpers(o);
}

export default [
	{
		// Obsidian's phone rule that clears the view header padded column editors too.
		name: "on phones, a column's text does not move down when editing it (#41)",
		async run(o) {
			await o.send("Emulation.setDeviceMetricsOverride", {width: 390, height: 800, deviceScaleFactor: 1, mobile: true});
			try {
				await emulateMobile(o, true);
				await o.call("write", "Phone.md", "# Phone\n\n%% col-start %%\n%% col-break %%\nLeft words.\n%% col-break %%\nRight words.\n%% col-end %%\n");
				await o.ev(`app.workspace.getLeaf(false).openFile(app.vault.getAbstractFileByPath("Phone.md"), {state: {mode: "source", source: false}}).then(() => true)`);
				await o.sleep(1500);
				const textTop = () => o.ev(`(() => {
					const c = ${leafEl}.querySelector(".amc-columns-host .column-item");
					const line = c.querySelector(".amc-embedded-editor .cm-line") ?? c.querySelector(".column-preview p");
					return Math.round(line.getBoundingClientRect().top - c.getBoundingClientRect().top);
				})()`);
				const before = await textTop();
				const pt = await o.ev(`(() => { const r = ${leafEl}.querySelector(".amc-columns-host .column-preview").getBoundingClientRect(); return {x: Math.round(r.left + 20), y: Math.round(r.top + 8)}; })()`);
				await o.click(pt);
				await o.sleep(800);
				assert.ok(await o.ev(`!!document.activeElement?.closest(".amc-embedded-editor")`), "the column editor did not open");
				const editing = await textTop();
				assert.ok(Math.abs(editing - before) <= 4, `text moved from ${before}px to ${editing}px below the column's top`);
			} finally {
				await o.key("Escape");
				await emulateMobile(o, false);
				await o.send("Emulation.clearDeviceMetricsOverride");
			}
		},
	},
];
