import type {App, Editor, EditorPosition, EditorRange, EditorSelection, EditorSelectionOrCaret, EditorSuggest, EditorSuggestContext, EditorSuggestTriggerInfo, EditorTransaction} from "obsidian";

// ── Textarea → Editor adapter ───────────────────────────────

/**
 * Minimal Editor adapter that wraps a textarea, providing the subset of
 * the Obsidian Editor API that EditorSuggest plugins typically use
 * (getLine, getCursor, replaceRange, etc.).
 */
class TextareaEditorAdapter {
	constructor(private textarea: HTMLTextAreaElement) {}

	getValue(): string {
		return this.textarea.value;
	}

	setValue(content: string): void {
		this.textarea.value = content;
	}

	getLine(n: number): string {
		return this.textarea.value.split("\n")[n] ?? "";
	}

	lineCount(): number {
		return this.textarea.value.split("\n").length;
	}

	lastLine(): number {
		return this.lineCount() - 1;
	}

	getSelection(): string {
		return this.textarea.value.substring(
			this.textarea.selectionStart,
			this.textarea.selectionEnd,
		);
	}

	somethingSelected(): boolean {
		return this.textarea.selectionStart !== this.textarea.selectionEnd;
	}

	getCursor(_side?: "from" | "to" | "head" | "anchor"): EditorPosition {
		return this.offsetToPos(this.textarea.selectionStart);
	}

	listSelections(): EditorSelection[] {
		const anchor = this.offsetToPos(this.textarea.selectionStart);
		const head = this.offsetToPos(this.textarea.selectionEnd);
		return [{anchor, head}];
	}

	setCursor(pos: EditorPosition | number, ch?: number): void {
		const p = typeof pos === "number" ? {line: pos, ch: ch ?? 0} : pos;
		const offset = this.posToOffset(p);
		this.textarea.selectionStart = offset;
		this.textarea.selectionEnd = offset;
	}

	setSelection(anchor: EditorPosition, head?: EditorPosition): void {
		this.textarea.selectionStart = this.posToOffset(anchor);
		this.textarea.selectionEnd = this.posToOffset(head ?? anchor);
	}

	setSelections(_ranges: EditorSelectionOrCaret[], _main?: number): void {
		// Textarea supports only a single selection
	}

	getRange(from: EditorPosition, to: EditorPosition): string {
		const f = this.posToOffset(from);
		const t = this.posToOffset(to);
		return this.textarea.value.substring(f, t);
	}

	replaceSelection(replacement: string): void {
		const start = this.textarea.selectionStart;
		const end = this.textarea.selectionEnd;
		const v = this.textarea.value;
		this.textarea.value = v.substring(0, start) + replacement + v.substring(end);
		const nc = start + replacement.length;
		this.textarea.selectionStart = nc;
		this.textarea.selectionEnd = nc;
	}

	replaceRange(replacement: string, from: EditorPosition, to?: EditorPosition): void {
		const fromOffset = this.posToOffset(from);
		const toOffset = to ? this.posToOffset(to) : fromOffset;
		const v = this.textarea.value;
		this.textarea.value = v.substring(0, fromOffset) + replacement + v.substring(toOffset);
		const nc = fromOffset + replacement.length;
		this.textarea.selectionStart = nc;
		this.textarea.selectionEnd = nc;
	}

	posToOffset(pos: EditorPosition): number {
		const lines = this.textarea.value.split("\n");
		let offset = 0;
		for (let i = 0; i < pos.line && i < lines.length; i++) {
			offset += lines[i]!.length + 1; // +1 for newline
		}
		return offset + Math.min(pos.ch, (lines[pos.line] ?? "").length);
	}

	offsetToPos(offset: number): EditorPosition {
		const text = this.textarea.value.substring(0, offset);
		const lines = text.split("\n");
		return {line: lines.length - 1, ch: lines[lines.length - 1]!.length};
	}

	focus(): void {
		this.textarea.focus();
	}

	blur(): void {
		this.textarea.blur();
	}

	hasFocus(): boolean {
		return document.activeElement === this.textarea;
	}

	getScrollInfo(): {top: number; left: number} {
		return {top: this.textarea.scrollTop, left: this.textarea.scrollLeft};
	}

	scrollTo(x?: number | null, y?: number | null): void {
		if (x != null) this.textarea.scrollLeft = x;
		if (y != null) this.textarea.scrollTop = y;
	}

