import {
	Component,
	MarkdownPostProcessorContext,
	MarkdownRenderer,
	MarkdownView,
	TFile,
} from "obsidian";
import {findColumnRegions} from "./core/parser";
import {applyColumnStyle, applyContainerStyle} from "./core/column-style";
import {buildSeparatorElement, groupColumns} from "./render/column-renderer";
import type {ColumnRegion} from "./core/types";
import type ColumnsPlugin from "../main";

const RV_DEBUG = false;
const RV_ACTIVE_CLASS = "amc-reading-columns-active";
const RV_HOST_CLASS = "amc-reading-columns-host";

interface RenderState {
	sourcePath: string;
	fingerprint: string;
	wrapper: HTMLElement;
	host: HTMLElement;
	previewEl: HTMLElement;
	component: Component;
	renderId: number;
	createdAt: number;
	previewObserver?: MutationObserver;
	hostObserver?: MutationObserver;
	wrapperObserver?: MutationObserver;
	sizerObserver?: MutationObserver;
}

interface ScrollSnapshot {
	el: HTMLElement;
	top: number;
	left: number;
}

type ScrollRestoreGuard = () => boolean;

function rvWarn(...args: unknown[]): void {
	if (!RV_DEBUG) return;
	console.warn("[AMC RV]", ...args);
}

function rvError(...args: unknown[]): void {
	if (!RV_DEBUG) return;
	console.error("[AMC RV]", ...args);
}

function resolveSizerForElement(
	el: HTMLElement,
	plugin: ColumnsPlugin,
	sourcePathHint: string | undefined,
): HTMLElement | null {
	const closest = el.closest(".markdown-preview-sizer");
	if (closest instanceof HTMLElement) return closest;

	if (sourcePathHint) {
		const leaves = plugin.app.workspace.getLeavesOfType("markdown");
		for (const leaf of leaves) {
			const view = leaf.view;
			if (!(view instanceof MarkdownView)) continue;
			if (view.file?.path !== sourcePathHint) continue;

			const sizer = view.previewMode.containerEl.querySelector(".markdown-preview-sizer");
			if (sizer instanceof HTMLElement) return sizer;
		}
	}

	return null;
}

function resolveViewForSizer(
	sizer: HTMLElement,
	plugin: ColumnsPlugin,
): MarkdownView | null {
	const leaves = plugin.app.workspace.getLeavesOfType("markdown");
	for (const leaf of leaves) {
		const view = leaf.view;
		if (!(view instanceof MarkdownView)) continue;
		if (view.previewMode.containerEl.contains(sizer)) {
			return view;
		}
	}
	return null;
}

function resolvePreviewElementForSizer(sizer: HTMLElement): HTMLElement | null {
	const preview = sizer.closest(".markdown-preview-view");
	return preview instanceof HTMLElement ? preview : null;
}

function getWrapperHost(previewEl: HTMLElement): HTMLElement | null {
	const host = previewEl.querySelector(`:scope > .${RV_HOST_CLASS}`);
	return host instanceof HTMLElement ? host : null;
}

function ensureWrapperHost(
	previewEl: HTMLElement,
	sizer: HTMLElement,
): HTMLElement {
	const existing = getWrapperHost(previewEl);
	if (existing) return existing;

	const host = document.createElement("div");
	host.className = RV_HOST_CLASS;
	if (sizer.nextSibling) {
		previewEl.insertBefore(host, sizer.nextSibling);
	} else {
		previewEl.appendChild(host);
	}
	return host;
}

