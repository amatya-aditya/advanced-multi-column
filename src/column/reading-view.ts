import {
	MarkdownPostProcessorContext,
	MarkdownRenderChild,
	MarkdownRenderer,
	MarkdownView,
	TFile,
} from "obsidian";
import {findColumnRegions} from "./parser";
import {applyColumnStyle, applyContainerStyle} from "./column-style";
import type {ColumnRegion} from "./types";
import type ColumnsPlugin from "../main";

/** Data attribute used to track which file a wrapper was built for */
const WRAPPER_PATH_ATTR = "data-columns-source-path";

/**
 * Reading-view column rendering.
 *
 * Strategy — "CSS-driven hiding + minimal presence observer":
 *
 * 1. Original sizer children are hidden via a CSS `:has()` rule — zero JS
 *    class toggling means zero DOM-mutation feedback loops during scroll.
 *
 * 2. A lightweight MutationObserver watches ONLY for wrapper removal.
 *    Its callback makes NO DOM mutations — it just schedules a rebuild
 *    through the normal debounced path.  This is critical: Obsidian's
 *    reading view can remove sizer children during scroll or re-render,
 *    and without this observer the columns would never come back until
 *    the user clicked to trigger a workspace event.
 *
 * 3. The wrapper is built fully off-DOM, then appended in a single
 *    mutation bracketed by scroll-position save/restore and a temporary
 *    height pin to prevent scroll jumps.
 */
