import {App, setIcon, TFile} from "obsidian";

interface SuggestItem {
	file: TFile;
	label: string;
	path: string;
	linkText: string;
}

/**
 * Wikilink autocomplete for column editor textareas.
 * Triggers on `[[`, searches vault files, renders a popup near the cursor.
 */
export class ColumnEditorSuggest {
	private textarea: HTMLTextAreaElement;
	private app: App;
	private popup: HTMLElement | null = null;
	private items: SuggestItem[] = [];
	private selectedIndex = 0;
	private triggerStart = -1;

	get active(): boolean {
		return this.popup !== null;
	}

	constructor(textarea: HTMLTextAreaElement, app: App) {
		this.textarea = textarea;
		this.app = app;
	}

	/**
	 * Call from the textarea's keydown handler BEFORE other key handling.
	 * Returns true if the event was consumed (caller should return early).
	 */
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

	/** Call from the textarea's input handler after autoSize. */
	handleInput(): void {
		const query = this.getQuery();
		if (query !== null) {
			const results = this.search(query);
			if (results.length > 0) {
				this.items = results;
				this.selectedIndex = 0;
				this.showPopup();
			} else {
				this.close();
			}
		} else {
			this.close();
		}
	}

	destroy(): void {
		this.close();
	}

	// ── Private ──────────────────────────────────────────────────

	private getQuery(): string | null {
		const value = this.textarea.value;
		const cursor = this.textarea.selectionStart;
		const before = value.substring(0, cursor);

		const idx = before.lastIndexOf("[[");
		if (idx < 0) return null;

		const between = before.substring(idx + 2);
		if (between.includes("]]") || between.includes("\n")) return null;

		this.triggerStart = idx;
		return between;
	}

	private search(query: string): SuggestItem[] {
		const files = this.app.vault.getFiles();
		const lower = query.toLowerCase();
		const sourcePath = this.app.workspace.getActiveFile()?.path ?? "";

		let matches = files.filter((f) => {
			if (lower.length === 0) return true;
			const basename = f.basename.toLowerCase();
			const filename = f.name.toLowerCase();
			const path = f.path.toLowerCase();
			return (
				basename.includes(lower) ||
				filename.includes(lower) ||
				path.includes(lower)
			);
		});

		if (lower.length === 0) {
			// Empty query: sort by recent modification
			matches.sort((a, b) => b.stat.mtime - a.stat.mtime);
		} else {
			// Non-empty: prefer starts-with (basename/name), then alphabetical
			matches.sort((a, b) => {
				const aBaseStarts = a.basename.toLowerCase().startsWith(lower) ? 0 : 1;
				const bBaseStarts = b.basename.toLowerCase().startsWith(lower) ? 0 : 1;
				if (aBaseStarts !== bBaseStarts) return aBaseStarts - bBaseStarts;

				const aNameStarts = a.name.toLowerCase().startsWith(lower) ? 0 : 1;
				const bNameStarts = b.name.toLowerCase().startsWith(lower) ? 0 : 1;
				if (aNameStarts !== bNameStarts) return aNameStarts - bNameStarts;

				return a.basename.localeCompare(b.basename);
			});
		}

		return matches.slice(0, 15).map((f) => {
			const isMarkdown = f.extension.toLowerCase() === "md";
			return {
				file: f,
				label: isMarkdown ? f.basename : f.name,
				path: f.path,
				linkText: this.app.metadataCache.fileToLinktext(f, sourcePath, true),
			};
		});
	}

