import type {ColumnsPluginSettings} from "../settings";
import {BACKGROUND_CSS, COLOR_CSS} from "./core/column-style";

const BACKGROUND_CSS_MAP: Record<string, string> = BACKGROUND_CSS;
const COLOR_CSS_MAP: Record<string, string> = COLOR_CSS;

function clampPx(value: number, min: number, max: number): number {
	if (!Number.isFinite(value)) return min;
	return Math.max(min, Math.min(max, Math.round(value)));
}

/** Global "Appearance" settings, exposed as variables the layout CSS reads. */
function buildAppearanceRules(settings: ColumnsPluginSettings): string {
	const borderWidth = settings.showContainerBorder
		? clampPx(settings.containerBorderWidthPx, 0, 8)
		: 0;
	const dividerWidth = clampPx(settings.verticalDividerWidthPx, 0, 8);

	const rules = [`
.columns-container {
	--amc-container-bg: ${BACKGROUND_CSS_MAP[settings.containerBackground] ?? BACKGROUND_CSS.primary};
	--amc-container-text: ${COLOR_CSS_MAP[settings.containerTextColor] ?? COLOR_CSS.text};
	--amc-container-border-width: ${borderWidth}px;
	--amc-container-border-color: ${COLOR_CSS_MAP[settings.containerBorderColor] ?? COLOR_CSS.gray};
	--amc-container-radius: ${clampPx(settings.containerCornerRadiusPx, 0, 24)}px;
	--amc-divider-style: ${settings.verticalDividerStyle};
	--amc-divider-color: ${COLOR_CSS_MAP[settings.verticalDividerColor] ?? COLOR_CSS.gray};
}
`];

	// Dividers apply to every gap, or only to the gap after the target column.
	const target = settings.styleTargetMode === "specific"
		? Math.max(0, Math.round(settings.styleTargetColumnIndex) - 1)
		: null;
	if (dividerWidth > 0) {
		if (target === null) {
			rules.push(`
.columns-container {
	--amc-divider-width: ${dividerWidth}px;
}
`);
		} else {
			rules.push(`
.columns-container > .column-resize-handle[data-after-col="${target}"],
.columns-container > [data-col-index="${target}"] + :is(.column-item, .columns-stack-group) {
	--amc-divider-width: ${dividerWidth}px;
}
`);
		}
	}

	return rules.join("\n");
}

/**
 * Stack columns vertically when their block is narrower than the breakpoint
 * (phones, narrow panes). Container queries cannot read CSS variables, so the
 * breakpoint is written into the rule itself.
 */
function buildNarrowStackRules(settings: ColumnsPluginSettings): string {
	if (!settings.stackOnNarrowScreens) return "";
	const breakpoint = clampPx(settings.narrowBreakpointPx, 200, 2000);
	return `
@container amc-columns (max-width: ${breakpoint}px) {
	.columns-container:not(.columns-stacked) {
		flex-direction: column !important;
	}

	.columns-container:not(.columns-stacked) > :is(.column-item, .columns-stack-group) {
		flex: none !important;
		width: 100% !important;
	}

	.columns-container:not(.columns-stacked) > .column-resize-handle {
		display: none !important;
	}

	.columns-container:not(.columns-stacked) > .column-separator-visual {
		width: 100%;
		flex: 0 0 auto;
		border-left: none;
		border-top: var(--sep-width, 1px) var(--sep-style, solid) var(--sep-color, var(--background-modifier-border));
		margin: 2px 8px;
	}

	.columns-container:not(.columns-stacked) > .column-separator-custom {
		writing-mode: horizontal-tb;
		width: 100%;
	}

	.columns-container.columns-reading:not(.columns-stacked) > :is(.column-item, .columns-stack-group)::before {
		display: none;
	}
}
`;
}

export function buildRuntimeStyles(settings: ColumnsPluginSettings): string {
	const rules: string[] = [
		buildAppearanceRules(settings),
		buildNarrowStackRules(settings),
	];

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