	scrollIntoView(_range: EditorRange, _center?: boolean): void {
		// no-op for textarea
	}

	refresh(): void {}
	undo(): void {}
	redo(): void {}
	exec(_command: string): void {}
	transaction(_tx: EditorTransaction): void {}
	wordAt(_pos: EditorPosition): EditorRange | null {
		return null;
	}

	setLine(n: number, text: string): void {
		const lines = this.textarea.value.split("\n");
		if (n >= 0 && n < lines.length) {
			lines[n] = text;
			this.textarea.value = lines.join("\n");
		}
	}
}

// ── Third-party suggest bridge ──────────────────────────────

/**
 * Bridges Obsidian's EditorSuggest plugins (e.g. Iconize) to work inside
 * column editor textareas. On each input event, it checks all registered
 * EditorSuggest instances via their onTrigger method, fetches suggestions,
 * and renders them in a popup. Selection delegates to the plugin's own
 * selectSuggestion method using a TextareaEditorAdapter.
 */
export class ThirdPartySuggestBridge {
	private textarea: HTMLTextAreaElement;
	private app: App;
	private adapter: TextareaEditorAdapter;
	private popup: HTMLElement | null = null;
	private items: unknown[] = [];
	private activeSuggest: EditorSuggest<unknown> | null = null;
	private triggerInfo: EditorSuggestTriggerInfo | null = null;
	private selectedIndex = 0;

	get active(): boolean {
		return this.popup !== null;
	}

	constructor(textarea: HTMLTextAreaElement, app: App) {
		this.textarea = textarea;
		this.app = app;
		this.adapter = new TextareaEditorAdapter(textarea);
	}

	handleKeydown(e: KeyboardEvent): boolean {
		if (!this.active) return false;

		switch (e.key) {
			case "ArrowDown":
				e.preventDefault();
				this.selectedIndex = (this.selectedIndex + 1) % this.items.length;
				this.renderSelection();
				return true;
			case "ArrowUp":
				e.preventDefault();
				this.selectedIndex = (this.selectedIndex - 1 + this.items.length) % this.items.length;
				this.renderSelection();
				return true;
			case "Enter":
				e.preventDefault();
				this.selectItem(this.selectedIndex);
				return true;
			case "Escape":
				e.preventDefault();
				this.close();
				return true;
			default:
				return false;
		}
	}

	handleInput(): void {
		const suggests = this.getRegisteredSuggests();
		if (suggests.length === 0) {
			this.close();
			return;
		}

		const cursor = this.adapter.getCursor();
		const file = this.app.workspace.getActiveFile();

		for (const suggest of suggests) {
			let trigger: EditorSuggestTriggerInfo | null = null;
			try {
				trigger = suggest.onTrigger(cursor, this.adapter as unknown as Editor, file);
			} catch {
				continue;
			}
			if (!trigger) continue;

			this.activeSuggest = suggest;
			this.triggerInfo = trigger;

			const context: EditorSuggestContext = {
				...trigger,
				editor: this.adapter as unknown as Editor,
				file: file!,
			};

			try {
				const results = suggest.getSuggestions(context);
				if (results instanceof Promise) {
					results.then(
						(items) => this.showItems(items),
						() => this.close(),
					);
				} else {
					this.showItems(results);
				}
			} catch {
				this.close();
			}
			return;
		}

		this.close();
	}

	destroy(): void {
		this.close();
	}

	// ── Private ──────────────────────────────────────────────────

	private getRegisteredSuggests(): EditorSuggest<unknown>[] {
		// Obsidian stores registered EditorSuggest instances internally
		const ws = this.app.workspace as unknown as Record<string, Record<string, unknown>>;
		const suggests = ws["editorSuggest"]?.["suggests"];
		return (Array.isArray(suggests) ? suggests : []) as EditorSuggest<unknown>[];
	}

	private showItems(items: unknown[]): void {
		if (!items || items.length === 0) {
			this.close();
			return;
		}
		this.items = items;
		this.selectedIndex = 0;
		this.showPopup();
	}

