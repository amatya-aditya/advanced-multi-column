import {Keymap, Menu} from "obsidian";
import type {App, HoverParent, MarkdownView, PaneType} from "obsidian";

/**
 * Reading view: Obsidian handles clicks, hovers, drags and context menus on
 * links, tags and images with listeners on the note's sizer. The column
 * layer is not inside the sizer, so these mirror Obsidian's handlers for
 * the layer. Links inside an embedded note are left alone: the embed has
 * its own handlers, as in Obsidian's view.
 */

/** Obsidian internals used by its own handlers; each one is optional. */
interface InternalApp {
	dragManager?: {
		dragLink?: (evt: DragEvent, linktext: string, sourcePath: string, title?: string) => unknown;
		onDragStart?: (evt: DragEvent, dragData: unknown) => void;
	};
	internalPlugins?: {
		getEnabledPluginById?: (id: string) => {openGlobalSearch?: (query: string) => void} | null;
	};
	workspace: {handleExternalLinkContextMenu?: (menu: Menu, url: string) => void};
}

interface InternalMenu {
	addSections?: (sections: string[]) => void;
}

interface InternalRenderer {
	previewEl: HTMLElement;
	handleMediaClick?: (evt: MouseEvent, el: HTMLElement) => void;
}

const LINK_MENU_SECTIONS = ["title", "open", "action", "clipboard", "view", "info", "", "danger"];
const EXTERNAL_MENU_SECTIONS = ["title", "open", "selection", "clipboard", "info", "action", "view", "", "danger"];

/** The element `selector` matches at the event target, if the layer (not an embed inside it) owns it. */
function ownTarget(evt: Event, root: HTMLElement, selector: string): HTMLElement | null {
	const el = (evt.target as HTMLElement | null)?.closest<HTMLElement>(selector);
	if (!el || !root.contains(el)) return null;
	for (let node: HTMLElement | null = el; node && node !== root; node = node.parentElement) {
		if (node.classList.contains("markdown-preview-view") || node.classList.contains("bases-view")) return null;
	}
	return el;
}

function linkHref(link: HTMLElement): string | null {
	return link.getAttr("data-href") || link.getAttr("href");
}

/** Obsidian's translations, for the label of its own menu item. */
const i18n = (window as unknown as {i18next?: {t: (key: string) => string}}).i18next;

function addCopyItem(menu: Menu, el: HTMLElement): void {
	menu.addItem((item) => item
		.setSection("clipboard")
		.setTitle(i18n?.t("interface.menu.copy") ?? "Copy")
		.setIcon("lucide-copy")
		.onClick(() => void navigator.clipboard.writeText(el.getText())));
}

function linkMenu(evt: MouseEvent, sections: string[]): Menu {
	const menu = Menu.forEvent(evt);
	(menu as unknown as InternalMenu).addSections?.(sections);
	return menu;
}

/** The reading view whose layer contains `root`. */
function rendererOf(app: App, root: HTMLElement): InternalRenderer | null {
	for (const leaf of app.workspace.getLeavesOfType("markdown")) {
		const preview = (leaf.view as MarkdownView).previewMode as unknown as {renderer?: InternalRenderer} | undefined;
		const renderer = preview?.renderer;
		if (renderer?.previewEl?.contains(root)) return renderer;
	}
	return null;
}

export function wireReadingLinkEvents(root: HTMLElement, app: App, sourcePath: string): void {
	const internal = app as unknown as InternalApp;
	const hoverParent: HoverParent = {hoverPopover: null};

	const onLinkClick = (evt: MouseEvent): void => {
		if (evt.button !== 0 && evt.button !== 1) return;
		const link = ownTarget(evt, root, "a.internal-link");
		const href = link && linkHref(link);
		if (!href) return;
		evt.preventDefault();
		void app.workspace.openLinkText(href, sourcePath, Keymap.isModEvent(evt));
	};
	root.addEventListener("click", onLinkClick);
	root.addEventListener("auxclick", onLinkClick);

	root.addEventListener("mouseover", (evt) => {
		const link = ownTarget(evt, root, "a.internal-link");
		const href = link && linkHref(link);
		if (!href) return;
		app.workspace.trigger("hover-link", {
			event: evt,
			source: "preview",
			hoverParent,
			targetEl: link,
			linktext: href,
			sourcePath,
		});
	});

	root.addEventListener("dragstart", (evt) => {
		const link = ownTarget(evt, root, "a.internal-link");
		const href = link && linkHref(link);
		const drag = internal.dragManager;
		if (!href || !drag?.dragLink || !drag.onDragStart) return;
		drag.onDragStart(evt, drag.dragLink(evt, href, sourcePath, link.getText().trim()));
	});

	root.addEventListener("click", (evt) => {
		if (evt.button !== 0 && evt.button !== 1) return;
		const link = ownTarget(evt, root, "a.external-link");
		const href = link?.getAttr("href");
		if (!href) return;
		evt.preventDefault();
		const mod: PaneType | boolean = Keymap.isModEvent(evt);
		window.open(href, typeof mod === "boolean" ? "" : mod);
	});

	root.addEventListener("click", (evt) => {
		if (evt.button !== 0) return;
		const tag = ownTarget(evt, root, "a.tag");
		if (!tag) return;
		evt.preventDefault();
		internal.internalPlugins?.getEnabledPluginById?.("global-search")?.openGlobalSearch?.("tag:" + tag.getText());
	});

	// Images open Obsidian's image viewer, showing every image of the layer.
	const onMedia = (evt: MouseEvent): void => {
		if (evt.defaultPrevented) return;
		const media = ownTarget(evt, root, "img, video");
		if (!media) return;
		const renderer = rendererOf(app, root);
		renderer?.handleMediaClick?.call({sections: [{el: root}]}, evt, media);
	};
	root.addEventListener("click", onMedia);
	root.addEventListener("contextmenu", onMedia);

	root.addEventListener("contextmenu", (evt) => {
		const link = ownTarget(evt, root, "a.internal-link");
		const href = link && linkHref(link);
		if (href) {
			const menu = linkMenu(evt, LINK_MENU_SECTIONS);
			menu.setParentElement(link);
			addCopyItem(menu, link);
			app.workspace.handleLinkContextMenu(menu, href, sourcePath);
			return;
		}
		const external = ownTarget(evt, root, "a.external-link");
		const url = external?.getAttr("href");
		if (external && url && internal.workspace.handleExternalLinkContextMenu) {
			const menu = linkMenu(evt, EXTERNAL_MENU_SECTIONS);
			addCopyItem(menu, external);
			internal.workspace.handleExternalLinkContextMenu(menu, url);
			return;
		}
		// Obsidian shows its viewport menu for right-clicks outside the
		// sizer; in the note's text it shows none.
		evt.preventDefault();
	});
}
