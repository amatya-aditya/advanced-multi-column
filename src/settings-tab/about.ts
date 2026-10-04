import type {Setting} from "obsidian";
import type ColumnsPlugin from "../main";

/** About card: version, project links and other plugins. */
export function renderAbout(setting: Setting, plugin: ColumnsPlugin): void {
	setting.settingEl.empty();
	setting.settingEl.addClass("columns-settings-about-item");
	const aboutEl = setting.settingEl.createDiv({cls: "columns-settings-about"});

	const infoEl = aboutEl.createDiv({cls: "columns-settings-about-info"});
	infoEl.createDiv({text: "Advanced multi column", cls: "columns-settings-about-name"});
	infoEl.createDiv({text: `v${plugin.manifest.version}`, cls: "columns-settings-about-version"});

	const linksEl = aboutEl.createDiv({cls: "columns-settings-about-links"});
	addLink(linksEl, "GitHub", "https://github.com/amatya-aditya/advanced-multi-column");
	addLink(linksEl, "Report Issue", "https://github.com/amatya-aditya/advanced-multi-column/issues");
	addLink(linksEl, "Discord", "https://discord.gg/9bu7V9BBbs");

	addLinkSection(aboutEl, "Support development", [
		["Buy Me a Coffee", "https://www.buymeacoffee.com/amatya_aditya"],
		["Ko-fi", "https://ko-fi.com/Y8Y41FV4WI"],
	]);
	addLinkSection(aboutEl, "Other plugins", [
		["RSS Dashboard", "https://github.com/amatya-aditya/obsidian-rss-dashboard"],
		["Media Slider", "https://github.com/amatya-aditya/obsidian-media-slider"],
		["Zen Space", "https://github.com/amatya-aditya/obsidian-zen-space"],
	]);
}

function addLinkSection(parent: HTMLElement, label: string, links: Array<[string, string]>): void {
	const sectionEl = parent.createDiv({cls: "columns-settings-about-support"});
	sectionEl.createDiv({text: label, cls: "columns-settings-about-support-label"});
	const linksEl = sectionEl.createDiv({cls: "columns-settings-about-links"});
	for (const [text, url] of links) addLink(linksEl, text, url);
}

function addLink(parent: HTMLElement, label: string, url: string): void {
	parent.createEl("a", {
		text: label,
		cls: "columns-settings-about-link",
		href: url,
		attr: {target: "_blank", rel: "noopener"},
	});
}
