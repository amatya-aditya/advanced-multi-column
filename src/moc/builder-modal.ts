import {App, Editor, Modal, Notice, Setting, TFile} from "obsidian";
import type ColumnsPlugin from "../main";
import {MocForm} from "./form";
import {generateMocBlock} from "./generate";
import {createMocTemplate, MocTemplate, newMocTemplateId} from "./types";

function cloneTemplate(template: MocTemplate): MocTemplate {
	return {
		...template,
		tags: [...template.tags],
		properties: template.properties.map((p) => ({...p})),
		assignments: {...template.assignments},
	};
}

interface BuilderOptions {
	title: string;
	submitLabel: string;
	draft: MocTemplate;
	sourcePath: string;
	/** Shared template being edited (offers "only change this MOC"). */
	shared?: MocTemplate;
	/** Offer saving a new MOC as a reusable template. */
	offerSaveAsTemplate: boolean;
	onSubmit: (draft: MocTemplate, choice: {saveAsTemplate: boolean; detach: boolean}) => Promise<void>;
}

/** Dialog to build or edit a MOC with folder, tag and property pickers. */
class MocBuilderModal extends Modal {
	private form: MocForm | null = null;
	private saveAsTemplate = false;
	private detach = false;

	constructor(app: App, private readonly plugin: ColumnsPlugin, private readonly opts: BuilderOptions) {
		super(app);
	}

	onOpen(): void {
		const {contentEl, opts} = this;
		this.modalEl.addClass("amc-moc-builder");
		this.titleEl.setText(opts.title);

		if (opts.shared) {
			const shared = opts.shared;
			new Setting(contentEl)
				.setName("Only change this MOC")
				.setDesc(`This MOC uses the template "${shared.name}". Changes apply to every MOC made from it, `
					+ "unless only this MOC is changed.")
				.addToggle((toggle) => toggle.setValue(this.detach).onChange((value) => {
					this.detach = value;
				}));
		}

		const formHost = contentEl.createDiv({cls: "amc-moc-builder-form"});
		this.form = new MocForm(formHost, {
			app: this.app,
			plugin: this.plugin,
			template: opts.draft,
			sourcePath: opts.sourcePath,
			showName: false,
			onChange: () => {},
		});
		this.form.load();

		const footer = new Setting(contentEl);
		if (opts.offerSaveAsTemplate) {
			let nameInput: HTMLInputElement | null = null;
			footer
				.setName("Save as template")
				.setDesc("Also add these options to the reusable MOC templates in settings.")
				.addToggle((toggle) => toggle.onChange((value) => {
					this.saveAsTemplate = value;
					nameInput?.toggleClass("is-hidden", !value);
				}))
				.addText((text) => {
					nameInput = text.inputEl;
					text.inputEl.addClass("is-hidden");
					text.setPlaceholder("Template name").onChange((value) => {
						opts.draft.name = value;
					});
				});
		}
		footer
			.addButton((btn) => btn.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((btn) => btn
				.setButtonText(opts.submitLabel)
				.setCta()
				.onClick(async () => {
					await opts.onSubmit(opts.draft, {saveAsTemplate: this.saveAsTemplate, detach: this.detach});
					this.close();
				}));
	}

	onClose(): void {
		this.form?.unload();
		this.form = null;
		this.contentEl.empty();
	}
}

/** "Insert MOC → New MOC…": build a MOC for this note and insert it at the cursor. */
export function openNewMocBuilder(plugin: ColumnsPlugin, editor: Editor, file: TFile | null): void {
	if (!file) {
		new Notice("Open a note to insert a MOC.");
		return;
	}
	const all = plugin.settings.mocTemplates;
	const draft = createMocTemplate(newMocTemplateId(all), "");
	draft.inline = true;

	new MocBuilderModal(plugin.app, plugin, {
		title: "New MOC",
		submitLabel: "Insert",
		draft,
		sourcePath: file.path,
		offerSaveAsTemplate: true,
		onSubmit: async (result, {saveAsTemplate}) => {
			result.inline = !saveAsTemplate;
			result.name = saveAsTemplate
				? result.name.trim() || `MOC ${all.filter((t) => !t.inline).length + 1}`
				: `MOC in ${file.basename}`;
			all.push(result);
			await plugin.saveSettings();
			editor.replaceSelection("\n" + generateMocBlock(plugin.app, result, file.path) + "\n");
			await plugin.mocSync.track(file.path);
		},
	}).open();
}

/** Right-click → "Edit MOC": change the options of an inserted MOC. */
export function openMocEditor(plugin: ColumnsPlugin, mocId: string, sourcePath: string): void {
	const all = plugin.settings.mocTemplates;
	const template = all.find((t) => t.id === mocId);
	const file = plugin.app.vault.getAbstractFileByPath(sourcePath);
	if (!template || !(file instanceof TFile)) {
		new Notice("This MOC's options were not found. Insert a new MOC to replace it.");
		return;
	}

	new MocBuilderModal(plugin.app, plugin, {
		title: template.inline ? "Edit MOC" : `Edit MOC · ${template.name}`,
		submitLabel: "Save",
		draft: cloneTemplate(template),
		sourcePath,
		shared: template.inline ? undefined : template,
		offerSaveAsTemplate: false,
		onSubmit: async (result, {detach}) => {
			if (detach) {
				// Give this note its own copy and point its MOC blocks at it.
				const copy: MocTemplate = {
					...result,
					id: newMocTemplateId(all),
					inline: true,
					name: `MOC in ${file.basename}`,
				};
				all.push(copy);
				const pattern = new RegExp(`(%%\\s*col-start:[^%\\n]*?)\\bmoc:${mocId}\\b`, "g");
				await plugin.app.vault.process(file, (data) => data.replace(pattern, `$1moc:${copy.id}`));
			} else {
				Object.assign(template, result, {id: template.id, inline: template.inline, name: template.name});
			}
			await plugin.saveSettings();
			if (detach) {
				await plugin.mocSync.refreshFile(file);
			} else {
				plugin.mocSync.refreshSoon();
			}
		},
	}).open();
}
