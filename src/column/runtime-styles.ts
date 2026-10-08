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

	/* Stretched, not width: 100%: reading view columns have side margins. */
	.columns-container:not(.columns-stacked) > :is(.column-item, .columns-stack-group) {
		flex: none !important;
		width: auto !important;
	}

	.columns-container.columns-reading:not(.columns-stacked) {
		padding: 4px 0;
		row-gap: var(--amc-stack-gap);
	}

	/* Live preview: the resize handles between columns draw the dividers and
	   separators; they become horizontal lines (nothing to resize here). */
	.columns-container:not(.columns-stacked) > .column-resize-handle {
		flex: 0 0 auto;
		width: auto;
		height: var(--amc-stack-gap);
		margin: 0 8px;
		cursor: default;
		pointer-events: none;
	}

	.columns-container:not(.columns-stacked) > .column-resize-handle.no-separator {
		height: 0;
	}

	/* As specific as the dividers' own rules, which this overrides. */
	.columns-container:not(.columns-stacked) > .column-resize-handle:not(.has-separator):not(.no-separator)::before,
	.columns-container:not(.columns-stacked) > .column-resize-handle.has-separator::before {
		left: 0;
		right: 0;
		top: 50%;
		bottom: auto;
		width: auto;
		transform: translateY(-50%);
		border-left: none;
	}

	.columns-container:not(.columns-stacked) > .column-resize-handle:not(.has-separator):not(.no-separator)::before {
		border-top: var(--amc-divider-width, 0px) var(--amc-divider-style, solid) var(--amc-divider-color, var(--background-modifier-border));
	}

	.columns-container:not(.columns-stacked) > .column-resize-handle.has-separator:not(.has-separator-custom)::before {
		border-top: var(--sep-width, 1px) var(--sep-style, solid) var(--sep-color, var(--background-modifier-border));
	}

	.columns-container:not(.columns-stacked) > .column-resize-handle.has-separator-custom {
		height: auto;
		min-height: 1.2rem;
	}

	.columns-container:not(.columns-stacked) > .column-resize-handle.has-separator-custom::before {
		writing-mode: horizontal-tb;
		text-align: center;
	}

	.columns-container:not(.columns-stacked) > .column-resize-handle::after {
		display: none;
	}

	.columns-container:not(.columns-stacked) > .column-separator-visual {
		width: auto;
		flex: 0 0 auto;
		border-left: none;
		border-top: var(--sep-width, 1px) var(--sep-style, solid) var(--sep-color, var(--background-modifier-border));
		margin: 2px 8px;
	}

	.columns-container:not(.columns-stacked) > .column-separator-custom {
		writing-mode: horizontal-tb;
		width: auto;
	}

	/* Reading view: the divider between columns becomes a horizontal line. */
	.columns-container.columns-reading:not(.columns-stacked) > :is(.column-item, .columns-stack-group) + :is(.column-item, .columns-stack-group):not(.amc-no-divider-before)::before {
		left: 8px;
		right: 8px;
		top: calc(var(--amc-stack-gap) / -2);
		bottom: auto;
		border-left: none;
		border-top: var(--amc-divider-width, 0px) var(--amc-divider-style, solid) var(--amc-divider-color, var(--background-modifier-border));
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

interface AttachedStyles {
	sheet: CSSStyleSheet | null;
	el: HTMLStyleElement | null;
}

/**
 * The runtime styles, attached to every window that shows notes: the main
 * window and each popout. Each document gets its own stylesheet, removed
 * from that same document again — never from whichever window happens to be
 * focused.
 */
export class RuntimeStyleSheets {
	private readonly attached = new Map<Document, AttachedStyles>();
	private css = "";

	/** Replace the styles in every attached window. */
	update(css: string): void {
		this.css = css;
		for (const doc of this.attached.keys()) this.write(doc);
	}

	attach(doc: Document): void {
		if (!this.attached.has(doc)) this.attached.set(doc, {sheet: null, el: null});
		this.write(doc);
	}

	detach(doc: Document): void {
		const styles = this.attached.get(doc);
		if (!styles) return;
		this.attached.delete(doc);
		if (styles.sheet) {
			try {
				doc.adoptedStyleSheets = doc.adoptedStyleSheets.filter((sheet) => sheet !== styles.sheet);
			} catch {
				// The window may already be closing.
			}
		}
		styles.el?.remove();
	}

	detachAll(): void {
		for (const doc of [...this.attached.keys()]) this.detach(doc);
	}

	private write(doc: Document): void {
		const styles = this.attached.get(doc);
		if (!styles) return;
		// Preferred: a constructed stylesheet, created in the document's own
		// realm (adopting one from another window throws).
		if (!styles.el) {
			try {
				if (!styles.sheet) {
					const view = doc.defaultView;
					if (!view || !("adoptedStyleSheets" in doc)) throw new Error("unsupported");
					styles.sheet = new view.CSSStyleSheet();
					doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, styles.sheet];
				}
				styles.sheet.replaceSync(this.css);
				return;
			} catch {
				if (styles.sheet) {
					const failed = styles.sheet;
					doc.adoptedStyleSheets = doc.adoptedStyleSheets.filter((sheet) => sheet !== failed);
					styles.sheet = null;
				}
			}
		}
		// Fallback: a plain <style> element.
		if (!styles.el?.isConnected) {
			styles.el = (doc.head ?? doc.documentElement).createEl("style", {attr: {id: "amc-runtime-styles"}});
		}
		styles.el.textContent = this.css;
	}
}
