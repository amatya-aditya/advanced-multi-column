import {App, CachedMetadata, getAllTags, TFile} from "obsidian";
import type {MocFolderRule, MocRuleOp, MocTemplate} from "./types";

export interface MocGroup {
	name: string;
	files: TFile[];
}

function normalizeFolder(folder: string): string {
	return folder.trim().replace(/^\/+|\/+$/g, "");
}

function parentFolder(path: string): string {
	const at = path.lastIndexOf("/");
	return at < 0 ? "" : path.slice(0, at);
}

/**
 * Folder a folder rule points at, resolved for the note containing the MOC
 * ("" is the vault root). Note-relative modes need `sourcePath`; without one
 * they resolve to null.
 */
export function resolveRuleFolder(rule: MocFolderRule, sourcePath?: string): string | null {
	switch (rule.mode) {
		case "fixed":
			return normalizeFolder(rule.folder);
		case "note":
			return sourcePath === undefined ? null : parentFolder(sourcePath);
		case "parent":
			return sourcePath === undefined ? null : parentFolder(parentFolder(sourcePath));
	}
}

/** Whether any folder rule is relative to the note the MOC is in. */
export function hasRelativeFolder(template: MocTemplate): boolean {
	return template.rules.some((r) => r.type === "folder" && r.mode !== "fixed");
}

interface ResolvedFolder {
	folder: string;
	includeSubfolders: boolean;
}

