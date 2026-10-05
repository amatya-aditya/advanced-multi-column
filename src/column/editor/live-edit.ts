import {App, Component, editorInfoField, Modal, TFile} from "obsidian";
import {captureBlockUpdate} from "../core/column-serializer";
import {getPluginInstance} from "../core/plugin-ref";
import type {EditorView} from "@codemirror/view";
import type {ViewUpdate} from "@codemirror/view";
import type {ColumnRegion} from "../core/types";
import type {ActiveEditState} from "../core/widget-types";
import {refreshRegionPosition} from "../core/region-position";
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

/** Identifies one editor slot so a rebuilt widget can re-open it. */
export interface LiveEditState {
	view: EditorView;
	/** Live region; `from` is refreshed before it is compared. */
	region: ColumnRegion;
	/** Source text of the block when it was rendered. */
	regionSource: string;
	key: string;
}

export interface LiveEditNavigationTarget {
	key: string;
	value: string;
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
	/** Persist edit state across widget rebuilds. */
	editState: LiveEditState;
	/** Tab outside a list moves to the sibling editor this returns. */
	onNavigate?: (dir: 1 | -1) => LiveEditNavigationTarget | null;
}

export interface LiveEditHandle {
	enterEdit(restore?: LiveEditRestoreState): void;
}

const EDIT_KEY_ATTR = "data-amc-edit-key";
const RESTORE_EVENT = "amc-restore-edit";