export function registerReadingView(plugin: ColumnsPlugin): void {
	const processing = new WeakSet<HTMLElement>();
	const wrapperObservers = new WeakMap<HTMLElement, MutationObserver>();
	type ScheduleMode = "debounced" | "immediate";

	/** Debounce timers per sizer to batch rapid post-processor calls */
	const debounceTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

	/**
	 * Cache the last-built wrapper per sizer so we can restore it
	 * instantly if Obsidian removes it during scroll, instead of
	 * doing a full async rebuild.
	 */
	const wrapperCache = new WeakMap<HTMLElement, HTMLElement>();

	const scheduleSizer = (
		sizer: HTMLElement,
		file: TFile,
		mode: ScheduleMode = "debounced",
	) => {
		const existingWrapper = sizer.querySelector(":scope > .columns-rv-wrapper");
		if (existingWrapper instanceof HTMLElement) {
			const wrapperPath = existingWrapper.getAttribute(WRAPPER_PATH_ATTR);
			if (wrapperPath === file.path) return;
		}

		const existing = debounceTimers.get(sizer);
		if (existing) clearTimeout(existing);
		if (mode === "immediate") {
			processSizer(sizer, file);
			return;
		}

		const filePath = file.path;
		const timer = setTimeout(() => {
			debounceTimers.delete(sizer);
			const currentFile = plugin.app.vault.getAbstractFileByPath(filePath);
			if (!(currentFile instanceof TFile)) return;
			processSizer(sizer, currentFile);
		}, 40);
		debounceTimers.set(sizer, timer);
	};

	/**
	 * Core: check a single sizer and process it if needed.
	 */
	const processSizer = (sizer: HTMLElement, file: TFile) => {
		const existingWrapper = sizer.querySelector(
			":scope > .columns-rv-wrapper",
		);

		// Setting disabled → clean up
		if (!plugin.settings.enableReadingView) {
			if (existingWrapper) existingWrapper.remove();
			disconnectObserver(sizer, wrapperObservers);
			wrapperCache.delete(sizer);
			return;
		}

		// If wrapper exists but was built for a DIFFERENT file, tear it down
		if (existingWrapper) {
			const wrapperPath = existingWrapper.getAttribute(WRAPPER_PATH_ATTR);
			if (wrapperPath && wrapperPath !== file.path) {
				existingWrapper.remove();
				disconnectObserver(sizer, wrapperObservers);
				wrapperCache.delete(sizer);
				// Fall through to rebuild for the new file
			} else {
				// Same file and wrapper still present — nothing to do.
				return;
			}
		}

		// Fast path: if we have a cached wrapper for this file, re-attach it
		// instead of doing a full async rebuild.  This handles the common case
		// where Obsidian removes our wrapper during scroll/re-render.
		const cached = wrapperCache.get(sizer);
		if (
			cached &&
			cached.getAttribute(WRAPPER_PATH_ATTR) === file.path &&
			sizer.isConnected
		) {
			attachWrapper(sizer, cached);
			installPresenceObserver(sizer, file, wrapperObservers, scheduleSizer);
			return;
		}

		if (processing.has(sizer)) return;
		processing.add(sizer);

		const filePath = file.path;
		void plugin.app.vault
			.cachedRead(file)
			.then(async (rawSource: string) => {
				// Verify sizer still belongs to this file (user may have switched)
				const currentFile = resolveFileForSizer(sizer, plugin);
				if (currentFile && currentFile.path !== filePath) return;

				const regions = findColumnRegions(rawSource);
				if (regions.length === 0) {
					const w = sizer.querySelector(":scope > .columns-rv-wrapper");
					if (w) w.remove();
					disconnectObserver(sizer, wrapperObservers);
					wrapperCache.delete(sizer);
					return;
				}

				// Another path may have processed while we waited
				if (sizer.querySelector(":scope > .columns-rv-wrapper")) return;

				const wrapper = await buildWrapper(rawSource, regions, filePath, plugin);

				// If DOM changed while we were rendering, avoid stale attach.
				if (!sizer.isConnected) return;
				if (sizer.querySelector(":scope > .columns-rv-wrapper")) return;

				attachWrapper(sizer, wrapper);

				// Cache the wrapper so re-attachment after removal is instant
				wrapperCache.set(sizer, wrapper);

				// Watch for Obsidian removing our wrapper
				installPresenceObserver(sizer, file, wrapperObservers, scheduleSizer);
			})
			.catch(() => {
				// noop
			})
			.finally(() => {
				processing.delete(sizer);
			});
	};

	// ── Trigger 1: Post-processor ────────────────────────────────
	plugin.registerMarkdownPostProcessor(
		(el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
			if (el.closest(".columns-rv-wrapper")) return;
			if (el.closest(".columns-container")) return;

			const sizer = el.parentElement;
			if (!sizer) return;
			if (!sizer.classList.contains("markdown-preview-sizer")) return;

			const paneFile = resolveFileForSizer(sizer, plugin);
			if (!(paneFile instanceof TFile)) return;
			if (ctx.sourcePath && ctx.sourcePath !== paneFile.path) return;

			scheduleSizer(sizer, paneFile, "debounced");
		},
	);

	// ── Trigger 2: Events ────────────────────────────────────────
	const processLeaves = (mode: ScheduleMode = "debounced") => {
		const leaves = plugin.app.workspace.getLeavesOfType("markdown");
		for (const leaf of leaves) {
			const view = leaf.view;
			if (!(view instanceof MarkdownView)) continue;
			if (view.getMode() !== "preview") continue;

			const file = view.file;
			if (!file) continue;

			const sizerEl = view.previewMode.containerEl.querySelector(
				".markdown-preview-sizer",
			);
			if (!(sizerEl instanceof HTMLElement)) continue;

			scheduleSizer(sizerEl, file, mode);
		}
	};

	const scheduleProcessLeaves = (delays: ReadonlyArray<number>, mode: ScheduleMode) => {
		for (const delay of delays) {
			if (delay <= 0) {
				processLeaves(mode);
				continue;
			}
			setTimeout(() => processLeaves(mode), delay);
		}
	};

	plugin.registerEvent(
		plugin.app.workspace.on("active-leaf-change", () =>
			scheduleProcessLeaves([0, 50], "immediate"),
		),
	);
	plugin.registerEvent(
		plugin.app.workspace.on("file-open", () =>
			scheduleProcessLeaves([0, 70], "immediate"),
		),
	);
	plugin.registerEvent(
		// @ts-expect-error — Obsidian fires this event but it's not in the public types
		plugin.app.workspace.on("editor-mode-change", () =>
			scheduleProcessLeaves([0, 40, 120], "immediate"),
		),
	);
}

// ═══════════════════════════════════════════════════════════════════════

/**
 * Resolve the current file for a sizer by walking up to the MarkdownView.
 */
