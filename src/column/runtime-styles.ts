import type {ColumnsPluginSettings} from "../settings";

export function buildRuntimeStyles(settings: ColumnsPluginSettings): string {
	const rules: string[] = [];

	if (!settings.showDragHandles) {
		rules.push(`
.columns-container.columns-ui .column-drag-handle {
	display: none;
}
`);
	}

	if (settings.foldNotePropertiesByDefault) {
		rules.push(`
.workspace-leaf-content[data-type="markdown"] .metadata-container {
	transition: margin-block-end 180ms ease, padding-block 180ms ease;
}

.workspace-leaf-content[data-type="markdown"] .metadata-container > .metadata-content {
	transform-origin: top;
	transition: opacity 140ms ease, transform 180ms ease, max-height 180ms ease;
}

.workspace-leaf-content[data-type="markdown"].amc-properties-fold-pending .metadata-container:not(.is-collapsed) > .metadata-content,
.workspace-leaf-content[data-type="markdown"] .metadata-container.amc-properties-auto-folding > .metadata-content {
	opacity: 0;
	transform: translateY(-4px);
	max-height: 0;
	overflow: hidden;
	pointer-events: none;
}
`);
	}

	return rules.join("\n");
}