function matchesEditState(
	st: ActiveEditState | null,
	editState: LiveEditState,
	filePath: string,
): st is ActiveEditState {
	if (!st || st.key !== editState.key || st.filePath !== filePath) return false;
	refreshRegionPosition(editState.region);
	if (st.regionFrom === editState.region.from) return true;
	// A whole-file reload invalidates offsets; then fall back to identical
	// source — but only for a draft whose editor was destroyed, so an open
	// editor is never duplicated into an identical block elsewhere.
	return !!st.orphaned && st.regionSource === editState.regionSource;
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

/**
 * Write a column draft straight into the note when its editor was destroyed
 * before it could commit (the tab switched notes or closed). Only replaces the
 * block when its original text is still present exactly once.
 */
async function saveDraftToFile(
	app: App,
	sourcePath: string,
	oldBlock: string,
	newBlock: string,
	draft: string,
): Promise<void> {
	const file = app.vault.getAbstractFileByPath(sourcePath);
	if (!(file instanceof TFile)) return;
	let saved = false;
	await app.vault.process(file, (data) => {
		const at = data.indexOf(oldBlock);
		if (at < 0 || data.indexOf(oldBlock, at + 1) >= 0) return data;
		saved = true;
		return data.slice(0, at) + newBlock + data.slice(at + oldBlock.length);
	});
	if (!saved) new UnsavedDraftModal(app, draft).open();
}

/** Shows a column edit that could not be saved, so it can be copied by hand. */
class UnsavedDraftModal extends Modal {
	constructor(app: App, private readonly draft: string) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText("Column edit not saved");
		this.contentEl.createEl("p", {
			text: "The note changed before this column edit could be saved. Copy the text below and paste it back into the column.",
		});
		const text = this.contentEl.createEl("textarea", {cls: "amc-unsaved-draft"});
		text.value = this.draft;
		text.readOnly = true;
		text.rows = 10;
		window.setTimeout(() => text.select(), 0);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

export function wireLivePreviewEdit(config: LiveEditConfig): LiveEditHandle {
	const {blurDelay = 180, editState} = config;
	const owner = {};
	let active: EmbeddedEditorHandle | null = null;
	let blurTimer: number | null = null;

	config.hostEl.setAttribute(EDIT_KEY_ATTR, editState.key);
	const sourcePath = editState.view.state.field(editorInfoField, false)?.file?.path ?? "";
	const app = getPluginInstance().app;

	const clearBlurTimer = () => {
		if (blurTimer === null) return;
		config.hostEl.win.clearTimeout(blurTimer);
		blurTimer = null;
	};

	const clearEditState = () => {
		const iState = getInteractionState(editState.view);
		if (iState.activeEdit?.owner === owner) iState.activeEdit = null;
	};

	const commitAndClose = () => {
		const handle = active;
		if (!handle) return;
		clearBlurTimer();
		active = null;
		const nextValue = handle.value;
		handle.destroy();
		config.hostEl.classList.remove("is-editing");
		clearEditState();
		if (nextValue !== config.getContent()) {
			config.onCommit(nextValue);
		}
	};

	const trackChange = (update: ViewUpdate) => {
		const st = getInteractionState(editState.view).activeEdit;
		if (st?.owner !== owner) return;
		st.value = update.state.doc.toString();
		const sel = update.state.selection.main;
		st.cursorStart = sel.from;
		st.cursorEnd = sel.to;
	};

	const navigate = (dir: 1 | -1): boolean => {
		const target = config.onNavigate?.(dir) ?? null;
		const container = config.container;
		if (target) {
			// Register the sibling first: if this commit rebuilds the widget,
			// the rebuilt sibling editor re-opens from this state.
			refreshRegionPosition(editState.region);
			getInteractionState(editState.view).activeEdit = {
				filePath: sourcePath,
				regionFrom: editState.region.from,
				regionSource: editState.regionSource,
				key: target.key,
				cursorStart: target.value.length,
				cursorEnd: target.value.length,
				scrollTop: 0,
				value: target.value,
			};
		}
		commitAndClose();
		if (!target || !container.isConnected) return true;
		// No rebuild happened: open the sibling in the current DOM.
		const sibling = container.querySelector<HTMLElement>(
			`[${EDIT_KEY_ATTR}="${CSS.escape(target.key)}"]`,
		);
		sibling?.dispatchEvent(new CustomEvent(RESTORE_EVENT));
		return true;
	};

	const enterEdit = (restore?: LiveEditRestoreState, restoring = false) => {
		if (active) return;

		const value = restore?.value ?? config.getContent();

		// Register the edit state before force-committing siblings: a dirty
		// sibling commit dispatches a document change that synchronously
		// rebuilds the widget DOM, and the rebuild re-opens this editor from
		// the interaction state.
		refreshRegionPosition(editState.region);
		getInteractionState(editState.view).activeEdit = {
			filePath: sourcePath,
			regionFrom: editState.region.from,
			regionSource: editState.regionSource,
			key: editState.key,
			cursorStart: restore?.cursorStart ?? value.length,
			cursorEnd: restore?.cursorEnd ?? value.length,
			scrollTop: 0,
			value,
			owner,
		};

		if (!restoring) {
			// Commit and close other open editors in this container.
			config.container.querySelectorAll<HTMLElement>(".is-editing").forEach((el) => {
				if (el !== config.hostEl) {
					el.dispatchEvent(new CustomEvent("amc-force-commit", {bubbles: false}));
				}
			});
		}

		// A sibling commit rebuilt the widget: this wiring now points at
		// detached DOM, and the rebuilt widget re-opens the editor itself.
		if (!config.hostEl.isConnected) return;

		config.hostEl.classList.add("is-editing");

		const handle = createEmbeddedEditor(config.hostEl, {
			value,
			placeholder: "Type here",
			sourcePath,
			onEscape: () => commitAndClose(),
			onBlur: () => {
				const blurredHandle = active;
				if (!blurredHandle) return;
				clearBlurTimer();
				blurTimer = config.hostEl.win.setTimeout(() => {
					blurTimer = null;
					if (active !== blurredHandle) return;
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
					return navigate(shift ? -1 : 1);
				}
				: undefined,
		});

		if (!handle) {
			config.hostEl.classList.remove("is-editing");
			clearEditState();
			return;
		}
		active = handle;

		// Destroy the editor when the widget is rebuilt or destroyed. The edit
		// state survives so the rebuilt widget can re-open the editor with the
		// unsaved text; if nothing claims it, drop it so a stale draft can never
		// be restored into an unrelated block later.
		const holder = new Component();
		holder.register(() => {
			if (active === handle) {
				active = null;
				clearBlurTimer();
				config.hostEl.classList.remove("is-editing");
				const draft = handle.value;
				const st = getInteractionState(editState.view).activeEdit;
				if (st?.owner === owner) st.orphaned = true;
				// Compute the block text now, while the render closures still
				// describe this block; it is only written if no rebuilt widget
				// re-opens the draft (e.g. the tab switched to another note).
				const rescuedBlock = draft !== config.getContent()
					? captureBlockUpdate(() => config.onCommit(draft))
					: null;
				queueMicrotask(() => {
					const claimed = !!st && st.owner !== owner;
					clearEditState();
					if (claimed || rescuedBlock === null) return;
					void saveDraftToFile(app, sourcePath, editState.regionSource, rescuedBlock, draft);
				});
			}
			handle.destroy();
		});
		holder.load();
		config.components.push(holder);

		handle.setSelection(
			restore?.cursorStart ?? value.length,
			restore?.cursorEnd ?? value.length,
		);
		window.requestAnimationFrame(() => {
			if (active === handle) handle.focus();
		});
	};

	const restorePending = () => {
		if (active) return;
		const st = getInteractionState(editState.view).activeEdit;
		if (!matchesEditState(st, editState, sourcePath)) return;
		enterEdit({value: st.value, cursorStart: st.cursorStart, cursorEnd: st.cursorEnd}, true);
	};

	// Force-commit: triggered by another editor opening in the same container.
	config.hostEl.addEventListener("amc-force-commit", () => commitAndClose());
	config.hostEl.addEventListener(RESTORE_EVENT, () => restorePending());

	// Re-open an editor that was open when the widget was rebuilt. Claim the
	// state now (synchronously, inside the rebuild) and open it once the new
	// DOM is attached.
	const pending = getInteractionState(editState.view).activeEdit;
	if (matchesEditState(pending, editState, sourcePath)) {
		pending.owner = owner;
		pending.orphaned = false;
		queueMicrotask(() => {
			if (config.hostEl.isConnected) {
				restorePending();
				return;
			}
			window.requestAnimationFrame(() => {
				if (config.hostEl.isConnected) restorePending();
				else clearEditState();
			});
		});
	}

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

	return {enterEdit: (restore) => enterEdit(restore)};
}
