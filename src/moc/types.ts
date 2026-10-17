/**
 * MOC (map of content) templates. A template describes which notes to list
 * (rules on folders, tags and properties), how to group them and how groups
 * map onto columns. Inserting a template writes a column block of real links, tagged
 * `moc:<id>` on its col-start marker, which the plugin keeps up to date.
 */

export type MocGroupBy = "none" | "subfolder" | "tag" | "property";
export type MocSort = "name" | "modified" | "created";
/** How a rule joins the rules above it. */
export type MocRuleOp = "and" | "or";
/**
 * Where a folder rule points: a fixed folder, or relative to the note that
 * contains the MOC (so one template works in every folder).
 */
export type MocFolderMode = "fixed" | "note" | "parent";

export interface MocFolderRule {
	type: "folder";
	op: MocRuleOp;
	mode: MocFolderMode;
	/** Fixed folder path ("/" is the vault root); used when mode is "fixed". */
	folder: string;
	includeSubfolders: boolean;
}

export interface MocTagRule {
	type: "tag";
	op: MocRuleOp;
	/** Without "#". Nested tags match their parents (`a/b` matches `a`). */
	tag: string;
}

export interface MocPropertyRule {
	type: "property";
	op: MocRuleOp;
	key: string;
	/** Empty: the note only needs to have the property. */
	value: string;
}

/**
 * One condition a note is checked against. Rules are combined top to bottom:
 * each rule after the first joins the result so far with its `op`, so
 * `A`, `OR B`, `AND C` means (A or B) and C. The first rule's op is unused.
 */
export type MocRule = MocFolderRule | MocTagRule | MocPropertyRule;

export interface MocTemplate {
	id: string;
	name: string;
	/**
	 * Settings of a single MOC built with "New MOC…" rather than a reusable
	 * template; hidden from template lists and menus.
	 */
	inline: boolean;
	/** Which notes are listed; none lists nothing. */
	rules: MocRule[];
	groupBy: MocGroupBy;
	/** Property key used when grouping by property. */
	groupProperty: string;
	/** Number of columns (1–6). */
	columns: number;
	/** Group name → 0-based column index; unassigned groups are placed automatically. */
	assignments: Record<string, number>;
	/** Group names left out of the MOC (their notes may still appear in other groups). */
	hiddenGroups: string[];
	sort: MocSort;
	/** List in the opposite order: Z–A by name, oldest first by date. */
	sortReverse: boolean;
	showHeadings: boolean;
	/** List links as a bulleted list; otherwise one plain link per line. */
	showBullets: boolean;
	/** 0 = no limit. */
	maxPerGroup: number;
}

export const MAX_MOC_COLUMNS = 6;

export function createMocTemplate(id: string, name: string): MocTemplate {
	return {
		id,
		name,
		inline: false,
		rules: [{type: "folder", op: "and", mode: "note", folder: "", includeSubfolders: true}],
		groupBy: "subfolder",
		groupProperty: "",
		columns: 3,
		assignments: {},
		hiddenGroups: [],
		sort: "name",
		sortReverse: false,
		showHeadings: true,
		showBullets: true,
		maxPerGroup: 0,
	};
}

/** Unique, marker-safe template id. */
export function newMocTemplateId(existing: ReadonlyArray<MocTemplate>): string {
	const used = new Set(existing.map((t) => t.id));
	let n = existing.length + 1;
	while (used.has(`moc-${n}`)) n++;
	return `moc-${n}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeRule(raw: unknown): MocRule | null {
	if (!isRecord(raw)) return null;
	const op: MocRuleOp = raw.op === "or" ? "or" : "and";
	switch (raw.type) {
		case "folder":
			return {
				type: "folder",
				op,
				mode: raw.mode === "fixed" || raw.mode === "parent" ? raw.mode : "note",
				folder: typeof raw.folder === "string" ? raw.folder : "",
				includeSubfolders: raw.includeSubfolders !== false,
			};
		case "tag":
			return typeof raw.tag === "string" ? {type: "tag", op, tag: raw.tag} : null;
		case "property":
			return typeof raw.key === "string"
				? {type: "property", op, key: raw.key, value: typeof raw.value === "string" ? raw.value : ""}
				: null;
		default:
			return null;
	}
}

/**
 * Rules for a template saved before rules existed: one optional folder, tags
 * and properties, all joined by its "every / any source" setting.
 */
function legacyRules(raw: Record<string, unknown>): MocRule[] {
	const op: MocRuleOp = raw.match === "any" ? "or" : "and";
	const rules: MocRule[] = [];
	const folder = typeof raw.folder === "string" ? raw.folder : "";
	const includeSubfolders = raw.includeSubfolders !== false;
	// Templates saved before folder modes existed used a fixed folder.
	const mode = raw.folderMode ?? (folder.trim() === "" ? "none" : "fixed");
	if (mode === "fixed" || mode === "note" || mode === "parent") {
		rules.push({type: "folder", op, mode, folder, includeSubfolders});
	}
	if (Array.isArray(raw.tags)) {
		for (const tag of raw.tags) if (typeof tag === "string") rules.push({type: "tag", op, tag});
	}
	if (Array.isArray(raw.properties)) {
		for (const p of raw.properties) {
			if (isRecord(p) && typeof p.key === "string") {
				rules.push({type: "property", op, key: p.key, value: typeof p.value === "string" ? p.value : ""});
			}
		}
	}
	return rules;
}

/** Validate a template loaded from data.json; drops anything malformed. */
export function sanitizeMocTemplate(raw: unknown): MocTemplate | null {
	if (!isRecord(raw)) return null;
	if (typeof raw.id !== "string" || !/^[\w-]+$/.test(raw.id)) return null;
	const base = createMocTemplate(raw.id, typeof raw.name === "string" ? raw.name : raw.id);
	const pick = <K extends keyof MocTemplate>(key: K, ok: (v: unknown) => boolean): void => {
		if (ok(raw[key])) (base as unknown as Record<string, unknown>)[key] = raw[key];
	};
	pick("inline", (v) => typeof v === "boolean");
	base.rules = Array.isArray(raw.rules)
		? raw.rules.map(sanitizeRule).filter((r): r is MocRule => r !== null)
		: legacyRules(raw);
	pick("groupBy", (v) => v === "none" || v === "subfolder" || v === "tag" || v === "property");
	pick("groupProperty", (v) => typeof v === "string");
	pick("columns", (v) => typeof v === "number" && v >= 1 && v <= MAX_MOC_COLUMNS);
	pick("assignments", (v) => isRecord(v) && Object.keys(v).every((k) => typeof v[k] === "number"));
	pick("hiddenGroups", (v) => Array.isArray(v) && v.every((g) => typeof g === "string"));
	pick("sort", (v) => v === "name" || v === "modified" || v === "created");
	pick("sortReverse", (v) => typeof v === "boolean");
	pick("showHeadings", (v) => typeof v === "boolean");
	pick("showBullets", (v) => typeof v === "boolean");
	pick("maxPerGroup", (v) => typeof v === "number" && v >= 0);
	base.columns = Math.round(base.columns);
	return base;
}