	private showPopup(): void {
		if (!this.popup) {
			this.popup = document.createElement("div");
			this.popup.className = "columns-suggest-popup";
			this.popup.setAttribute("role", "listbox");
			this.popup.setAttribute("aria-label", "File suggestions");
			document.body.appendChild(this.popup);
		}

		const coords = this.getCursorCoords();
		const lineHeight = parseFloat(window.getComputedStyle(this.textarea).lineHeight) || 20;
		this.popup.style.top = `${coords.top + lineHeight + 2}px`;
		this.popup.style.left = `${coords.left}px`;

		this.popup.empty();
		for (let i = 0; i < this.items.length; i++) {
			const item = this.items[i]!;
			const div = document.createElement("div");
			div.className = "columns-suggest-item" + (i === this.selectedIndex ? " is-selected" : "");
			div.setAttribute("role", "option");
			div.setAttribute("aria-selected", String(i === this.selectedIndex));

			const title = document.createElement("span");
			title.className = "columns-suggest-title";
			title.textContent = item.label;

			const pathSpan = document.createElement("span");
			pathSpan.className = "columns-suggest-path";
			pathSpan.textContent = item.path;

			div.appendChild(title);
			div.appendChild(pathSpan);

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

		// Keep popup in viewport
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
		if (!item) return;

		const value = this.textarea.value;
		const cursor = this.textarea.selectionStart;
		const before = value.substring(0, this.triggerStart);
		// Skip over any existing ]] left by auto-pair
		let after = value.substring(cursor);
		if (after.startsWith("]]")) after = after.substring(2);
		const insert = `[[${item.linkText}]]`;

		this.textarea.value = before + insert + after;
		const newCursor = before.length + insert.length;
		this.textarea.selectionStart = newCursor;
		this.textarea.selectionEnd = newCursor;

		this.close();
		this.textarea.dispatchEvent(new Event("input", {bubbles: true}));
	}

	private close(): void {
		if (this.popup) {
			this.popup.remove();
			this.popup = null;
		}
		this.items = [];
	}

	/**
	 * Measure cursor position in the textarea using a mirror div.
	 */
	private getCursorCoords(): {top: number; left: number} {
		const ta = this.textarea;
		const mirror = document.createElement("div");
		const computed = window.getComputedStyle(ta);

		const props = [
			"font-family",
			"font-size",
			"font-weight",
			"font-style",
			"letter-spacing",
			"word-spacing",
			"text-indent",
			"text-transform",
			"line-height",
			"padding-top",
			"padding-right",
			"padding-bottom",
			"padding-left",
			"border-top-width",
			"border-right-width",
			"border-bottom-width",
			"border-left-width",
			"box-sizing",
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

// ═══════════════════════════════════════════════════════════════════════

interface SlashCommand {
	id: string;
	label: string;
	icon: string;
	description: string;
	insert: string;
	cursorOffset?: number;
}

const SLASH_COMMANDS: SlashCommand[] = [
	{id: "h1", label: "Heading 1", icon: "heading-1", description: "Large heading", insert: "# ", cursorOffset: 0},
	{id: "h2", label: "Heading 2", icon: "heading-2", description: "Medium heading", insert: "## ", cursorOffset: 0},
	{id: "h3", label: "Heading 3", icon: "heading-3", description: "Small heading", insert: "### ", cursorOffset: 0},
	{id: "bullet", label: "Bulleted list", icon: "list", description: "Unordered list item", insert: "- ", cursorOffset: 0},
	{id: "number", label: "Numbered list", icon: "list-ordered", description: "Ordered list item", insert: "1. ", cursorOffset: 0},
	{id: "task", label: "Task", icon: "check-square", description: "Checkbox item", insert: "- [ ] ", cursorOffset: 0},
	{id: "quote", label: "Blockquote", icon: "quote", description: "Block quotation", insert: "> ", cursorOffset: 0},
	{id: "code", label: "Code block", icon: "code", description: "Fenced code block", insert: "```\n\n```", cursorOffset: 4},
	{id: "callout", label: "Callout", icon: "message-square", description: "Callout block", insert: "> [!note]\n> ", cursorOffset: 0},
	{id: "table", label: "Table", icon: "table", description: "Markdown table", insert: "| Col 1 | Col 2 |\n| --- | --- |\n|  |  |", cursorOffset: 5},
	{id: "divider", label: "Divider", icon: "minus", description: "Horizontal rule", insert: "---", cursorOffset: 0},
	{id: "math", label: "Math block", icon: "sigma", description: "LaTeX math block", insert: "$$\n\n$$", cursorOffset: 3},
	{id: "image", label: "Image embed", icon: "image", description: "Embed image", insert: "![[]]", cursorOffset: 2},
];

/**
 * Slash command autocomplete for column editor textareas.
 * Triggers on `/` at start of line or after whitespace.
 */
export class SlashCommandSuggest {
	private textarea: HTMLTextAreaElement;
	private popup: HTMLElement | null = null;
	private items: SlashCommand[] = [];
	private selectedIndex = 0;
	private triggerStart = -1;

	get active(): boolean {
		return this.popup !== null;
	}

	constructor(textarea: HTMLTextAreaElement) {
		this.textarea = textarea;
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
		const query = this.getQuery();
		if (query !== null) {
			const results = this.search(query);
			if (results.length > 0) {
				this.items = results;
				this.selectedIndex = 0;
				this.showPopup();
			} else {
				this.close();
			}
		} else {
			this.close();
		}
	}

	destroy(): void {
		this.close();
	}

	// ── Private ──────────────────────────────────────────────────

	private getQuery(): string | null {
		const value = this.textarea.value;
		const cursor = this.textarea.selectionStart;
		const before = value.substring(0, cursor);

		// Find the last `/` before cursor
		const idx = before.lastIndexOf("/");
		if (idx < 0) return null;

		// Only trigger at start of text or after whitespace/newline
		if (idx > 0) {
			const preceding = before[idx - 1]!;
			if (preceding !== " " && preceding !== "\t" && preceding !== "\n") return null;
		}

		const between = before.substring(idx + 1);
		// No spaces or newlines in slash query
		if (between.includes(" ") || between.includes("\n")) return null;

		this.triggerStart = idx;
		return between;
	}

	private search(query: string): SlashCommand[] {
		const lower = query.toLowerCase();
		if (lower.length === 0) return SLASH_COMMANDS;

		return SLASH_COMMANDS.filter((cmd) =>
			cmd.label.toLowerCase().includes(lower) ||
			cmd.id.toLowerCase().includes(lower) ||
			cmd.description.toLowerCase().includes(lower),
		);
	}

	private showPopup(): void {
		if (!this.popup) {
			this.popup = document.createElement("div");
			this.popup.className = "columns-suggest-popup";
			this.popup.setAttribute("role", "listbox");
			this.popup.setAttribute("aria-label", "Slash commands");
			document.body.appendChild(this.popup);
		}

		const coords = this.getCursorCoords();
		const lineHeight = parseFloat(window.getComputedStyle(this.textarea).lineHeight) || 20;
		this.popup.style.top = `${coords.top + lineHeight + 2}px`;
		this.popup.style.left = `${coords.left}px`;

		this.popup.empty();
		for (let i = 0; i < this.items.length; i++) {
			const item = this.items[i]!;
			const div = document.createElement("div");
			div.className = "columns-suggest-item" + (i === this.selectedIndex ? " is-selected" : "");
			div.setAttribute("role", "option");
			div.setAttribute("aria-selected", String(i === this.selectedIndex));

			const iconSpan = document.createElement("span");
			iconSpan.className = "columns-suggest-icon";
			setIcon(iconSpan, item.icon);

			const textWrap = document.createElement("span");
			textWrap.className = "columns-suggest-text";

			const title = document.createElement("span");
			title.className = "columns-suggest-title";
			title.textContent = item.label;

			const desc = document.createElement("span");
			desc.className = "columns-suggest-path";
			desc.textContent = item.description;

			textWrap.appendChild(title);
			textWrap.appendChild(desc);
			div.appendChild(iconSpan);
			div.appendChild(textWrap);

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
		if (!item) return;

		const value = this.textarea.value;
		const cursor = this.textarea.selectionStart;
		const before = value.substring(0, this.triggerStart);
		const after = value.substring(cursor);

		this.textarea.value = before + item.insert + after;
		const endPos = before.length + item.insert.length;
		const newCursor = endPos - (item.cursorOffset ?? 0);
		this.textarea.selectionStart = newCursor;
		this.textarea.selectionEnd = newCursor;

		this.close();
		this.textarea.dispatchEvent(new Event("input", {bubbles: true}));
	}

	private close(): void {
		if (this.popup) {
			this.popup.remove();
			this.popup = null;
		}
		this.items = [];
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

// ═══════════════════════════════════════════════════════════════════════

/**
 * Handle `[[` auto-close and `]` skip-over.
 * Call from keydown BEFORE other handlers.
 * Returns true if the event was consumed.
 */
export function handleAutoPair(e: KeyboardEvent, textarea: HTMLTextAreaElement): boolean {
	const cursor = textarea.selectionStart;
	const value = textarea.value;

	// Auto-close [[ → [[|]]
	if (e.key === "[" && cursor > 0 && value[cursor - 1] === "[") {
		if (value.substring(cursor, cursor + 2) === "]]") return false; // already closed
		e.preventDefault();
		const before = value.substring(0, cursor);
		const after = value.substring(cursor);
		textarea.value = before + "[]]" + after;
		textarea.selectionStart = cursor + 1;
		textarea.selectionEnd = cursor + 1;
		textarea.dispatchEvent(new Event("input", {bubbles: true}));
		return true;
	}

	// Skip over ] when cursor is at ]]
	if (e.key === "]" && value[cursor] === "]") {
		e.preventDefault();
		textarea.selectionStart = cursor + 1;
		textarea.selectionEnd = cursor + 1;
		return true;
	}

	// Backspace inside empty [[|]] → delete both pairs
	if (
		e.key === "Backspace" &&
		cursor >= 2 &&
		value[cursor - 1] === "[" &&
		value[cursor - 2] === "[" &&
		value.substring(cursor, cursor + 2) === "]]"
	) {
		e.preventDefault();
		textarea.value = value.substring(0, cursor - 2) + value.substring(cursor + 2);
		textarea.selectionStart = cursor - 2;
		textarea.selectionEnd = cursor - 2;
		textarea.dispatchEvent(new Event("input", {bubbles: true}));
		return true;
	}

	return false;
}

// ═══════════════════════════════════════════════════════════════════════

/**
 * Handle Ctrl+B (bold), Ctrl+I (italic) markdown shortcuts.
 * Returns true if the event was consumed.
 */
export function handleMarkdownShortcut(e: KeyboardEvent, textarea: HTMLTextAreaElement): boolean {
	const isMod = e.ctrlKey || e.metaKey;
	if (!isMod) return false;

	let wrapper: string | null = null;
	if (e.key === "b") wrapper = "**";
	else if (e.key === "i") wrapper = "*";

	if (!wrapper) return false;

	e.preventDefault();

	const start = textarea.selectionStart;
	const end = textarea.selectionEnd;
	const value = textarea.value;
	const selected = value.substring(start, end);

	// Toggle: if already wrapped, remove the wrapper
	const wLen = wrapper.length;
	const beforeW = value.substring(Math.max(0, start - wLen), start);
	const afterW = value.substring(end, end + wLen);
	if (beforeW === wrapper && afterW === wrapper) {
		textarea.value = value.substring(0, start - wLen) + selected + value.substring(end + wLen);
		textarea.selectionStart = start - wLen;
		textarea.selectionEnd = end - wLen;
		textarea.dispatchEvent(new Event("input", {bubbles: true}));
		return true;
	}

	// Wrap selection
	const replacement = wrapper + selected + wrapper;
	textarea.value = value.substring(0, start) + replacement + value.substring(end);

	if (selected.length > 0) {
		textarea.selectionStart = start + wLen;
		textarea.selectionEnd = end + wLen;
	} else {
		textarea.selectionStart = start + wLen;
		textarea.selectionEnd = start + wLen;
	}

	textarea.dispatchEvent(new Event("input", {bubbles: true}));
	return true;
}
