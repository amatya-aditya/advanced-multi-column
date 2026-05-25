import {MarkdownView, WorkspaceLeaf} from "obsidian";
import type ColumnsPlugin from "./main";

const FALLBACK_FOLD_ATTEMPT_DELAYS_MS = [60, 180];
const FOLD_ANIMATION_DURATION_MS = 180;
const FOLD_PENDING_RESET_DELAY_MS = 420;
const PROPERTY_CONTAINER_SELECTOR = ".metadata-container";
const PROPERTY_HEADING_SELECTOR = ".metadata-properties-heading";
const COLLAPSED_CLASS = "is-collapsed";
const VIEW_PENDING_CLASS = "amc-properties-fold-pending";
const CONTAINER_FOLDING_CLASS = "amc-properties-auto-folding";

function clearViewPendingClass(view: MarkdownView): void {
	view.containerEl.classList.remove(VIEW_PENDING_CLASS);
}

function scheduleContainerCleanup(
	container: HTMLElement,
	timers?: Set<number>,
): void {
	const cleanup = () => {
		container.classList.remove(CONTAINER_FOLDING_CLASS);
	};

	if (!timers) {
		window.setTimeout(cleanup, FOLD_ANIMATION_DURATION_MS);
		return;
	}

	const timer = window.setTimeout(() => {
		timers.delete(timer);
		cleanup();
	}, FOLD_ANIMATION_DURATION_MS);
	timers.add(timer);
}

function collapsePropertiesInView(
	view: MarkdownView,
	timers?: Set<number>,
): void {
	const containers = view.containerEl.querySelectorAll(PROPERTY_CONTAINER_SELECTOR);
	let foundContainer = false;
	let foundExpandedContainer = false;
	let foldedAny = false;

	for (let i = 0; i < containers.length; i++) {
		const container = containers[i];
		if (!(container instanceof HTMLElement)) continue;
		foundContainer = true;
		if (container.classList.contains(COLLAPSED_CLASS)) {
			container.classList.remove(CONTAINER_FOLDING_CLASS);
			continue;
		}
		foundExpandedContainer = true;

		const heading = container.querySelector(PROPERTY_HEADING_SELECTOR);
		if (!(heading instanceof HTMLElement) || !heading.isConnected) continue;

		// Prefer the explicit fold control when present, and fall back to the heading.
		const collapseIndicator = heading.querySelector(".collapse-indicator");
		const toggleTarget = collapseIndicator instanceof HTMLElement ? collapseIndicator : heading;
		container.classList.add(CONTAINER_FOLDING_CLASS);
		toggleTarget.click();
		foldedAny = true;
		scheduleContainerCleanup(container, timers);
	}

	if (foldedAny || (foundContainer && !foundExpandedContainer)) {
		clearViewPendingClass(view);
	}
}

function scheduleCollapseForView(
	plugin: ColumnsPlugin,
	view: MarkdownView,
	timers: Set<number>,
	animationFrames: Set<number>,
): void {
	if (!plugin.settings.foldNotePropertiesByDefault) return;

	view.containerEl.classList.add(VIEW_PENDING_CLASS);

	const pendingResetTimer = window.setTimeout(() => {
		timers.delete(pendingResetTimer);
		clearViewPendingClass(view);
	}, FOLD_PENDING_RESET_DELAY_MS);
	timers.add(pendingResetTimer);

	const frame = window.requestAnimationFrame(() => {
		animationFrames.delete(frame);
		if (!plugin.settings.foldNotePropertiesByDefault) return;
		collapsePropertiesInView(view, timers);
	});
	animationFrames.add(frame);

	for (const delay of FALLBACK_FOLD_ATTEMPT_DELAYS_MS) {
		const timer = window.setTimeout(() => {
			timers.delete(timer);
			if (!plugin.settings.foldNotePropertiesByDefault) return;
			collapsePropertiesInView(view, timers);
		}, delay);
		timers.add(timer);
	}
}

function getMarkdownViewFromLeaf(leaf: WorkspaceLeaf | null): MarkdownView | null {
	if (!leaf) return null;
	return leaf.view instanceof MarkdownView ? leaf.view : null;
}

export function collapsePropertiesInOpenNotes(plugin: ColumnsPlugin): void {
	if (!plugin.settings.foldNotePropertiesByDefault) return;

	const leaves = plugin.app.workspace.getLeavesOfType("markdown");
	for (const leaf of leaves) {
		const view = getMarkdownViewFromLeaf(leaf);
		if (!view) continue;
		view.containerEl.classList.add(VIEW_PENDING_CLASS);
		collapsePropertiesInView(view);
	}
}

export function registerDefaultPropertyFolding(plugin: ColumnsPlugin): () => void {
	const timers = new Set<number>();
	const animationFrames = new Set<number>();

	const scheduleActiveView = () => {
		const view = plugin.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) return;
		scheduleCollapseForView(plugin, view, timers, animationFrames);
	};

	const scheduleLeafView = (leaf: WorkspaceLeaf | null) => {
		const view = getMarkdownViewFromLeaf(leaf);
		if (!view) return;
		scheduleCollapseForView(plugin, view, timers, animationFrames);
	};

	plugin.registerEvent(
		plugin.app.workspace.on("file-open", () => {
			scheduleActiveView();
		}),
	);

	plugin.registerEvent(
		plugin.app.workspace.on("active-leaf-change", (leaf) => {
			scheduleLeafView(leaf);
		}),
	);

	const activeLeaf = plugin.app.workspace.getMostRecentLeaf();
	scheduleLeafView(activeLeaf);

	return () => {
		for (const timer of timers) {
			window.clearTimeout(timer);
		}
		timers.clear();
		for (const frame of animationFrames) {
			window.cancelAnimationFrame(frame);
		}
		animationFrames.clear();

		const leaves = plugin.app.workspace.getLeavesOfType("markdown");
		for (const leaf of leaves) {
			const view = getMarkdownViewFromLeaf(leaf);
			if (!view) continue;
			clearViewPendingClass(view);
			const containers = view.containerEl.querySelectorAll(PROPERTY_CONTAINER_SELECTOR);
			for (let i = 0; i < containers.length; i++) {
				const container = containers[i];
				if (!(container instanceof HTMLElement)) continue;
				container.classList.remove(CONTAINER_FOLDING_CLASS);
			}
		}
	};
}