function resolveFileForSizer(
	sizer: HTMLElement,
	plugin: ColumnsPlugin,
): TFile | null {
	const leaves = plugin.app.workspace.getLeavesOfType("markdown");
	for (const leaf of leaves) {
		const view = leaf.view;
		if (!(view instanceof MarkdownView)) continue;
		if (view.previewMode.containerEl.contains(sizer)) {
			return view.file;
		}
	}
	return null;
}

// ═══════════════════════════════════════════════════════════════════════
// Wrapper presence observer
// ═══════════════════════════════════════════════════════════════════════

/**
 * Install a minimal MutationObserver that ONLY watches for the wrapper
 * being removed from the sizer.  The callback makes ZERO DOM mutations —
 * it simply disconnects itself and schedules a rebuild.  Because the
 * callback never touches the DOM, there is no feedback loop.
 */
function installPresenceObserver(
	sizer: HTMLElement,
	file: TFile,
	observers: WeakMap<HTMLElement, MutationObserver>,
	scheduleSizer: (sizer: HTMLElement, file: TFile, mode: "immediate") => void,
): void {
	disconnectObserver(sizer, observers);

	const obs = new MutationObserver((mutations) => {
		for (const mutation of mutations) {
			for (const removed of Array.from(mutation.removedNodes)) {
				if (
					removed instanceof HTMLElement &&
					removed.classList.contains("columns-rv-wrapper")
				) {
					// Wrapper was removed by Obsidian.
					// Disconnect immediately — no further observing needed.
					obs.disconnect();
					observers.delete(sizer);

					// Schedule a rebuild on the next frame.  This small delay
					// lets Obsidian finish any ongoing DOM batch before we
					// re-attach the cached wrapper.  We use requestAnimationFrame
					// to stay off the current microtask and avoid interfering
					// with Obsidian's scroll-driven updates.
					requestAnimationFrame(() => {
						if (!sizer.isConnected) return;
						scheduleSizer(sizer, file, "immediate");
					});
					return;
				}
			}
		}
	});

	obs.observe(sizer, {childList: true});
	observers.set(sizer, obs);
}

function disconnectObserver(
	sizer: HTMLElement,
	observers: WeakMap<HTMLElement, MutationObserver>,
): void {
	const obs = observers.get(sizer);
	if (obs) {
		obs.disconnect();
		observers.delete(sizer);
	}
}

// ═══════════════════════════════════════════════════════════════════════
// Wrapper attach helper
// ═══════════════════════════════════════════════════════════════════════

/**
 * Attach a wrapper to the sizer with scroll-position preservation
 * and height pinning to prevent layout jumps.
 */
function attachWrapper(sizer: HTMLElement, wrapper: HTMLElement): void {
	// Save scroll position before DOM mutation.
	const scrollEl = sizer.closest(".markdown-preview-view") as HTMLElement | null;
	const savedTop = scrollEl ? scrollEl.scrollTop : 0;

	// Pin sizer height so appending + CSS hiding don't collapse it.
	const prevMinHeight = sizer.style.minHeight;
	sizer.style.minHeight = `${sizer.getBoundingClientRect().height}px`;

	// Single DOM mutation: append wrapper.
	// CSS `:has()` rule instantly hides original children — no JS needed.
	sizer.appendChild(wrapper);

	// Restore scroll position synchronously.
	if (scrollEl) scrollEl.scrollTop = savedTop;

	// Release the height pin after the browser has laid out the wrapper.
	requestAnimationFrame(() => {
		sizer.style.minHeight = prevMinHeight;
	});
}

// ═══════════════════════════════════════════════════════════════════════
// Build
// ═══════════════════════════════════════════════════════════════════════

/**
 * Detect frontmatter end line (0-based, exclusive).
 * Returns 0 if no frontmatter.
 */
function getFrontmatterEndLine(lines: string[]): number {
	if (lines.length === 0 || lines[0]?.trim() !== "---") return 0;
	for (let i = 1; i < lines.length; i++) {
		if (lines[i]?.trim() === "---") return i + 1;
	}
	return 0;
}

/**
 * Build a wrapper element off-DOM containing all rendered content.
 */
