/**
 * MOC (map of content) templates. A template describes which notes to list
 * (folder, tags, properties), how to group them and how groups map onto
 * columns. Inserting a template writes a column block of real links, tagged
 * `moc:<id>` on its col-start marker, which the plugin keeps up to date.
 */

export type MocGroupBy = "none" | "subfolder" | "tag" | "property";
export type MocSort = "name" | "modified" | "created";
export type MocMatch = "all" | "any";
/**
 * Where the folder source points: a fixed folder, or relative to the note
 * that contains the MOC (so one template works in every folder).
 */
export type MocFolderMode = "none" | "fixed" | "note" | "parent";

export interface MocPropertyFilter {
	key: string;
	/** Empty: the note only needs to have the property. */
	value: string;
}

export interface MocTemplate {
	id: string;
	name: string;
	/**
	 * Settings of a single MOC built with "New MOC…" rather than a reusable
	 * template; hidden from template lists and menus.
	 */
	inline: boolean;
	folderMode: MocFolderMode;
	/** Fixed folder path ("/" is the vault root); used when folderMode is "fixed". */
	folder: string;
	includeSubfolders: boolean;
	/** Tags without "#". Nested tags match their parents (`a/b` matches `a`). */
	tags: string[];
	properties: MocPropertyFilter[];
	/** Whether a note must match every source or at least one. */
	match: MocMatch;
	groupBy: MocGroupBy;
	/** Property key used when grouping by property. */
	groupProperty: string;
	/** Number of columns (1–6). */
	columns: number;
	/** Group name → 0-based column index; unassigned groups are placed automatically. */
	assignments: Record<string, number>;
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
		folderMode: "note",
		folder: "",
		includeSubfolders: true,
		tags: [],
		properties: [],
		match: "all",
		groupBy: "subfolder",
		groupProperty: "",
		columns: 3,
		assignments: {},
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

/** Validate a template loaded from data.json; drops anything malformed. */
export function sanitizeMocTemplate(raw: unknown): MocTemplate | null {
	if (!isRecord(raw)) return null;
	if (typeof raw.id !== "string" || !/^[\w-]+$/.test(raw.id)) return null;
	const base = createMocTemplate(raw.id, typeof raw.name === "string" ? raw.name : raw.id);
	const pick = <K extends keyof MocTemplate>(key: K, ok: (v: unknown) => boolean): void => {
		if (ok(raw[key])) (base as unknown as Record<string, unknown>)[key] = raw[key];
	};
	pick("inline", (v) => typeof v === "boolean");
	pick("folder", (v) => typeof v === "string");
	if (raw.folderMode === "none" || raw.folderMode === "fixed" || raw.folderMode === "note" || raw.folderMode === "parent") {
		base.folderMode = raw.folderMode;
	} else {
		// Templates saved before folder modes existed used a fixed folder.
		base.folderMode = base.folder.trim() === "" ? "none" : "fixed";
	}
	pick("includeSubfolders", (v) => typeof v === "boolean");
	pick("tags", (v) => Array.isArray(v) && v.every((t) => typeof t === "string"));
	pick("properties", (v) => Array.isArray(v) && v.every(
		(p) => isRecord(p) && typeof p.key === "string" && typeof p.value === "string",
	));
	pick("match", (v) => v === "all" || v === "any");
	pick("groupBy", (v) => v === "none" || v === "subfolder" || v === "tag" || v === "property");
	pick("groupProperty", (v) => typeof v === "string");
	pick("columns", (v) => typeof v === "number" && v >= 1 && v <= MAX_MOC_COLUMNS);
	pick("assignments", (v) => isRecord(v) && Object.keys(v).every((k) => typeof v[k] === "number"));
	pick("sort", (v) => v === "name" || v === "modified" || v === "created");
	pick("sortReverse", (v) => typeof v === "boolean");
	pick("showHeadings", (v) => typeof v === "boolean");
	pick("showBullets", (v) => typeof v === "boolean");
	pick("maxPerGroup", (v) => typeof v === "number" && v >= 0);
	base.columns = Math.round(base.columns);
	return base;
}
