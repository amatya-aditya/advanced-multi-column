import {EditorView} from "@codemirror/view";
import {HoverPopover, MarkdownRenderer} from "obsidian";
import type {App, HoverParent} from "obsidian";
import {definitionPlaceholder, mayHaveFootnotes, normalizeFootnoteLabel, NoteFootnotes} from "../core/footnotes";
import type {DefinitionBlock, PieceFootnotes} from "../core/footnotes";
import type {RenderContext} from "./column-renderer";

/**
 * DOM side of note-wide footnotes (see core/footnotes.ts): renumber the
 * references a piece rendered, drop the per-piece footnote list, and — in
 * reading view, where the plugin renders the whole note — build the note's
 * footnote list and the jumps between references and the list.
 */

const NUMBER_ATTR = "data-amc-footnote";
/** Every footnote link this module handled. */
const REF_ATTR = "data-amc-footref";
/** Live Preview: label of a `[^label]` reference. */
const LABEL_ATTR = "data-amc-footnote-label";
const HOVER_DELAY_MS = 300;

/** Footnote markdown shown when a handled reference is hovered. */
const footnoteMarkdown = new WeakMap<HTMLElement, string>();
const DEFINITION_ATTR = "data-amc-footnote-def";
const FLASH_MS = 3000;

/**
 * Fix up the footnote references a rendered piece contains and remove the
 * footnote list the renderer appended to the piece.
 *
 * - `reading`: references show their note-wide number, as in Obsidian's
 *   reading view; the note's list is built by buildFootnoteSection.
 * - `live`: references show their source, `[^label]` or `^[text]`, as
 *   Obsidian's Live Preview editor does.
 */
export function applyNoteFootnotes(
	el: HTMLElement,
	model: NoteFootnotes,
	piece: PieceFootnotes,
	mode: "reading" | "live",
): void {
	// Text of the piece's own footnotes, by id: the fallback for an inline
	// footnote that could not be located in the note.
	const localText = new Map<string, string>();
	el.querySelectorAll("section.footnotes").forEach((section) => {
		section.querySelectorAll<HTMLElement>("li[data-footnote-id]").forEach((li) => {
			localText.set(li.dataset.footnoteId!, li.textContent?.replace("↩︎", "").trim() ?? "");
		});
		section.remove();
	});

	let inlineIndex = 0;
	el.querySelectorAll<HTMLElement>("sup.footnote-ref").forEach((sup) => {
		const link = sup.querySelector<HTMLAnchorElement>("a.footnote-link");
		if (!link) return;
		const ref = link.dataset.footref ?? "";
		const isInline = ref.startsWith("[inline");
		const number = isInline ? piece.inlineNumbers[inlineIndex++] : model.numberOf(ref);
		const inlineText = isInline
			? (number !== undefined ? model.list[number - 1]?.markdown : undefined)
				?? localText.get(link.getAttr("href")?.slice(1) ?? "") ?? ""
			: "";

		link.setAttr(REF_ATTR, "");
		// Obsidian's own hover looks `#[^label]` up in its index, which has
		// no inline footnotes and misses a definition right above `---`;
		// wireFootnoteHover previews the parsed footnote instead.
		delete link.dataset.footref;
		const markdown = isInline ? inlineText : model.definitions.get(normalizeFootnoteLabel(ref))?.markdown;
		if (markdown) footnoteMarkdown.set(link, markdown);

		if (mode === "live") {
			link.setAttr("href", "#");
			link.empty();
			link.createSpan({cls: "amc-footref-mark", text: isInline ? "^[" : "[^"});
			link.createSpan({text: isInline ? inlineText : ref});
			link.createSpan({cls: "amc-footref-mark", text: "]"});
			sup.addClass("amc-footref-source");
			if (!isInline) link.setAttr(LABEL_ATTR, ref);
			return;
		}

		if (number === undefined) return;
		link.setText(`[${number}]`);
		link.setAttr("href", `#amc-fn-${number}`);
		link.setAttr(NUMBER_ATTR, String(number));
	});
}

/**
 * Reading view: append the note's footnote list. `render` renders one
 * footnote's markdown into the given element.
 */
export function buildFootnoteSection(
	parent: HTMLElement,
	model: NoteFootnotes,
	render: (el: HTMLElement, markdown: string) => Promise<unknown>,
): Promise<unknown>[] {
	if (model.isEmpty) return [];
	const section = parent.createEl("section", {cls: "footnotes amc-footnotes"});
	section.createEl("hr");
	const list = section.createEl("ol");
	const tasks: Promise<unknown>[] = [];
	for (const footnote of model.list) {
		const item = list.createEl("li", {attr: {[DEFINITION_ATTR]: String(footnote.number), dir: "auto"}});
		item.value = footnote.number;
		const backref = createEl("a", {
			cls: "footnote-backref footnote-link",
			text: "↩︎",
			attr: {href: `#amc-fnref-${footnote.number}`, [NUMBER_ATTR]: String(footnote.number), "data-amc-backref": ""},
		});
		tasks.push(render(item, footnote.markdown).then(() => {
			const last = item.lastElementChild;
			(last instanceof HTMLParagraphElement ? last : item).appendChild(backref);
		}));
	}
	return tasks;
}

