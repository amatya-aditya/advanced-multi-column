import {EditorView} from "@codemirror/view";
import {Notice} from "obsidian";
import {getPluginInstance} from "../core/plugin-ref";
import {ColumnEditorSuggest, SlashCommandSuggest, handleAutoPair, handleMarkdownShortcut} from "./editor-suggest";
import {getInteractionState} from "./interaction-state";
import {
	isInteractivePreviewTarget,
	isBlockLanguagePreviewTarget,
} from "../core/widget-types";

// ── Auto-size textarea ──────────────────────────────────────

export function autoSize(ta: HTMLTextAreaElement): void {
	ta.setCssProps({"--column-editor-height": "0px"});
	ta.setCssProps({"--column-editor-height": Math.max(60, ta.scrollHeight) + "px"});
}

// ── Image paste handling ────────────────────────────────────

export async function handleImagePaste(
	blob: File,
	mimeType: string,
	textarea: HTMLTextAreaElement,
): Promise<void> {
	try {
		const plugin = getPluginInstance();
		const ext = mimeType === "image/jpeg" ? "jpg" : (mimeType.split("/")[1] ?? "png");
		const fileName = `pasted-image-${Date.now()}.${ext}`;
		const activeFile = plugin.app.workspace.getActiveFile();
		const folder = activeFile?.parent?.path ?? "";
		const fullPath = folder ? `${folder}/${fileName}` : fileName;

		const buf = await blob.arrayBuffer();
		const created = await plugin.app.vault.createBinary(fullPath, buf);

		const link = `![[${created.name}]]`;
		const start = textarea.selectionStart;
		const end = textarea.selectionEnd;
		const value = textarea.value;
		textarea.value = value.substring(0, start) + link + value.substring(end);
		textarea.selectionStart = start + link.length;
		textarea.selectionEnd = start + link.length;
		textarea.dispatchEvent(new Event("input", {bubbles: true}));
	} catch {
		new Notice("Failed to paste image");
	}
}

// ── Restore edit state ──────────────────────────────────────

export function restoreEditState(textarea: HTMLTextAreaElement, view: EditorView): void {
	const saved = getInteractionState(view).activeEdit!;
	const colEl = textarea.parentElement!;
	colEl.classList.add("is-editing");
	textarea.value = saved.value;
	autoSize(textarea);

	requestAnimationFrame(() => {
		textarea.focus();
		textarea.selectionStart = saved.cursorStart;
		textarea.selectionEnd = saved.cursorEnd;
		textarea.scrollTop = saved.scrollTop;
	});
}

// ── Shared edit wiring config ───────────────────────────────

export interface EditWireConfig {
	container: HTMLElement;
	previewEl: HTMLElement;
	textarea: HTMLTextAreaElement;
	suggest: ColumnEditorSuggest;
	slashSuggest: Pick<SlashCommandSuggest, "active" | "handleKeydown" | "handleInput">;
	getContent: () => string;
	onCommit: (nextContent: string) => void;
	/** Called when entering edit mode, before focus. For top-level columns. */
	onEnterEdit?: () => void;
	/** Called when committing and closing. For top-level columns. */
	onCommitClose?: () => void;
	/**
	 * Extra keydown handler after suggest/autopair/markdown shortcuts.
	 * Return true if handled.
	 */
	onKeydown?: (e: KeyboardEvent) => boolean;
	/** Guard for click events on preview. Return true to block entering edit. */
	clickGuard?: (target: HTMLElement) => boolean;
	/** Delay in ms for blur timeout (default: 180) */
	blurDelay?: number;
}

/**
 * Unified edit toggle wiring for both top-level and nested column editors.
 * Handles: click-to-edit, keyboard (Escape, Tab), blur commit, image paste,
 * auto-pair, markdown shortcuts, and suggest integration.
 */
