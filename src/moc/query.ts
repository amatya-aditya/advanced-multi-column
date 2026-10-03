import {App, CachedMetadata, getAllTags, TFile} from "obsidian";
import type {MocTemplate} from "./types";

export interface MocGroup {
	name: string;
	files: TFile[];
}

function normalizeFolder(folder: string): string {
	return folder.trim().replace(/^\/+|\/+$/g, "");
}

function normalizeTag(tag: string): string {
	return tag.trim().replace(/^#/, "").toLowerCase();
}

function fileTags(cache: CachedMetadata | null): string[] {
	if (!cache) return [];
	return (getAllTags(cache) ?? []).map(normalizeTag);
}

function hasTag(tags: ReadonlyArray<string>, wanted: string): boolean {
	return tags.some((tag) => tag === wanted || tag.startsWith(`${wanted}/`));
}

/** Property values as comparable strings (links lose their brackets). */
function propertyValues(cache: CachedMetadata | null, key: string): string[] {
	const raw: unknown = cache?.frontmatter?.[key];
	if (raw === undefined || raw === null || raw === "") return [];
	const list: unknown[] = Array.isArray(raw) ? raw : [raw];
	return list
		.filter((v) => v !== null && v !== undefined && v !== "")
		.map((v) => (typeof v === "object" ? JSON.stringify(v) : String(v as string | number | boolean))
			.replace(/^\[\[|\]\]$/g, "")
			.trim());
}

function inFolder(file: TFile, folder: string, includeSubfolders: boolean): boolean {
	const parent = file.parent?.path ?? "/";
	const parentPath = parent === "/" ? "" : parent;
	if (folder === "") return includeSubfolders || parentPath === "";
	return parentPath === folder || (includeSubfolders && parentPath.startsWith(`${folder}/`));
}

/** Notes selected by the template's sources, excluding the MOC note itself. */
export function queryMocFiles(app: App, template: MocTemplate, excludePath?: string): TFile[] {
	const checks: Array<(file: TFile, cache: CachedMetadata | null) => boolean> = [];

	if (template.folder.trim() !== "") {
		const folder = normalizeFolder(template.folder);
		checks.push((file) => inFolder(file, folder, template.includeSubfolders));
	}
	for (const tag of template.tags.map(normalizeTag).filter(Boolean)) {
		checks.push((_file, cache) => hasTag(fileTags(cache), tag));
	}
	for (const filter of template.properties) {
		const key = filter.key.trim();
		if (!key) continue;
		const wanted = filter.value.trim().toLowerCase();
		checks.push((_file, cache) => {
			const values = propertyValues(cache, key);
			if (wanted === "") return values.length > 0;
			return values.some((v) => v.toLowerCase() === wanted);
		});
	}
	if (checks.length === 0) return [];

	const every = template.match === "all";
	return app.vault.getMarkdownFiles().filter((file) => {
		if (file.path === excludePath) return false;
		const cache = app.metadataCache.getFileCache(file);
		return every
			? checks.every((check) => check(file, cache))
			: checks.some((check) => check(file, cache));
	});
}

function groupKeys(app: App, template: MocTemplate, file: TFile): string[] {
	switch (template.groupBy) {
		case "none":
			return [""];
		case "subfolder": {
			const base = normalizeFolder(template.folder);
			const parent = file.parent?.path === "/" ? "" : file.parent?.path ?? "";
			const rel = base === "" ? parent : parent.slice(base.length).replace(/^\//, "");
			const first = rel.split("/")[0] ?? "";
			if (first) return [first];
			return [base === "" ? "Vault" : base.split("/").pop() ?? base];
		}
		case "tag": {
			const tags = fileTags(app.metadataCache.getFileCache(file));
			const wanted = template.tags.map(normalizeTag).filter(Boolean);
			const keys = wanted.length > 0 ? wanted.filter((t) => hasTag(tags, t)) : [...new Set(tags)];
			return keys.length > 0 ? keys.map((t) => `#${t}`) : ["Untagged"];
		}
		case "property": {
			const key = template.groupProperty.trim();
			if (!key) return ["No value"];
			const values = propertyValues(app.metadataCache.getFileCache(file), key);
			return values.length > 0 ? [...new Set(values)] : ["No value"];
		}
	}
}

function sortFiles(files: TFile[], template: MocTemplate): TFile[] {
	const byName = (a: TFile, b: TFile) => a.basename.localeCompare(b.basename, undefined, {numeric: true});
	switch (template.sort) {
		case "modified":
			return files.sort((a, b) => b.stat.mtime - a.stat.mtime || byName(a, b));
		case "created":
			return files.sort((a, b) => b.stat.ctime - a.stat.ctime || byName(a, b));
		default:
			return files.sort(byName);
	}
}

/**
 * Matching notes, grouped and sorted. `limitOverride` caps notes per group
 * (used by the settings preview) on top of the template's own limit.
 */
export function collectMocGroups(
	app: App,
	template: MocTemplate,
	excludePath?: string,
	limitOverride?: number,
): MocGroup[] {
	const groups = new Map<string, TFile[]>();
	for (const file of queryMocFiles(app, template, excludePath)) {
		for (const key of groupKeys(app, template, file)) {
			const list = groups.get(key) ?? [];
			list.push(file);
			groups.set(key, list);
		}
	}

	const limits = [template.maxPerGroup, limitOverride ?? 0].filter((n) => n > 0);
	const limit = limits.length > 0 ? Math.min(...limits) : 0;
	return [...groups.entries()]
		.sort(([a], [b]) => a.localeCompare(b, undefined, {numeric: true}))
		.map(([name, files]) => {
			const sorted = sortFiles(files, template);
			return {name, files: limit > 0 ? sorted.slice(0, limit) : sorted};
		});
}