/** The template's folder rules, resolved for the MOC in `sourcePath`. */
export function resolvedFolders(template: MocTemplate, sourcePath?: string): ResolvedFolder[] {
	const folders: ResolvedFolder[] = [];
	for (const rule of template.rules) {
		if (rule.type !== "folder") continue;
		const folder = resolveRuleFolder(rule, sourcePath);
		if (folder !== null) folders.push({folder, includeSubfolders: rule.includeSubfolders});
	}
	return folders;
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

/**
 * Query results shared within one refresh pass, keyed by template and resolved
 * folder, so MOCs using the same template in the same folder scan the vault once.
 */
export type MocQueryCache = Map<string, TFile[]>;

type FileCheck = (file: TFile, cache: CachedMetadata | null) => boolean;

interface RuleCheck {
	op: MocRuleOp;
	check: FileCheck;
}

/**
 * The template's rules as checks for a MOC in `sourcePath`; null matches
 * nothing. Empty rules (no tag, no property name) are left out.
 */
function buildChecks(template: MocTemplate, sourcePath?: string): RuleCheck[] | null {
	const checks: RuleCheck[] = [];
	for (const rule of template.rules) {
		switch (rule.type) {
			case "folder": {
				const folder = resolveRuleFolder(rule, sourcePath);
				// A folder relative to the note, with no note: the MOC lists nothing.
				if (folder === null) return null;
				checks.push({op: rule.op, check: (file) => inFolder(file, folder, rule.includeSubfolders)});
				break;
			}
			case "tag": {
				const tag = normalizeTag(rule.tag);
				if (tag) checks.push({op: rule.op, check: (_file, cache) => hasTag(fileTags(cache), tag)});
				break;
			}
			case "property": {
				const key = rule.key.trim();
				if (!key) break;
				const wanted = rule.value.trim().toLowerCase();
				checks.push({op: rule.op, check: (_file, cache) => {
					const values = propertyValues(cache, key);
					if (wanted === "") return values.length > 0;
					return values.some((v) => v.toLowerCase() === wanted);
				}});
				break;
			}
		}
	}
	return checks.length > 0 ? checks : null;
}

/** Combine the checks top to bottom: `A`, `OR B`, `AND C` is (A or B) and C. */
function combine(app: App, checks: RuleCheck[]): (file: TFile) => boolean {
	return (file) => {
		const cache = app.metadataCache.getFileCache(file);
		let result = checks[0]!.check(file, cache);
		for (let i = 1; i < checks.length; i++) {
			const {op, check} = checks[i]!;
			result = op === "and" ? result && check(file, cache) : result || check(file, cache);
		}
		return result;
	};
}

/**
 * Whether a single note belongs in the MOC in `sourcePath`. Cheap: used to
 * decide which MOCs a change can affect without scanning the vault.
 */
export function createMocMatcher(app: App, template: MocTemplate, sourcePath?: string): (file: TFile) => boolean {
	const checks = buildChecks(template, sourcePath);
	if (!checks) return () => false;
	const matches = combine(app, checks);
	return (file) => file.path !== sourcePath && file.extension === "md" && matches(file);
}

/**
 * Notes selected by the template's sources for the MOC in `sourcePath`
 * (which is itself never listed).
 */
export function queryMocFiles(
	app: App,
	template: MocTemplate,
	sourcePath?: string,
	cache?: MocQueryCache,
): TFile[] {
	const checks = buildChecks(template, sourcePath);
	if (!checks) return [];
	const folders = resolvedFolders(template, sourcePath).map((f) => f.folder);
	const key = [template.id, ...folders].join("\u0000");
	let matched = cache?.get(key);
	if (!matched) {
		matched = app.vault.getMarkdownFiles().filter(combine(app, checks));
		cache?.set(key, matched);
	}
	return matched.filter((file) => file.path !== sourcePath);
}

/**
 * Folder a note's subfolder group is named relative to: the deepest folder
 * rule that contains the note, else the vault root.
 */
function groupBase(file: TFile, folders: ReadonlyArray<ResolvedFolder>): string {
	let base = "";
	for (const {folder, includeSubfolders} of folders) {
		if (inFolder(file, folder, includeSubfolders) && folder.length > base.length) base = folder;
	}
	return base;
}

function groupKeys(app: App, template: MocTemplate, file: TFile, folders: ReadonlyArray<ResolvedFolder>): string[] {
	switch (template.groupBy) {
		case "none":
			return [""];
		case "subfolder": {
			const base = groupBase(file, folders);
			const parent = file.parent?.path === "/" ? "" : file.parent?.path ?? "";
			const rel = base === "" ? parent : parent.slice(base.length).replace(/^\//, "");
			const first = rel.split("/")[0] ?? "";
			if (first) return [first];
			return [base === "" ? "Vault" : base.split("/").pop() ?? base];
		}
		case "tag": {
			const tags = fileTags(app.metadataCache.getFileCache(file));
			const wanted = template.rules.flatMap((r) => (r.type === "tag" ? [normalizeTag(r.tag)] : [])).filter(Boolean);
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
	const direction = template.sortReverse ? -1 : 1;
	switch (template.sort) {
		case "modified":
			return files.sort((a, b) => direction * (b.stat.mtime - a.stat.mtime || byName(a, b)));
		case "created":
			return files.sort((a, b) => direction * (b.stat.ctime - a.stat.ctime || byName(a, b)));
		default:
			return files.sort((a, b) => direction * byName(a, b));
	}
}

/** Groups the MOC shows: all of them, minus the ones the template hides. */
export function visibleMocGroups(template: MocTemplate, groups: MocGroup[]): MocGroup[] {
	if (template.groupBy === "none" || template.hiddenGroups.length === 0) return groups;
	const hidden = new Set(template.hiddenGroups);
	return groups.filter((group) => !hidden.has(group.name));
}

/**
 * Matching notes, grouped and sorted. `limitOverride` caps notes per group
 * (used by the settings preview) on top of the template's own limit.
 */
export function collectMocGroups(
	app: App,
	template: MocTemplate,
	sourcePath?: string,
	limitOverride?: number,
	cache?: MocQueryCache,
): MocGroup[] {
	const groups = new Map<string, TFile[]>();
	const folders = resolvedFolders(template, sourcePath);
	for (const file of queryMocFiles(app, template, sourcePath, cache)) {
		for (const key of groupKeys(app, template, file, folders)) {
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
