// Settings: removing all column markers before uninstalling.

import assert from "node:assert/strict";

const MARKED = [
	"# Marked",
	"",
	"Intro.",
	"",
	"%% col-start:moc:moc-x %%",
	"",
	"%% col-break:w:30,b:primary %%",
	"",
	"Left",
	"",
	"%% col-break %%",
	"",
	"Right",
	"",
	"%% col-end %%",
	"",
	"%% a comment that stays %%",
	"",
	"```md",
	"%% col-start %%",
	"%% col-end %%",
	"```",
	"",
	"Outro.",
	"",
].join("\n");

const EXPECTED = [
	"# Marked",
	"",
	"Intro.",
	"",
	"Left",
	"",
	"Right",
	"",
	"%% a comment that stays %%",
	"",
	"```md",
	"%% col-start %%",
	"%% col-end %%",
	"```",
	"",
	"Outro.",
	"",
].join("\n");

const NESTED = "%% col-start %%\n\n%% col-break %%\n\nA\n\n%% col-start %%\n\n%% col-break %%\n\nA1\n\n%% col-end %%\n\n%% col-break %%\n\nB\n\n%% col-end %%\n";

/** The settings window (a popout) document, as an expression. */
const settingsDoc = "app.setting.modalEl.ownerDocument";

export default [
	{
		name: "removing all column markers keeps the notes' text, other comments and code examples",
		async run(o) {
			// The removal changes every note in the vault: keep the others as they are.
			const backup = await o.ev(`(async () => {
				const out = {};
				for (const f of app.vault.getMarkdownFiles()) out[f.path] = await app.vault.read(f);
				return out;
			})()`);
			try {
				await o.call("write", "Marked.md", MARKED);
				await o.call("write", "Nested.md", NESTED);
				await o.ev(`(async () => {
					app.setting.open();
					await new Promise((r) => setTimeout(r, 1000));
					app.setting.openTabById("advanced-multi-column");
					await new Promise((r) => setTimeout(r, 800));
					const row = [...${settingsDoc}.querySelectorAll(".setting-item")]
						.find((e) => e.querySelector(".setting-item-name")?.textContent === "Remove all column markers");
					row.scrollIntoView();
					row.querySelector("button").click();
					return true;
				})()`);
				const dialog = await o.ev(`(async () => {
					for (let i = 0; i < 100; i++) {
						const modal = ${settingsDoc}.querySelector(".modal.amc-remove-markers");
						const confirm = [...(modal?.querySelectorAll("button") ?? [])].find((b) => b.textContent === "Remove markers");
						if (confirm) return {text: modal.textContent, disabled: confirm.disabled};
						await new Promise((r) => setTimeout(r, 100));
					}
					return null;
				})()`);
				assert.ok(dialog, "the dialog did not show the scan");
				assert.match(dialog.text, /inside code blocks will be left/, "markers in code blocks were not reported");
				assert.match(dialog.text, /Found \d+ column markers in \d+ notes:/, "the scan result was not shown");
				assert.equal(dialog.disabled, true, "the remove button worked without the confirmation phrase");

				const result = await o.ev(`(async () => {
					const modal = ${settingsDoc}.querySelector(".modal.amc-remove-markers");
					const input = modal.querySelector("input[type=text]");
					const confirm = [...modal.querySelectorAll("button")].find((b) => b.textContent === "Remove markers");
					input.value = "delete all amc";
					input.dispatchEvent(new Event("input"));
					const stillDisabled = confirm.disabled;
					input.value = "Delete all AMC markers";
					input.dispatchEvent(new Event("input"));
					const enabled = !confirm.disabled;
					confirm.click();
					for (let i = 0; i < 100 && !/^Removed /.test(modal.querySelector("p")?.textContent ?? ""); i++) {
						await new Promise((r) => setTimeout(r, 100));
					}
					return {stillDisabled, enabled, summary: modal.querySelector("p")?.textContent};
				})()`);
				assert.equal(result.stillDisabled, true, "a partial phrase enabled the button");
				assert.equal(result.enabled, true, "the phrase did not enable the button");
				assert.match(result.summary ?? "", /^Removed \d+ column markers? from \d+ notes?\.$/);

				const files = await o.ev(`(async () => ({
					marked: await app.vault.adapter.read("Marked.md"),
					nested: await app.vault.adapter.read("Nested.md"),
				}))()`);
				assert.equal(files.marked, EXPECTED);
				assert.equal(files.nested, "A\n\nA1\n\nB\n");
			} finally {
				await o.ev(`(async () => {
					${settingsDoc}.querySelectorAll(".modal-container .modal-close-button").forEach((b) => b.click());
					app.setting.close();
					const backup = ${JSON.stringify(backup)};
					for (const [path, text] of Object.entries(backup)) await app.vault.adapter.write(path, text);
					for (const path of ["Marked.md", "Nested.md"]) {
						const file = app.vault.getAbstractFileByPath(path);
						if (file) await app.vault.delete(file);
					}
					return true;
				})()`);
				await o.sleep(800);
			}
		},
	},
];
