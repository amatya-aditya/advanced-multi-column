import {App, Modal} from "obsidian";
import {PICKER_TEMPLATES, type PickerTemplate} from "./layout-picker-templates";

export {PICKER_TEMPLATES, type PickerTemplate} from "./layout-picker-templates";

export class LayoutPickerModal extends Modal {
	constructor(app: App, private readonly onPick: (template: PickerTemplate) => void) {
		super(app);
		this.modalEl.addClass("amc-layout-picker-modal");
	}

	onOpen(): void {
		this.titleEl.setText("Insert bento and column layouts");
		const root = this.contentEl.createDiv({cls: "amc-layout-picker"});
		root.createEl("p", {
			cls: "amc-layout-card-desc",
			text: "Choose a starting layout. All cards use the plugin's column markers and can be edited or restyled afterwards.",
		});
		const grid = root.createDiv({cls: "amc-layout-picker-grid"});

		for (const template of PICKER_TEMPLATES) {
			const card = grid.createEl("button", {cls: "amc-layout-card", attr: {type: "button"}});
			const preview = card.createDiv({cls: "amc-layout-preview", attr: {"aria-hidden": "true"}});
			for (const column of template.preview) {
				const colEl = preview.createDiv({cls: "amc-layout-preview-column"});
				colEl.setCssProps({"--amc-preview-width": `${column.width}%`});
				for (let row = 0; row < column.rows; row++) {
					const cell = colEl.createDiv({cls: "amc-layout-preview-cell"});
					if (column.tinted) cell.addClass("is-tinted");
				}
			}
			card.createDiv({cls: "amc-layout-card-title", text: template.title});
			card.createDiv({cls: "amc-layout-card-desc", text: template.description});
			card.addEventListener("click", () => {
				this.onPick(template);
				this.close();
			});
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