async function buildWrapper(
	rawSource: string,
	regions: ColumnRegion[],
	sourcePath: string,
	plugin: ColumnsPlugin,
): Promise<HTMLElement> {
	const sourceLines = rawSource.split("\n");
	const sorted = [...regions].sort((a, b) => a.lineStart - b.lineStart);
	const contentStart = getFrontmatterEndLine(sourceLines);

	const wrapper = document.createElement("div");
	wrapper.className = "columns-rv-wrapper";
	wrapper.setAttribute(WRAPPER_PATH_ATTR, sourcePath);

	let currentLine = contentStart;
	for (const region of sorted) {
		if (currentLine < region.lineStart) {
			const content = sourceLines
				.slice(currentLine, region.lineStart)
				.join("\n")
				.trim();
			if (content) {
				await renderMarkdown(wrapper, content, sourcePath, plugin);
			}
		}
		await renderColumns(wrapper, region, sourcePath, plugin);
		currentLine = region.lineEnd + 1;
	}

	if (currentLine < sourceLines.length) {
		const content = sourceLines.slice(currentLine).join("\n").trim();
		if (content) {
			await renderMarkdown(wrapper, content, sourcePath, plugin);
		}
	}

	return wrapper;
}

// ═══════════════════════════════════════════════════════════════════════
// Rendering helpers
// ═══════════════════════════════════════════════════════════════════════

async function renderMarkdown(
	parent: HTMLElement,
	content: string,
	sourcePath: string,
	plugin: ColumnsPlugin,
): Promise<void> {
	const div = parent.createDiv();
	const rc = new MarkdownRenderChild(div);
	plugin.addChild(rc);
	await MarkdownRenderer.render(plugin.app, content, div, sourcePath, rc);
}

async function renderColumns(
	parent: HTMLElement,
	region: ColumnRegion,
	sourcePath: string,
	plugin: ColumnsPlugin,
	depth = 0,
): Promise<void> {
	if (depth > 8) return;

	const cls = "columns-container columns-ui columns-reading";
	const container = parent.createDiv({cls});
	applyContainerStyle(container, region.containerStyle);
	if (depth > 0) container.addClass("columns-nested");

	for (let ci = 0; ci < region.columns.length; ci++) {
		if (ci > 0) {
			container.createDiv({cls: "column-separator-visual"});
		}

		const col = region.columns[ci]!;
		const colDiv = container.createDiv({cls: "column-item"});
		colDiv.dataset.colIndex = String(ci);
		applyColumnStyle(colDiv, col.style);

		if (col.widthPercent > 0) {
			// Account for separator visual width (1px + 4px margin each side = 9px) between columns
			const sepTotal = (region.columns.length - 1) * 9;
			const shrink = sepTotal / region.columns.length;
			colDiv.style.flex = `0 0 calc(${col.widthPercent}% - ${shrink.toFixed(1)}px)`;
		}

		if (col.content.length > 0) {
			await renderColumnContent(colDiv, col.content, sourcePath, plugin, depth + 1);
		} else {
			const placeholder = colDiv.createSpan({
				cls: "column-empty-placeholder",
			});
			placeholder.textContent = "Empty";
		}
	}
}

async function renderColumnContent(
	parent: HTMLElement,
	content: string,
	sourcePath: string,
	plugin: ColumnsPlugin,
	depth: number,
): Promise<void> {
	if (depth > 8) {
		await renderMarkdown(parent, content, sourcePath, plugin);
		return;
	}

	const regions = findColumnRegions(content);
	if (regions.length === 0) {
		await renderMarkdown(parent, content, sourcePath, plugin);
		return;
	}

	const sorted = [...regions].sort((a, b) => a.from - b.from);
	let cursor = 0;
	for (const region of sorted) {
		if (region.from > cursor) {
			const text = content.slice(cursor, region.from);
			if (text.trim().length > 0) {
				await renderMarkdown(parent, text, sourcePath, plugin);
			}
		}

		await renderColumns(parent, region, sourcePath, plugin, depth);
		cursor = region.to;
	}

	if (cursor < content.length) {
		const text = content.slice(cursor);
		if (text.trim().length > 0) {
			await renderMarkdown(parent, text, sourcePath, plugin);
		}
	}
}
