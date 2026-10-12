import {App, ButtonComponent, Modal, Notice, Setting, TFile} from "obsidian";
import {removeColumnMarkers} from "../column/core/marker-removal";

/** What the user types to enable the removal. */
const CONFIRM_PHRASE = "delete all amc markers";

/** Notes listed by name in the dialog; the rest are counted. */
const LISTED_NOTES = 8;

interface NoteScan {
	file: TFile;
	markers: number;
}

interface VaultScan {
	notes: NoteScan[];
	markers: number;
	inCode: number;
}

async function scanVault(app: App): Promise<VaultScan> {
	const scan: VaultScan = {notes: [], markers: 0, inCode: 0};
	for (const file of app.vault.getMarkdownFiles()) {
		const text = await app.vault.cachedRead(file);
		// Cheap check first: most notes have no markers at all.
		if (!text.includes("col-")) continue;
		const result = removeColumnMarkers(text);
		scan.inCode += result.inCode;
		if (result.removed === 0) continue;
		scan.notes.push({file, markers: result.removed});
		scan.markers += result.removed;
	}
	scan.notes.sort((a, b) => a.file.path.localeCompare(b.file.path));
	return scan;
}

/**
 * Remove every column marker from the vault, for someone uninstalling the
 * plugin. The notes' content stays; only the marker lines go. Fail-safe:
 * the vault is scanned first and the result shown, the user must type a
 * phrase to enable the button, and each note is rewritten from its current
 * text at the moment of writing (vault.process), never from the scan.
 */
class RemoveMarkersModal extends Modal {
	private running = false;

	onOpen(): void {
		const {contentEl} = this;
		this.modalEl.addClass("amc-remove-markers");
		this.titleEl.setText("Remove all column markers");
		contentEl.createEl("p", {text: "Scanning your notes…", cls: "setting-item-description"});
		void scanVault(this.app).then((scan) => {
			if (this.contentEl.isConnected) this.renderScan(scan);
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private renderScan(scan: VaultScan): void {
		const {contentEl} = this;
		contentEl.empty();

		if (scan.markers === 0) {
			contentEl.createEl("p", {text: "No column markers were found in your notes. There is nothing to remove."});
			if (scan.inCode > 0) contentEl.createEl("p", {cls: "setting-item-description", text: codeBlockNote(scan.inCode)});
			new Setting(contentEl).addButton((btn) => btn.setButtonText("Close").onClick(() => this.close()));
			return;
		}

		const noteCount = `${scan.notes.length} note${scan.notes.length === 1 ? "" : "s"}`;
		contentEl.createEl("p", {text: `Found ${scan.markers} column marker${scan.markers === 1 ? "" : "s"} in ${noteCount}:`});
		const list = contentEl.createEl("ul", {cls: "amc-remove-markers-notes"});
		for (const note of scan.notes.slice(0, LISTED_NOTES)) {
			list.createEl("li", {text: `${note.file.path} (${note.markers})`});
		}
		if (scan.notes.length > LISTED_NOTES) list.createEl("li", {text: `and ${scan.notes.length - LISTED_NOTES} more`});

		const effects = contentEl.createEl("ul", {cls: "amc-remove-markers-effects"});
		for (const text of [
			"Only the marker lines are removed. The text of every column stays, in the same order, as ordinary paragraphs.",
			"Column widths and styles are stored in the markers and are lost. MOCs stay as plain lists of links and are no longer updated.",
			"Other comments, callouts and markers inside code blocks are not changed.",
			"This cannot be undone. Back up your vault first.",
		]) effects.createEl("li", {text});
		if (scan.inCode > 0) contentEl.createEl("p", {cls: "setting-item-description", text: codeBlockNote(scan.inCode)});

		let confirmBtn: ButtonComponent | null = null;
		new Setting(contentEl)
			.setName(`Type "${CONFIRM_PHRASE}" to confirm`)
			.addText((text) => text.setPlaceholder(CONFIRM_PHRASE).onChange((value) => {
				// The component's own state, not the attribute: a disabled
				// ButtonComponent ignores clicks.
				confirmBtn?.setDisabled(value.trim().toLowerCase() !== CONFIRM_PHRASE);
			}));
		new Setting(contentEl)
			.addButton((btn) => btn.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((btn) => {
				confirmBtn = btn;
				btn.setButtonText("Remove markers")
					.setDestructive()
					.setDisabled(true)
					.onClick(() => void this.remove(scan));
			});
	}

	private async remove(scan: VaultScan): Promise<void> {
		if (this.running) return;
		this.running = true;
		this.contentEl.empty();
		const status = this.contentEl.createEl("p", {text: "Removing markers…"});
		let markers = 0;
		let notes = 0;
		const failed: string[] = [];
		for (const {file} of scan.notes) {
			try {
				let removed = 0;
				// Recomputed from the note's text at write time, so an edit made
				// since the scan is kept.
				await this.app.vault.process(file, (data) => {
					const result = removeColumnMarkers(data);
					removed = result.removed;
					return result.text;
				});
				if (removed > 0) {
					markers += removed;
					notes++;
				}
			} catch (error) {
				console.error("[Advanced Multi Column] Could not remove markers", file.path, error);
				failed.push(file.path);
			}
			status.setText(`Removing markers… ${notes} of ${scan.notes.length} notes`);
		}
		this.running = false;

		const summary = `Removed ${markers} column marker${markers === 1 ? "" : "s"} from ${notes} note${notes === 1 ? "" : "s"}.`;
		new Notice(failed.length > 0 ? `${summary} ${failed.length} could not be changed.` : summary);
		this.contentEl.empty();
		this.contentEl.createEl("p", {text: summary});
		if (failed.length > 0) {
			this.contentEl.createEl("p", {text: "These notes could not be changed; their markers are still there:"});
			const list = this.contentEl.createEl("ul", {cls: "amc-remove-markers-notes"});
			for (const path of failed) list.createEl("li", {text: path});
		}
		new Setting(this.contentEl).addButton((btn) => btn.setButtonText("Close").setCta().onClick(() => this.close()));
	}
}

function codeBlockNote(count: number): string {
	return `${count} marker${count === 1 ? "" : "s"} inside code blocks will be left as ${count === 1 ? "it is" : "they are"}.`;
}

/** Settings row, at the bottom of the tab: opens the removal dialog. */
export function renderRemoveMarkers(setting: Setting, app: App): void {
	setting
		.setName("Remove all column markers")
		.setDesc("Before uninstalling: remove this plugin's markers from your notes and keep their content.")
		.addButton((btn) => btn
			.setButtonText("Remove…")
			.onClick(() => new RemoveMarkersModal(app).open()));
}
