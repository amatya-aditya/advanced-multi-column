import {App, Component, Editor, editorInfoField, MarkdownView, Modal, TFile} from "obsidian";
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
import {rebaseDraft} from "./draft-rebase";
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
	/** Column text `value` was edited from; defaults to `value`. */
	base?: string;
	/** Take focus at once (the editor being replaced had it). */
	focus?: boolean;
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

export const EDIT_KEY_ATTR = "data-amc-edit-key";
/** Asks an open column editor to commit and close. */
export const FORCE_COMMIT_EVENT = "amc-force-commit";
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

/** Offset of `block` in `data` when it occurs exactly once, else -1. */
function uniqueIndexOf(data: string, block: string): number {
	const at = data.indexOf(block);
	return at >= 0 && data.indexOf(block, at + 1) < 0 ? at : -1;
}

/**
 * Editor of a pane that still shows the note, if any: preferably the pane the
 * column editor belonged to, so that pane's own save includes the draft.
 */
function openEditorFor(app: App, sourcePath: string, preferred: EditorView): Editor | null {
	let found: Editor | null = null;
	for (const leaf of app.workspace.getLeavesOfType("markdown")) {
		const view = leaf.view;
		if (!(view instanceof MarkdownView) || view.file?.path !== sourcePath) continue;
		const cm = (view.editor as Editor & {cm?: EditorView}).cm;
		if (cm === preferred) return view.editor;
		found ??= view.editor;
	}
	return found;
}

/**
 * Save a column draft whose editor was destroyed before it could commit (the
 * tab switched notes or closed, or the block was rebuilt). Only replaces the
 * block when its original text is still present exactly once.
 *
 * While another pane shows the note, the draft goes into that pane's editor:
 * Obsidian keeps the panes in sync and saves it. Writing the file underneath
 * an open editor lost the draft when that editor saved its own text over it,
 * or duplicated text when Obsidian merged the change back into the editor.
 */
async function saveDraftToFile(
	app: App,
	sourcePath: string,
	ownView: EditorView,
	oldBlock: string,
	newBlock: string,
	draft: string,
): Promise<void> {
	const editor = openEditorFor(app, sourcePath, ownView);
	if (editor) {
		const at = uniqueIndexOf(editor.getValue(), oldBlock);
		if (at < 0) {
			new UnsavedDraftModal(app, draft).open();
			return;
		}
		editor.replaceRange(newBlock, editor.offsetToPos(at), editor.offsetToPos(at + oldBlock.length));
		return;
	}

	const file = app.vault.getAbstractFileByPath(sourcePath);
	if (!(file instanceof TFile)) return;
	let saved = false;
	await app.vault.process(file, (data) => {
		const at = uniqueIndexOf(data, oldBlock);
		if (at < 0) return data;
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

	/** Commit shortly after the editor loses focus, unless the focus comes back. */
	const scheduleBlurCommit = () => {
		const blurredHandle = active;
		if (!blurredHandle) return;
		clearBlurTimer();
		blurTimer = config.hostEl.win.setTimeout(() => {
			blurTimer = null;
			if (active !== blurredHandle) return;
			if (config.hostEl.contains(config.hostEl.doc.activeElement)) return;
			commitAndClose();
		}, blurDelay);
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
				base: target.value,
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
		const base = restore?.base ?? value;

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
			base,
			owner,
		};

		if (!restoring) {
			// Commit and close other open editors in this container.
			config.container.querySelectorAll<HTMLElement>(".is-editing").forEach((el) => {
				if (el !== config.hostEl) {
					el.dispatchEvent(new CustomEvent(FORCE_COMMIT_EVENT, {bubbles: false}));
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
			onBlur: () => scheduleBlurCommit(),
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
				// A blur starts the commit timer, so none pending means the
				// user was still typing here.
				const focused = blurTimer === null;
				clearBlurTimer();
				config.hostEl.classList.remove("is-editing");
				const draft = handle.value;
				const st = getInteractionState(editState.view).activeEdit;
				if (st?.owner === owner) st.orphaned = true;
				// A rebuilt widget claims the state before CodeMirror destroys
				// this one, so check the slot rather than the owner.
				if (st && st.key === editState.key && st.filePath === sourcePath) st.focused = focused;
				// Compute the block text now, while the render closures still
				// describe this block; it is only written if no rebuilt widget
				// re-opens the draft (e.g. the tab switched to another note).
				// An untouched draft is never written: the column may have
				// changed since (another pane), and it would undo that change.
				const rescuedBlock = draft !== base && draft !== config.getContent()
					? captureBlockUpdate(() => config.onCommit(draft))
					: null;
				queueMicrotask(() => {
					const claimed = !!st && st.owner !== owner;
					clearEditState();
					if (claimed || rescuedBlock === null) return;
					void saveDraftToFile(app, sourcePath, editState.view, editState.regionSource, rescuedBlock, draft);
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
		// An editor re-opened after a rebuild while the user was typing in it
		// takes focus at once: until it does, keys typed into the column go to
		// the note's own editor.
		if (restore?.focus) handle.focus();
		// The user had already left this editor (its blur commit was pending
		// when the widget was rebuilt): finish that commit, and don't take the
		// focus back from where they went.
		if (restoring && restore?.focus === false) {
			scheduleBlurCommit();
			return;
		}
		window.requestAnimationFrame(() => {
			if (active === handle) handle.focus();
		});
	};

	const restorePending = () => {
		if (active) return;
		const st = getInteractionState(editState.view).activeEdit;
		if (!matchesEditState(st, editState, sourcePath)) return;
		const restore = {value: st.value, cursorStart: st.cursorStart, cursorEnd: st.cursorEnd};
		// The block was rebuilt because the note changed; if this column's text
		// changed too, a stale draft would overwrite it on commit.
		if (st.base === undefined) {
			enterEdit({...restore, focus: st.focused}, true);
			return;
		}
		const current = config.getContent();
		enterEdit({...rebaseDraft(restore, st.base, current), base: current, focus: st.focused}, true);
	};

	// Force-commit: triggered by another editor opening in the same container.
	config.hostEl.addEventListener(FORCE_COMMIT_EVENT, () => commitAndClose());
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