function isScrollableElement(el: HTMLElement): boolean {
	const style = window.getComputedStyle(el);
	const overflowY = style.overflowY;
	const overflowX = style.overflowX;
	const canScrollY = (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay")
		&& el.scrollHeight > el.clientHeight + 1;
	const canScrollX = (overflowX === "auto" || overflowX === "scroll" || overflowX === "overlay")
		&& el.scrollWidth > el.clientWidth + 1;
	return canScrollY || canScrollX;
}

function captureScrollSnapshot(fromEl: HTMLElement): ScrollSnapshot[] {
	const snapshots: ScrollSnapshot[] = [];
	const leafContent = fromEl.closest(".workspace-leaf-content");
	const stopAt = leafContent instanceof HTMLElement ? leafContent : null;
	let current: HTMLElement | null = fromEl;
	while (current) {
		if (isScrollableElement(current)) {
			snapshots.push({
				el: current,
				top: current.scrollTop,
				left: current.scrollLeft,
			});
		}
		if (current === stopAt) break;
		current = current.parentElement;
	}
	return snapshots;
}

function restoreScrollSnapshot(
	snapshots: ScrollSnapshot[],
	shouldRestore: ScrollRestoreGuard,
): void {
	if (!shouldRestore()) return;
	for (const snap of snapshots) {
		if (!shouldRestore()) break;
		if (!snap.el.isConnected) continue;
		snap.el.scrollTop = snap.top;
		snap.el.scrollLeft = snap.left;
	}
}

function restoreScrollSnapshotStable(
	snapshots: ScrollSnapshot[],
	shouldRestore: ScrollRestoreGuard,
): void {
	restoreScrollSnapshot(snapshots, shouldRestore);
	requestAnimationFrame(() => {
		restoreScrollSnapshot(snapshots, shouldRestore);
		requestAnimationFrame(() => {
			restoreScrollSnapshot(snapshots, shouldRestore);
		});
	});
}

/** Move .mod-footer from sizer into previewEl (after host) so backlinks appear below columns. */
function relocateFooter(sizer: HTMLElement, previewEl: HTMLElement, host: HTMLElement): void {
	const footer = sizer.querySelector(":scope > .mod-footer");
	if (footer instanceof HTMLElement) {
		// Insert footer after the host
		if (host.nextSibling) {
			previewEl.insertBefore(footer, host.nextSibling);
		} else {
			previewEl.appendChild(footer);
		}
	}
}

/** Move .mod-footer back into sizer when tearing down columns. */
function restoreFooter(previewEl: HTMLElement, sizer: HTMLElement): void {
	const footer = previewEl.querySelector(":scope > .mod-footer");
	if (footer instanceof HTMLElement) {
		sizer.appendChild(footer);
	}
}

const RV_HIDDEN_CLASS = "amc-rv-hidden";

/** Hide el-* content divs and the pusher inside the sizer, preserving
 *  metadata containers, banner plugin elements, inline titles, etc. */
function hideSizerContent(sizer: HTMLElement): void {
	for (const child of Array.from(sizer.children)) {
		if (!(child instanceof HTMLElement)) continue;
		const cls = child.className;
		const isElDiv = cls.startsWith("el-") || cls.includes(" el-");
		const isPusher = child.classList.contains("markdown-preview-pusher");
		if (isElDiv || isPusher) {
			child.classList.add(RV_HIDDEN_CLASS);
		}
	}
}

/** Restore hidden elements when tearing down. */
function restoreSizerContent(sizer: HTMLElement): void {
	const hidden = sizer.querySelectorAll<HTMLElement>(`:scope > .${RV_HIDDEN_CLASS}`);
	for (let i = 0; i < hidden.length; i++) {
		hidden[i]!.classList.remove(RV_HIDDEN_CLASS);
	}
}

function teardownSizer(
	sizer: HTMLElement,
	states: WeakMap<HTMLElement, RenderState>,
	reason = "teardown",
): void {
	const state = states.get(sizer);
	if (!state) return;

	state.previewObserver?.disconnect();
	state.hostObserver?.disconnect();
	state.wrapperObserver?.disconnect();
	state.sizerObserver?.disconnect();
	state.component.unload();
	state.wrapper.remove();
	restoreFooter(state.previewEl, sizer);
	restoreSizerContent(sizer);
	state.previewEl.classList.remove(RV_ACTIVE_CLASS);
	if (!state.host.hasChildNodes()) {
		state.host.remove();
	}
	states.delete(sizer);
	rvWarn("teardown wrapper", {
		reason,
		renderId: state.renderId,
		sourcePath: state.sourcePath,
		sizerChildren: sizer.children.length,
		hostConnected: state.host.isConnected,
		hostChildren: state.host.children.length,
	});
}

function textFingerprint(sourcePath: string, text: string, regions: ColumnRegion[]): string {
	const first = text.length > 0 ? text.charCodeAt(0) : 0;
	const last = text.length > 0 ? text.charCodeAt(text.length - 1) : 0;
	return `${sourcePath}\u0000${text.length}\u0000${regions.length}\u0000${first}\u0000${last}`;
}

async function renderMarkdownSegment(
	plugin: ColumnsPlugin,
	component: Component,
	parent: HTMLElement,
	markdown: string,
	sourcePath: string,
): Promise<void> {
	if (markdown.trim().length === 0) return;

	const host = document.createElement("div");
	host.className = "columns-rv-segment";
	parent.appendChild(host);
	await MarkdownRenderer.render(plugin.app, markdown, host, sourcePath, component);
}

async function renderColumnsRegion(
	plugin: ColumnsPlugin,
	component: Component,
	parent: HTMLElement,
	region: ColumnRegion,
	sourcePath: string,
	depth = 0,
): Promise<void> {
	if (depth > 8) return;

	const containerEl = document.createElement("div");
	containerEl.className = "columns-container columns-ui columns-reading";
	const isContainerStacked = region.layout === "stack";
	if (isContainerStacked) containerEl.classList.add("columns-stacked");
	applyContainerStyle(containerEl, region.containerStyle);
	if (depth > 0) containerEl.classList.add("columns-nested");
	parent.appendChild(containerEl);

	const groups = isContainerStacked
		? [{indices: region.columns.map((_, i) => i), isStack: true}]
		: groupColumns(region.columns);

	for (let gi = 0; gi < groups.length; gi++) {
		const group = groups[gi]!;

		if (gi > 0) {
			const prevGroup = groups[gi - 1]!;
			buildSeparatorElement(containerEl, region.columns[prevGroup.indices[prevGroup.indices.length - 1]!]!);
		}

		let groupParent: HTMLElement;
		if (group.isStack && !isContainerStacked && group.indices.length > 0) {
			const stackGroupEl = document.createElement("div");
			stackGroupEl.className = "columns-stack-group";
			const maxWidth = Math.max(...group.indices.map((idx) => region.columns[idx]!.widthPercent));
			if (maxWidth > 0) {
				const sepTotal = (groups.length - 1) * 8;
				const shrink = sepTotal / groups.length;
				stackGroupEl.style.flex = `0 0 calc(${maxWidth}% - ${shrink.toFixed(1)}px)`;
			}
			containerEl.appendChild(stackGroupEl);
			groupParent = stackGroupEl;
		} else {
			groupParent = containerEl;
		}

		for (let gi2 = 0; gi2 < group.indices.length; gi2++) {
			const ci = group.indices[gi2]!;
			const col = region.columns[ci]!;

			if (gi2 > 0 && group.isStack) {
				buildSeparatorElement(groupParent, region.columns[group.indices[gi2 - 1]!]!);
			}

			const colEl = document.createElement("div");
			colEl.className = "column-item";
			colEl.dataset.colIndex = String(ci);
			applyColumnStyle(colEl, col.style);

			if (group.isStack) {
				// Stacked: full width via CSS
			} else if (!isContainerStacked && col.widthPercent > 0) {
				const sepTotal = (groups.length - 1) * 8;
				const shrink = sepTotal / groups.length;
				colEl.style.flex = `0 0 calc(${col.widthPercent}% - ${shrink.toFixed(1)}px)`;
			}

			const previewEl = document.createElement("div");
			previewEl.className = "column-preview markdown-rendered";
			colEl.appendChild(previewEl);
			groupParent.appendChild(colEl);

			if (col.content.trim().length > 0) {
				await renderColumnContent(
					plugin, component, previewEl, col.content, sourcePath, depth + 1,
				);
			}
		}
	}
}

/** Render a column's content, recursively handling nested column regions. */
async function renderColumnContent(
	plugin: ColumnsPlugin,
	component: Component,
	parent: HTMLElement,
	content: string,
	sourcePath: string,
	depth: number,
): Promise<void> {
	if (depth > 8) {
		await MarkdownRenderer.render(plugin.app, content, parent, sourcePath, component);
		return;
	}

	const nested = findColumnRegions(content);
	if (nested.length === 0) {
		await MarkdownRenderer.render(plugin.app, content, parent, sourcePath, component);
		return;
	}

	const sorted = [...nested].sort((a, b) => a.from - b.from);
	let cursor = 0;
	for (const region of sorted) {
		if (region.from > cursor) {
			const text = content.slice(cursor, region.from).trim();
			if (text) {
				const div = document.createElement("div");
				parent.appendChild(div);
				await MarkdownRenderer.render(plugin.app, text, div, sourcePath, component);
			}
		}
		await renderColumnsRegion(plugin, component, parent, region, sourcePath, depth);
		cursor = region.to;
	}

	if (cursor < content.length) {
		const text = content.slice(cursor).trim();
		if (text) {
			const div = document.createElement("div");
			parent.appendChild(div);
			await MarkdownRenderer.render(plugin.app, text, div, sourcePath, component);
		}
	}
}

/** Skip past frontmatter (--- ... ---) and return the char offset where content starts. */
function getFrontmatterEnd(text: string): number {
	if (!text.startsWith("---")) return 0;
	const close = text.indexOf("\n---", 3);
	if (close === -1) return 0;
	// Move past the closing --- and its newline
	const end = text.indexOf("\n", close + 4);
	return end === -1 ? close + 4 : end + 1;
}

async function buildWrapper(
	plugin: ColumnsPlugin,
	sourcePath: string,
	text: string,
	regions: ColumnRegion[],
	component: Component,
): Promise<HTMLElement> {
	const wrapper = document.createElement("div");
	wrapper.className = "columns-rv-wrapper";
	wrapper.dataset.columnsSourcePath = sourcePath;

	let cursor = getFrontmatterEnd(text);
	for (const region of regions) {
		const before = text.slice(cursor, region.from);
		await renderMarkdownSegment(plugin, component, wrapper, before, sourcePath);
		await renderColumnsRegion(plugin, component, wrapper, region, sourcePath);
		cursor = region.to;
	}
	const after = text.slice(cursor);
	await renderMarkdownSegment(plugin, component, wrapper, after, sourcePath);

	return wrapper;
}

export function registerReadingView(plugin: ColumnsPlugin): () => void {
	const states = new WeakMap<HTMLElement, RenderState>();
	const timers = new WeakMap<HTMLElement, number>();
	const renderTokens = new WeakMap<HTMLElement, number>();
	const sourceReads = new Map<string, Promise<string | null>>();
	const sourceHints = new WeakMap<HTMLElement, string>();
	const retryCounts = new WeakMap<HTMLElement, number>();
	const activeSizers = new Set<HTMLElement>();
	let renderIdSeq = 0;

	const invalidateRenderToken = (sizer: HTMLElement): void => {
		const current = renderTokens.get(sizer) ?? 0;
		renderTokens.set(sizer, current + 1);
	};

	const sizerSnapshot = (sizer: HTMLElement, state?: RenderState) => {
		const previewEl = state?.previewEl ?? resolvePreviewElementForSizer(sizer);
		const host = state?.host ?? (previewEl ? getWrapperHost(previewEl) : null);
		return {
			renderId: state?.renderId,
			sourcePath: state?.sourcePath ?? sourceHints.get(sizer) ?? "",
			sizerConnected: sizer.isConnected,
			sizerChildren: sizer.children.length,
			previewConnected: previewEl?.isConnected ?? false,
			previewActiveClass: previewEl?.classList.contains(RV_ACTIVE_CLASS) ?? false,
			hostConnected: host?.isConnected ?? false,
			hostChildren: host?.children.length ?? 0,
			wrapperConnected: state?.wrapper.isConnected ?? false,
			wrapperParentMatches: state ? state.wrapper.parentElement === state.host : false,
		};
	};

	function scheduleRender(
		sizer: HTMLElement,
		sourcePath: string,
		reason: string,
	): void {
		sourceHints.set(sizer, sourcePath);
		const existingTimer = timers.get(sizer);
		if (existingTimer !== undefined) {
			window.clearTimeout(existingTimer);
		}

		rvWarn("schedule render", {
			reason,
			sourcePath,
			hadPendingTimer: existingTimer !== undefined,
			sizerChildren: sizer.children.length,
		});

		const timer = window.setTimeout(() => {
			timers.delete(sizer);
			void renderSizer(sizer, reason);
		}, 50);
		timers.set(sizer, timer);
	}

	function handleWrapperDisappearance(
		sizer: HTMLElement,
		state: RenderState,
		reason: string,
	): void {
		rvError("wrapper disappeared", {
			reason,
			...sizerSnapshot(sizer, state),
		});
		if (states.get(sizer) !== state) return;

		state.previewObserver?.disconnect();
		state.hostObserver?.disconnect();
		state.wrapperObserver?.disconnect();
		state.sizerObserver?.disconnect();
		state.component.unload();
		states.delete(sizer);
		state.previewEl.classList.remove(RV_ACTIVE_CLASS);
		if (!state.host.hasChildNodes()) {
			state.host.remove();
		}

		const retries = retryCounts.get(sizer) ?? 0;
		if (retries >= 5) {
			rvError("max retries reached, giving up", {reason, retries});
			return;
		}
		retryCounts.set(sizer, retries + 1);
		scheduleRender(sizer, state.sourcePath, `recover:${reason}`);
	}

	function installLifecycleObservers(
		sizer: HTMLElement,
		state: RenderState,
	): void {
		state.previewObserver?.disconnect();
		state.hostObserver?.disconnect();
		state.wrapperObserver?.disconnect();
		state.sizerObserver?.disconnect();

		// Watch sizer for newly added children (scroll virtualization, mode switch)
		// and hide el-* / pusher elements that Obsidian adds after our initial render.
		const sizerObserver = new MutationObserver((mutations) => {
			for (const mutation of mutations) {
				for (const node of Array.from(mutation.addedNodes)) {
					if (!(node instanceof HTMLElement)) continue;
					const cls = node.className;
					const isElDiv = cls.startsWith("el-") || cls.includes(" el-");
					const isPusher = node.classList.contains("markdown-preview-pusher");
					if (isElDiv || isPusher) {
						node.classList.add(RV_HIDDEN_CLASS);
					}
				}
			}
			const footer = sizer.querySelector(":scope > .mod-footer");
			if (footer instanceof HTMLElement) {
				relocateFooter(sizer, state.previewEl, state.host);
			}
		});
		sizerObserver.observe(sizer, {childList: true});

		const previewObserver = new MutationObserver((mutations) => {
			for (const mutation of mutations) {
				if (mutation.type === "attributes" && mutation.attributeName === "class") {
					if (!state.previewEl.classList.contains(RV_ACTIVE_CLASS) && state.wrapper.isConnected) {
						rvWarn("active class removed while wrapper is still connected", {
							...sizerSnapshot(sizer, state),
						});
					}
				}
				if (mutation.type === "childList") {
					for (const removed of Array.from(mutation.removedNodes)) {
						if (removed === state.host) {
							rvError("host removed via preview childList mutation", {
								...sizerSnapshot(sizer, state),
							});
						}
					}
				}
			}

			if (
				!state.host.isConnected
				|| state.host.parentElement !== state.previewEl
				|| !state.wrapper.isConnected
				|| state.wrapper.parentElement !== state.host
			) {
				handleWrapperDisappearance(sizer, state, "preview-observer");
			}
		});
		previewObserver.observe(state.previewEl, {
			childList: true,
			attributes: true,
			attributeFilter: ["class", "style"],
		});

		const hostObserver = new MutationObserver((mutations) => {
			for (const mutation of mutations) {
				if (mutation.type === "childList") {
					for (const removed of Array.from(mutation.removedNodes)) {
						if (removed === state.wrapper) {
							rvError("wrapper removed via host childList mutation", {
								...sizerSnapshot(sizer, state),
							});
						}
					}
				}
				if (mutation.type === "attributes") {
					rvWarn("host attributes changed", {
						attribute: mutation.attributeName,
						...sizerSnapshot(sizer, state),
					});
				}
			}

			if (!state.wrapper.isConnected || state.wrapper.parentElement !== state.host) {
				handleWrapperDisappearance(sizer, state, "host-observer");
			}
		});
		hostObserver.observe(state.host, {
			childList: true,
			attributes: true,
			attributeFilter: ["class", "style", "hidden"],
		});

		const wrapperObserver = new MutationObserver((mutations) => {
			for (const mutation of mutations) {
				if (mutation.type !== "attributes") continue;
				rvWarn("wrapper attributes changed", {
					attribute: mutation.attributeName,
					...sizerSnapshot(sizer, state),
				});
			}
			if (!state.wrapper.isConnected || state.wrapper.parentElement !== state.host) {
				handleWrapperDisappearance(sizer, state, "wrapper-observer");
			}
		});
		wrapperObserver.observe(state.wrapper, {
			attributes: true,
			attributeFilter: ["class", "style", "hidden"],
		});

		state.previewObserver = previewObserver;
		state.hostObserver = hostObserver;
		state.wrapperObserver = wrapperObserver;
		state.sizerObserver = sizerObserver;
		rvWarn("lifecycle observers attached", sizerSnapshot(sizer, state));
	}

	const readSource = async (
		sourcePath: string,
		fallbackText: string,
	): Promise<string> => {
		if (!sourcePath) return fallbackText;

		const pending = sourceReads.get(sourcePath);
		if (pending) {
			const text = await pending;
			return text ?? fallbackText;
		}

		const read = (async () => {
			const file = plugin.app.vault.getAbstractFileByPath(sourcePath);
			if (!(file instanceof TFile)) return null;
			try {
				return await plugin.app.vault.cachedRead(file);
			} catch {
				return null;
			}
		})();

		// Race with a 10s timeout to prevent hanging promises
		const withTimeout = Promise.race([
			read,
			new Promise<null>((resolve) => setTimeout(() => resolve(null), 10_000)),
		]);

		sourceReads.set(sourcePath, withTimeout);
		try {
			const text = await withTimeout;
			return text ?? fallbackText;
		} finally {
			sourceReads.delete(sourcePath);
		}
	};

	async function renderSizer(
		sizer: HTMLElement,
		reason: string,
	): Promise<void> {
		activeSizers.add(sizer);
		const token = (renderTokens.get(sizer) ?? 0) + 1;
		renderTokens.set(sizer, token);

		rvWarn("render start", {
			reason,
			token,
			sourceHint: sourceHints.get(sizer) ?? "",
			sizerConnected: sizer.isConnected,
			sizerChildren: sizer.children.length,
		});

		if (!sizer.isConnected) {
			rvWarn("render skipped: sizer disconnected", {token});
			return;
		}
		const previewEl = resolvePreviewElementForSizer(sizer);
		if (!previewEl) {
			rvWarn("render skipped: no preview element for sizer", {token});
			return;
		}
		if (!previewEl.closest(".markdown-reading-view")) {
			invalidateRenderToken(sizer);
			teardownSizer(sizer, states, "render skipped: not in reading view");
			return;
		}
		const view = resolveViewForSizer(sizer, plugin);
		const scrollSnapshot = captureScrollSnapshot(previewEl);
		const shouldRestoreScroll = (): boolean => {
			if (!plugin.settings.enableReadingView) return false;
			if (!sizer.isConnected) return false;
			if (renderTokens.get(sizer) !== token) return false;
			if (!previewEl.isConnected) return false;
			if (!previewEl.closest(".markdown-reading-view")) return false;
			return true;
		};
		if (!plugin.settings.enableReadingView) {
			invalidateRenderToken(sizer);
			teardownSizer(sizer, states, "settings disabled");
			return;
		}

		const sourcePath = sourceHints.get(sizer) || view?.file?.path || "";

		if (!view && !sourcePath) {
			// No view and no source hint — retry after a short delay
			// (workspace may not be fully initialized on first load)
			const retries = retryCounts.get(sizer) ?? 0;
			if (retries < 5) {
				retryCounts.set(sizer, retries + 1);
				rvWarn("render deferred: no view or source path, retrying", {token, retries});
				scheduleRender(sizer, "", `retry-no-view:${retries}`);
			} else {
				rvWarn("render skipped: no view or source path after retries", {token});
			}
			return;
		}

		const fallbackText = view?.getViewData() ?? "";
		const text = await readSource(sourcePath, fallbackText);

		if (!sizer.isConnected || renderTokens.get(sizer) !== token) {
			rvWarn("render aborted: stale token or disconnected sizer", {
				token,
				sizerConnected: sizer.isConnected,
				currentToken: renderTokens.get(sizer) ?? 0,
			});
			return;
		}

		const regions = findColumnRegions(text);
		if (regions.length === 0) {
			// On first load the vault/view may not be ready yet, yielding empty text.
			// Retry a few times before giving up.
			const retries = retryCounts.get(sizer) ?? 0;
			if (retries < 5 && sourcePath) {
				retryCounts.set(sizer, retries + 1);
				rvWarn("render found no regions, retrying", {sourcePath, retries});
				scheduleRender(sizer, sourcePath, `retry-no-regions:${retries}`);
			} else {
				rvWarn("render found no marker regions", {sourcePath});
				teardownSizer(sizer, states, "no regions");
			}
			return;
		}

		const fingerprint = textFingerprint(sourcePath, text, regions);
		const existing = states.get(sizer);
		if (
			existing
			&& existing.fingerprint === fingerprint
			&& existing.wrapper.isConnected
			&& existing.host.isConnected
			&& existing.host.parentElement === existing.previewEl
			&& existing.wrapper.parentElement === existing.host
		) {
			if (!existing.previewEl.classList.contains(RV_ACTIVE_CLASS)) {
				rvWarn("wrapper connected but active class missing; restoring class", {
					...sizerSnapshot(sizer, existing),
				});
			}
			existing.previewEl.classList.add(RV_ACTIVE_CLASS);
			hideSizerContent(sizer);
			restoreScrollSnapshotStable(scrollSnapshot, shouldRestoreScroll);
			rvWarn("render reused existing wrapper", sizerSnapshot(sizer, existing));
			return;
		}

		if (existing) {
			if (!existing.wrapper.isConnected || existing.wrapper.parentElement !== existing.host) {
				rvError("existing wrapper missing before rebuild", sizerSnapshot(sizer, existing));
			}
			teardownSizer(sizer, states, "refresh");
		}

		const host = ensureWrapperHost(previewEl, sizer);

		const component = new Component();
		component.load();
		const renderId = ++renderIdSeq;

		// Hide sizer content early and install a temporary observer to catch
		// elements Obsidian adds during the async wrapper build (mode switch,
		// scroll virtualization). This prevents flat content from flashing.
		previewEl.classList.add(RV_ACTIVE_CLASS);
		hideSizerContent(sizer);

		const earlySizerObserver = new MutationObserver((mutations) => {
			for (const mutation of mutations) {
				for (const node of Array.from(mutation.addedNodes)) {
					if (!(node instanceof HTMLElement)) continue;
					const cls = node.className;
					const isElDiv = cls.startsWith("el-") || cls.includes(" el-");
					const isPusher = node.classList.contains("markdown-preview-pusher");
					if (isElDiv || isPusher) {
						node.classList.add(RV_HIDDEN_CLASS);
					}
				}
			}
		});
		earlySizerObserver.observe(sizer, {childList: true});

		try {
			const wrapper = await buildWrapper(plugin, sourcePath, text, regions, component);

			// Disconnect the early observer; the full lifecycle observer replaces it
			earlySizerObserver.disconnect();

			if (!sizer.isConnected || renderTokens.get(sizer) !== token) {
				component.unload();
				previewEl.classList.remove(RV_ACTIVE_CLASS);
				restoreSizerContent(sizer);
				rvWarn("render result dropped: stale after async build", {
					renderId,
					token,
					sizerConnected: sizer.isConnected,
				});
				return;
			}

			while (host.firstChild) {
				host.removeChild(host.firstChild);
			}
			wrapper.dataset.columnsRenderId = String(renderId);
			host.appendChild(wrapper);
			// Re-hide in case anything was added between observer batches
			hideSizerContent(sizer);
			relocateFooter(sizer, previewEl, host);
			restoreScrollSnapshotStable(scrollSnapshot, shouldRestoreScroll);
			const state: RenderState = {
				sourcePath,
				fingerprint,
				wrapper,
				host,
				previewEl,
				component,
				renderId,
				createdAt: Date.now(),
			};
			states.set(sizer, state);
			retryCounts.delete(sizer);
			installLifecycleObservers(sizer, state);
			rvWarn("rendered wrapper", {
				renderId,
				sourcePath,
				regions: regions.length,
				columnsContainers: wrapper.querySelectorAll(".columns-container").length,
				sizerChildren: sizer.children.length,
			});
		} catch (error) {
			earlySizerObserver.disconnect();
			component.unload();
			previewEl.classList.remove(RV_ACTIVE_CLASS);
			restoreSizerContent(sizer);
			restoreScrollSnapshotStable(scrollSnapshot, shouldRestoreScroll);
			rvError("render failed", {
				renderId,
				sourcePath,
				error,
			});
		}
	}

	plugin.registerMarkdownPostProcessor(
		(el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
			if (el.closest(".columns-rv-wrapper")) return;

			const sizer = resolveSizerForElement(el, plugin, ctx.sourcePath);
			if (!(sizer instanceof HTMLElement)) return;
			const previewEl = resolvePreviewElementForSizer(sizer);
			if (!(previewEl instanceof HTMLElement)) return;
			if (!previewEl.closest(".markdown-reading-view")) return;

			if (!plugin.settings.enableReadingView) {
				teardownSizer(sizer, states, "settings disabled in postprocessor");
				return;
			}

			const existing = states.get(sizer);
			if (existing) {
				if (!existing.wrapper.isConnected || existing.wrapper.parentElement !== existing.host) {
					rvError("postprocessor detected missing wrapper", sizerSnapshot(sizer, existing));
				} else if (!existing.previewEl.classList.contains(RV_ACTIVE_CLASS)) {
					rvWarn("postprocessor detected wrapper without active class", sizerSnapshot(sizer, existing));
				}
			}

			scheduleRender(sizer, ctx.sourcePath ?? "", "postprocessor");
		},
	);

	// Return cleanup function for plugin onunload
	return () => {
		for (const sizer of activeSizers) {
			teardownSizer(sizer, states, "plugin-unload");
			const timer = timers.get(sizer);
			if (timer !== undefined) {
				window.clearTimeout(timer);
				timers.delete(sizer);
			}
		}
		activeSizers.clear();
		sourceReads.clear();
	};
}
