import {Component} from "obsidian";
import type {EditorView} from "@codemirror/view";
import type {ViewUpdate} from "@codemirror/view";
import {
	createEmbeddedEditor,
	EmbeddedEditorHandle,
	InternalMarkdownEditor,
} from "./embedded-editor";
import {createPastedImageLink} from "./column-editor";
import {getInteractionState} from "./interaction-state";
import {
	isBlockLanguagePreviewTarget,
	isInteractivePreviewTarget,
} from "../core/widget-types";

/**
 * Click-to-edit wiring for the embedded live-preview editor. Mirrors the
 * legacy textarea wiring in column-editor.ts: click on the preview opens the
 * editor, Escape/blur commits and closes, and other open editors in the same
 * container are force-committed when a new one opens.
 */

const LIST_LINE_RE = /^(\s*)([-*+]( \[.\])?|\d+\.)\s/;

export interface LiveEditRestoreState {
	value: string;
	cursorStart: number;
	cursorEnd: number;
}

export interface LiveEditConfig {
	/** Columns container used to force-commit sibling editors. */
	container: HTMLElement;
	/** Element that receives the `is-editing` class and hosts the editor. */
	hostEl: HTMLElement;
	previewEl: HTMLElement;
	/** Widget component registry; open editors are destroyed on rebuild. */
	components: Component[];
	getContent: () => string;
	onCommit: (nextContent: string) => void;
	/** Guard for click events on preview. Return true to block entering edit. */
	clickGuard?: (target: HTMLElement) => boolean;
	/** Delay in ms for blur commit (default: 180). */
	blurDelay?: number;
	/** Top-level columns: persist edit state across widget rebuilds. */
	editState?: {view: EditorView; regionFrom: number; columnIndex: number};
	/** Top-level columns: Tab outside a list navigates to a sibling column. */
	onNavigate?: (dir: 1 | -1) => void;
}

export interface LiveEditHandle {
	enterEdit(restore?: LiveEditRestoreState): void;
}

function handleEditorImagePaste(e: ClipboardEvent, editor: InternalMarkdownEditor): boolean {
	const items = e.clipboardData?.items;
	if (!items) return false;

	for (const item of Array.from(items)) {
		if (!item.type.startsWith("image/")) continue;
		e.preventDefault();
		const blob = item.getAsFile();
		if (blob) {
			void createPastedImageLink(blob, item.type).then((link) => {
				if (link) editor.editor.replaceSelection(link);
			});
		}
		return true;
	}
	return false;
}

export function wireLivePreviewEdit(config: LiveEditConfig): LiveEditHandle {
	const {blurDelay = 180} = config;
	let active: EmbeddedEditorHandle | null = null;

	const clearEditState = () => {
		if (!config.editState) return;
		const {view, regionFrom, columnIndex} = config.editState;
		const iState = getInteractionState(view);
		if (
			iState.activeEdit
			&& iState.activeEdit.regionFrom === regionFrom
			&& iState.activeEdit.columnIndex === columnIndex
		) {
			iState.activeEdit = null;
		}
	};

	const commitAndClose = () => {
		const handle = active;
		if (!handle) return;
		active = null;
		const nextValue = handle.value;
		handle.destroy();
		config.hostEl.classList.remove("is-editing");
		clearEditState();
		if (nextValue !== config.getContent()) {
			config.onCommit(nextValue);
		}
	};

	const trackChange = config.editState
		? (update: ViewUpdate) => {
			const {view, regionFrom, columnIndex} = config.editState!;
			const st = getInteractionState(view).activeEdit;
			if (st && st.regionFrom === regionFrom && st.columnIndex === columnIndex) {
				st.value = update.state.doc.toString();
				const sel = update.state.selection.main;
				st.cursorStart = sel.from;
				st.cursorEnd = sel.to;
			}
		}
		: undefined;

	const enterEdit = (restore?: LiveEditRestoreState) => {
		if (active) return;

		const value = restore?.value ?? config.getContent();

		// Register the edit state before force-committing siblings: a dirty
		// sibling commit dispatches a document change that synchronously
		// rebuilds the widget DOM, and the rebuild re-opens this editor from
		// the interaction state.
		if (config.editState) {
			const {view, regionFrom, columnIndex} = config.editState;
			getInteractionState(view).activeEdit = {
				regionFrom,
				columnIndex,
				cursorStart: restore?.cursorStart ?? value.length,
				cursorEnd: restore?.cursorEnd ?? value.length,
				scrollTop: 0,
				value,
			};
		}

		// Commit and close other open editors in this container.
		config.container.querySelectorAll<HTMLElement>(".is-editing").forEach((el) => {
			if (el !== config.hostEl) {
				el.dispatchEvent(new CustomEvent("amc-force-commit", {bubbles: false}));
			}
		});

		// A sibling commit rebuilt the widget: this wiring now points at
		// detached DOM, and the rebuilt widget already restored the editor.
		if (!config.hostEl.isConnected) return;

		config.hostEl.classList.add("is-editing");

		const handle = createEmbeddedEditor(config.hostEl, {
			value,
			placeholder: "Type here",
			onEscape: () => commitAndClose(),
			onBlur: () => {
				config.hostEl.win.setTimeout(() => {
					if (!active) return;
					if (config.hostEl.contains(config.hostEl.doc.activeElement)) return;
					commitAndClose();
				}, blurDelay);
			},
			onChange: trackChange,
			onPaste: handleEditorImagePaste,
			onTab: config.onNavigate
				? (shift) => {
					const current = active;
					if (!current) return false;
					const state = current.editor.cm.state;
					const line = state.doc.lineAt(state.selection.main.head).text;
					// Let the editor indent/unindent list items natively.
					if (LIST_LINE_RE.test(line)) return false;
					commitAndClose();
					config.onNavigate!(shift ? -1 : 1);
					return true;
				}
				: undefined,
		});

		if (!handle) {
			config.hostEl.classList.remove("is-editing");
			clearEditState();
			return;
		}
		active = handle;

		// Destroy the editor when the widget is rebuilt or destroyed.
		const holder = new Component();
		holder.register(() => handle.destroy());
		holder.load();
		config.components.push(holder);

		handle.setSelection(
			restore?.cursorStart ?? value.length,
			restore?.cursorEnd ?? value.length,
		);
		requestAnimationFrame(() => {
			if (active === handle) handle.focus();
		});
	};

	// Force-commit: triggered by another editor opening in the same container.
	config.hostEl.addEventListener("amc-force-commit", () => commitAndClose());

	// Click preview → edit
	config.previewEl.addEventListener("click", (e) => {
		const target = e.target as HTMLElement;
		if (config.clickGuard?.(target)) return;
		if (isInteractivePreviewTarget(target, config.previewEl)) return;
		e.preventDefault();
		e.stopPropagation();
		enterEdit();
	});

	config.previewEl.addEventListener("dblclick", (e) => {
		const target = e.target as HTMLElement;
		if (config.clickGuard?.(target)) return;
		if (!isBlockLanguagePreviewTarget(target, config.previewEl)) return;
		e.preventDefault();
		e.stopPropagation();
		enterEdit();
	});

	return {enterEdit};
}