function flash(el: HTMLElement): void {
	el.doc.querySelectorAll(".amc-footnote-target.is-flashing").forEach((other) => other.removeClass("is-flashing"));
	el.addClass("amc-footnote-target", "is-flashing");
	el.win.setTimeout(() => el.removeClass("is-flashing"), FLASH_MS);
}

/** Hovering a footnote reference previews the footnote. */
export function wireFootnoteHover(root: HTMLElement, app: App, sourcePath: string): void {
	const hoverParent: HoverParent = {hoverPopover: null};
	root.addEventListener("mouseover", (evt) => {
		const link = (evt.target as HTMLElement).closest<HTMLElement>(`a.footnote-link[${REF_ATTR}]`);
		if (!link || link.contains(evt.relatedTarget as Node | null)) return;
		const markdown = footnoteMarkdown.get(link);
		if (!markdown) return;
		const popover = new HoverPopover(hoverParent, link, HOVER_DELAY_MS);
		const content = popover.hoverEl.createDiv({cls: "markdown-preview-view markdown-rendered amc-footnote-popover"});
		void MarkdownRenderer.render(app, markdown, content, sourcePath, popover);
	});
}

/**
 * Reading view: clicking a reference scrolls to its footnote, the
 * footnote's ↩︎ scrolls back to the first reference, and hovering a
 * reference previews the footnote. Obsidian's own handlers ignore the
 * column layer because it is not one of the note's rendered sections.
 */
export function wireReadingFootnotes(root: HTMLElement, app: App, sourcePath: string): void {
	wireFootnoteHover(root, app, sourcePath);

	root.addEventListener("click", (evt) => {
		const link = (evt.target as HTMLElement).closest<HTMLElement>(`a.footnote-link[${NUMBER_ATTR}]`);
		if (!link || evt.button !== 0) return;
		evt.preventDefault();
		evt.stopPropagation();
		const number = link.getAttr(NUMBER_ATTR);
		const target = link.hasAttribute("data-amc-backref")
			? root.querySelector<HTMLElement>(`sup.footnote-ref > a[${NUMBER_ATTR}="${number}"]`)?.parentElement ?? null
			: root.querySelector<HTMLElement>(`li[${DEFINITION_ATTR}="${number}"]`);
		if (!target) return;
		target.scrollIntoView({block: "center"});
		flash(target);
	});
}


// ── Live Preview ────────────────────────────────────────────

const livePreviewModels = new WeakMap<RenderContext, NoteFootnotes | null>();

/** The note's footnotes for a Live Preview column block (one per widget). */
export function livePreviewFootnotes(ctx: RenderContext): NoteFootnotes | null {
	if (livePreviewModels.has(ctx)) return livePreviewModels.get(ctx)!;
	const model = mayHaveFootnotes(ctx.source)
		? NoteFootnotes.parse(ctx.view.state.doc.toString(), ctx.region.from)
		: null;
	livePreviewModels.set(ctx, model);
	return model;
}

/**
 * Live Preview: show the footnote definitions a column contains where they
 * are written, as the editor does (label, then the text). Swaps each
 * placeholder paragraph left by extractFootnoteDefinitions for the rendered
 * definition. `render` renders one definition's markdown into an element.
 */
export function renderLiveFootnoteDefinitions(
	el: HTMLElement,
	definitions: DefinitionBlock[],
	render: (target: HTMLElement, markdown: string) => Promise<unknown>,
): Promise<unknown>[] {
	if (definitions.length === 0) return [];
	const placeholders = new Map<string, HTMLElement>();
	el.querySelectorAll<HTMLElement>("p").forEach((p) => placeholders.set(p.textContent?.trim() ?? "", p));
	const tasks: Promise<unknown>[] = [];
	definitions.forEach((definition, index) => {
		const placeholder = placeholders.get(definitionPlaceholder(index));
		if (!placeholder) return;
		const item = createDiv({cls: "amc-footnote-def", attr: {dir: "auto"}});
		item.createEl("sup", {cls: "amc-footnote-def-label", text: definition.label});
		const body = item.createDiv({cls: "amc-footnote-def-body"});
		placeholder.replaceWith(item);
		tasks.push(render(body, definition.markdown));
	});
	return tasks;
}

/**
 * Live Preview: hovering a reference in a column previews the footnote.
 * There is no footnote list, so clicking a `[^label]` reference moves the
 * editor to the footnote's definition instead.
 */
export function wireLivePreviewFootnotes(
	container: HTMLElement,
	view: EditorView,
	app: App,
	sourcePath: string,
): void {
	wireFootnoteHover(container, app, sourcePath);
	container.addEventListener("click", (evt) => {
		const link = (evt.target as HTMLElement).closest<HTMLElement>(`a.footnote-link[${REF_ATTR}]`);
		if (!link) return;
		evt.preventDefault();
		evt.stopPropagation();
		const label = link.getAttr(LABEL_ATTR);
		if (!label) return;
		// Read the note now: the block may have moved since it was rendered.
		const pos = NoteFootnotes.parse(view.state.doc.toString())?.definitions.get(normalizeFootnoteLabel(label))?.from;
		if (pos === undefined) return;
		view.dispatch({
			selection: {anchor: pos},
			effects: EditorView.scrollIntoView(pos, {y: "center"}),
		});
		view.focus();
	});
}
