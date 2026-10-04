import type {App} from "obsidian";
import {findColumnRegions, serializeColumns} from "../column/core/parser";
import type {ColumnData, ColumnRegion} from "../column/core/types";
import {collectMocGroups, MocGroup, MocQueryCache} from "./query";

/** What a MOC note currently lists, used to decide which changes affect it. */
export interface MocNoteUsage {
	/** Paths of all notes linked from the note's MOC blocks. */
	listed: Set<string>;
	/** Template ids used by the note's MOC blocks. */
	templates: Set<string>;
}
import {MAX_MOC_COLUMNS, MocTemplate} from "./types";

interface ColumnPlan {
	groups: MocGroup[];
	/** Rough rendered height, used to balance automatic placement. */
	weight: number;
}

/** Number of columns a template renders with the given groups. */
export function mocColumnCount(template: MocTemplate, groups: ReadonlyArray<MocGroup>): number {
	const wanted = Math.max(1, Math.min(MAX_MOC_COLUMNS, Math.round(template.columns)));
	// One ungrouped list is split across the columns; otherwise there is no
	// point in more columns than groups.
	if (template.groupBy === "none") return wanted;
	return Math.max(1, Math.min(wanted, groups.length));
}

/**
 * Place groups into columns: assigned groups go to their column, the rest to
 * whichever column is currently shortest. An ungrouped list is split evenly.
 */
export function planMocColumns(template: MocTemplate, groups: ReadonlyArray<MocGroup>): ColumnPlan[] {
	const count = mocColumnCount(template, groups);
	const plans: ColumnPlan[] = Array.from({length: count}, () => ({groups: [], weight: 0}));

	if (template.groupBy === "none") {
		const files = groups[0]?.files ?? [];
		const perColumn = Math.ceil(files.length / count);
		plans.forEach((plan, i) => {
			const slice = files.slice(i * perColumn, (i + 1) * perColumn);
			plan.groups.push({name: "", files: slice});
			plan.weight = slice.length;
		});
		return plans;
	}

	const auto: MocGroup[] = [];
	for (const group of groups) {
		const assigned = template.assignments[group.name];
		const plan = assigned !== undefined ? plans[assigned] : undefined;
		if (!plan) {
			auto.push(group);
			continue;
		}
		plan.groups.push(group);
		plan.weight += group.files.length + 1;
	}
	for (const group of auto) {
		const target = plans.reduce((min, plan) => (plan.weight < min.weight ? plan : min), plans[0]!);
		target.groups.push(group);
		target.weight += group.files.length + 1;
	}
	return plans;
}

function renderColumnContent(
	app: App,
	template: MocTemplate,
	plan: ColumnPlan,
	sourcePath: string,
): string {
	const sections: string[] = [];
	for (const group of plan.groups) {
		const lines: string[] = [];
		if (template.showHeadings && group.name) lines.push(`### ${group.name}`);
		const bullet = template.showBullets ? "- " : "";
		for (const file of group.files) {
			lines.push(`${bullet}${app.fileManager.generateMarkdownLink(file, sourcePath)}`);
		}
		if (lines.length > 0) sections.push(lines.join("\n"));
	}
	return sections.length > 0 ? sections.join("\n\n") : "_No matching notes_";
}

/**
 * The full column block for a template. When regenerating an existing block,
 * its block/column styles and layout are kept so styling from the context
 * menu survives updates.
 */
export function generateMocBlock(
	app: App,
	template: MocTemplate,
	sourcePath: string,
	existing?: ColumnRegion,
	limitOverride?: number,
	cache?: MocQueryCache,
	usage?: MocNoteUsage,
): string {
	const groups = collectMocGroups(app, template, sourcePath, limitOverride, cache);
	if (usage) {
		usage.templates.add(template.id);
		for (const group of groups) {
			for (const file of group.files) usage.listed.add(file.path);
		}
	}
	const plans = planMocColumns(template, groups);
	const columns: ColumnData[] = plans.map((plan, i) => ({
		content: renderColumnContent(app, template, plan, sourcePath),
		widthPercent: 0,
		style: existing?.columns[i]?.style ?? {background: "primary"},
	}));
	return serializeColumns(columns, existing?.containerStyle, existing?.layout, template.id);
}

/**
 * Rewrite every MOC block in `text` from its template. Blocks whose template
 * no longer exists are left untouched. Returns the text unchanged (same
 * string) when nothing differs.
 */
export function updateMocBlocks(
	app: App,
	text: string,
	sourcePath: string,
	templates: ReadonlyArray<MocTemplate>,
	cache?: MocQueryCache,
	usage?: MocNoteUsage,
): string {
	if (!text.includes("moc:")) return text;
	const regions = findColumnRegions(text).filter((r) => r.mocId);
	let next = text;
	for (const region of [...regions].sort((a, b) => b.from - a.from)) {
		const template = templates.find((t) => t.id === region.mocId);
		if (!template) continue;
		const block = generateMocBlock(app, template, sourcePath, region, undefined, cache, usage);
		if (next.slice(region.from, region.to) !== block) {
			next = next.slice(0, region.from) + block + next.slice(region.to);
		}
	}
	return next;
}

/** Whether a note's text contains any MOC block. */
export function hasMocBlocks(text: string): boolean {
	return text.includes("moc:") && findColumnRegions(text).some((r) => r.mocId);
}