export function wireEditCore(config: EditWireConfig): void {
	const {
		container,
		previewEl,
		textarea,
		suggest,
		slashSuggest,
		getContent,
		onCommit,
		onEnterEdit,
		onCommitClose,
		onKeydown,
		clickGuard,
		blurDelay = 180,
	} = config;

	const enterEdit = () => {
		// Commit and close other open editors in this container
		container.querySelectorAll<HTMLElement>(".column-item.is-editing").forEach((el) => {
			if (el !== textarea.parentElement) {
				const otherTextarea = el.querySelector<HTMLTextAreaElement>("textarea");
				if (otherTextarea) {
					// Dispatch a custom event so the other editor's commit logic runs
					otherTextarea.dispatchEvent(new CustomEvent("amc-force-commit", {bubbles: false}));
				}
				el.classList.remove("is-editing");
			}
		});

		const colEl = textarea.parentElement!;
		colEl.classList.add("is-editing");
		textarea.value = getContent();
		autoSize(textarea);

		onEnterEdit?.();

		requestAnimationFrame(() => {
			textarea.focus();
			textarea.selectionStart = textarea.value.length;
			textarea.selectionEnd = textarea.value.length;
		});
	};

	const commitAndClose = () => {
		const colEl = textarea.parentElement!;
		colEl.classList.remove("is-editing");
		const nextValue = textarea.value;

		onCommitClose?.();

		if (nextValue !== getContent()) {
			onCommit(nextValue);
		}
	};

	// Click preview → edit
	previewEl.addEventListener("click", (e) => {
		const target = e.target as HTMLElement;
		if (clickGuard?.(target)) return;
		if (isInteractivePreviewTarget(target, previewEl)) return;
		e.preventDefault();
		e.stopPropagation();
		enterEdit();
	});

	previewEl.addEventListener("dblclick", (e) => {
		const target = e.target as HTMLElement;
		if (clickGuard?.(target)) return;
		if (!isBlockLanguagePreviewTarget(target, previewEl)) return;
		e.preventDefault();
		e.stopPropagation();
		enterEdit();
	});

	// Keyboard
	textarea.addEventListener("keydown", (e) => {
		e.stopPropagation();
		if (suggest.handleKeydown(e)) return;
		if (slashSuggest.handleKeydown(e)) return;
		if (handleAutoPair(e, textarea)) return;
		if (handleMarkdownShortcut(e, textarea)) return;

		if (onKeydown?.(e)) return;

		if (e.key === "Escape") {
			commitAndClose();
			return;
		}
	});

	textarea.addEventListener("input", (e) => {
		e.stopPropagation();
		autoSize(textarea);
		suggest.handleInput();
		if (!suggest.active) slashSuggest.handleInput();
	});

	// Force-commit: triggered by another editor opening in the same container
	textarea.addEventListener("amc-force-commit", () => {
		if (textarea.parentElement?.classList.contains("is-editing")) {
			const nextValue = textarea.value;
			onCommitClose?.();
			if (nextValue !== getContent()) {
				onCommit(nextValue);
			}
		}
	});

	// Blur: commit once focus leaves this column editor
	textarea.addEventListener("blur", () => {
		setTimeout(() => {
			if (suggest.active || slashSuggest.active) return;
			const currentItem = textarea.parentElement;
			if (currentItem?.contains(document.activeElement)) return;
			if (textarea.parentElement?.classList.contains("is-editing")) {
				commitAndClose();
			}
		}, blurDelay);
	});

	// Image paste
	textarea.addEventListener("paste", (e: ClipboardEvent) => {
		e.stopPropagation();
		const items = e.clipboardData?.items;
		if (!items) return;

		for (const item of Array.from(items)) {
			if (!item.type.startsWith("image/")) continue;
			e.preventDefault();
			const blob = item.getAsFile();
			if (!blob) return;
			void handleImagePaste(blob, item.type, textarea);
			return;
		}
	});

	for (const evt of ["cut", "copy"] as const) {
		textarea.addEventListener(evt, (e) => e.stopPropagation());
	}
}
