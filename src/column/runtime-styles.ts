import type {ColumnsPluginSettings} from "../settings";

export function buildRuntimeStyles(settings: ColumnsPluginSettings): string {
	if (settings.showDragHandles) return "";
	return `
.columns-container.columns-ui .column-drag-handle {
	display: none;
}
`;
}