	private showPopup(): void {
		if (!this.popup) {
			this.popup = document.createElement("div");
			this.popup.className = "columns-suggest-popup";
			this.popup.setAttribute("role", "listbox");
			this.popup.setAttribute("aria-label", "Suggestions");
			document.body.appendChild(this.popup);
		}

		const coords = this.getCursorCoords();
		const lineHeight = parseFloat(window.getComputedStyle(this.textarea).lineHeight) || 20;
		this.popup.style.top = `${coords.top + lineHeight + 2}px`;
		this.popup.style.left = `${coords.left}px`;

		this.popup.empty();
		const limit = Math.min(this.items.length, this.activeSuggest?.limit ?? 50);
		for (let i = 0; i < limit; i++) {
			const item = this.items[i]!;
			const div = document.createElement("div");
			div.className = "columns-suggest-item" + (i === this.selectedIndex ? " is-selected" : "");
			div.setAttribute("role", "option");
			div.setAttribute("aria-selected", String(i === this.selectedIndex));

			// Delegate rendering to the third-party suggest plugin
			try {
				this.activeSuggest!.renderSuggestion(item, div);
			} catch {
				div.textContent = "Suggestion";
			}

			div.addEventListener("mousedown", (e) => {
				e.preventDefault();
				e.stopPropagation();
				this.selectItem(i);
			});

			div.addEventListener("mouseenter", () => {
				this.selectedIndex = i;
				this.renderSelection();
			});

			this.popup.appendChild(div);
		}

		requestAnimationFrame(() => {
			if (!this.popup) return;
			const rect = this.popup.getBoundingClientRect();
			if (rect.bottom > window.innerHeight) {
				this.popup.style.top = `${coords.top - rect.height - 4}px`;
			}
			if (rect.right > window.innerWidth) {
				this.popup.style.left = `${window.innerWidth - rect.width - 8}px`;
			}
		});
	}

	private renderSelection(): void {
		if (!this.popup) return;
		const children = this.popup.querySelectorAll(".columns-suggest-item");
		children.forEach((el, i) => {
			const selected = i === this.selectedIndex;
			el.classList.toggle("is-selected", selected);
			el.setAttribute("aria-selected", String(selected));
		});
		const selected = this.popup.querySelector(".is-selected");
		if (selected) selected.scrollIntoView({block: "nearest"});
	}

	private selectItem(index: number): void {
		const item = this.items[index];
		if (!item || !this.activeSuggest || !this.triggerInfo) return;

		// Set context on the suggest so selectSuggestion can access it
		this.activeSuggest.context = {
			...this.triggerInfo,
			editor: this.adapter as unknown as Editor,
			file: this.app.workspace.getActiveFile()!,
		};

		try {
			this.activeSuggest.selectSuggestion(item, new MouseEvent("click"));
		} catch {
			// If selectSuggestion fails, fall back to no-op
		}

		this.close();
		this.textarea.dispatchEvent(new Event("input", {bubbles: true}));
	}

	private close(): void {
		if (this.popup) {
			this.popup.remove();
			this.popup = null;
		}
		this.items = [];
		this.activeSuggest = null;
		this.triggerInfo = null;
	}

	private getCursorCoords(): {top: number; left: number} {
		const ta = this.textarea;
		const mirror = document.createElement("div");
		const computed = window.getComputedStyle(ta);

		const props = [
			"font-family", "font-size", "font-weight", "font-style",
			"letter-spacing", "word-spacing", "text-indent", "text-transform",
			"line-height", "padding-top", "padding-right", "padding-bottom",
			"padding-left", "border-top-width", "border-right-width",
			"border-bottom-width", "border-left-width", "box-sizing",
		];
		for (const prop of props) {
			mirror.style.setProperty(prop, computed.getPropertyValue(prop));
		}

		mirror.className = "columns-cursor-mirror";
		mirror.setCssProps({"--mirror-width": computed.width});

		const textBefore = ta.value.substring(0, ta.selectionStart);
		const textNode = document.createTextNode(textBefore);
		mirror.appendChild(textNode);

		const marker = document.createElement("span");
		marker.textContent = "\u200b";
		mirror.appendChild(marker);

		document.body.appendChild(mirror);

		const taRect = ta.getBoundingClientRect();
		const markerRect = marker.getBoundingClientRect();
		const mirrorRect = mirror.getBoundingClientRect();

		document.body.removeChild(mirror);

		return {
			top: taRect.top + (markerRect.top - mirrorRect.top) - ta.scrollTop,
			left: taRect.left + (markerRect.left - mirrorRect.left) - ta.scrollLeft,
		};
	}
}
