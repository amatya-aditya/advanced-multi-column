/**
 * Visual layout / Bento picker. Each card previews the actual column geometry
 * and inserts the marker text through the editor callback.
 */

export interface PickerTemplate {
	id: string;
	title: string;
	description: string;
	lines: string[];
	/** Mini preview: column percentages and how many stacked cards per column. */
	preview: Array<{width: number; rows: number; tinted?: boolean}>;
}

const BG = "b:primary";

function column(width: number, content: string, tokens = BG): string[] {
	return [`%% col-break:${width},${tokens} %%`, content];
}

export const PICKER_TEMPLATES: PickerTemplate[] = [
	{
		id: "two-equal",
		title: "2-Column Equal",
		description: "A balanced 50 / 50 split for side-by-side notes.",
		preview: [{width: 50, rows: 1}, {width: 50, rows: 1}],
		lines: [
			"%% col-start %%",
			...column(50, "Left column"),
			...column(50, "Right column"),
			"%% col-end %%",
		],
	},
	{
		id: "sidebar-main",
		title: "Sidebar + Main",
		description: "A 30% rail for navigation or metadata beside a 70% body.",
		preview: [{width: 30, rows: 1, tinted: true}, {width: 70, rows: 1}],
		lines: [
			"%% col-start %%",
			...column(30, "Sidebar"),
			...column(70, "Main content"),
			"%% col-end %%",
		],
	},
	{
		id: "main-inspector",
		title: "Main + Right Inspector",
		description: "A 70% canvas with a 30% inspector panel.",
		preview: [{width: 70, rows: 1}, {width: 30, rows: 1, tinted: true}],
		lines: [
			"%% col-start %%",
			...column(70, "Main content"),
			...column(30, "Inspector"),
			"%% col-end %%",
		],
	},
	{
		id: "three-dashboard",
		title: "3-Column Dashboard",
		description: "Three equal cards for a compact dashboard.",
		preview: [{width: 33.3, rows: 1}, {width: 33.3, rows: 1}, {width: 33.4, rows: 1}],
		lines: [
			"%% col-start:preset:apple-bento %%",
			...column(33, "Column one", "preset:soft-blue"),
			...column(33, "Column two", "preset:soft-mint"),
			...column(34, "Column three", "preset:soft-amber"),
			"%% col-end %%",
		],
	},
	{
		id: "apple-bento",
		title: "Apple Bento Grid",
		description: "A 40% sidebar beside a 60% column containing a nested 2 × 2 grid.",
		preview: [
			{width: 40, rows: 1, tinted: true},
			{width: 60, rows: 2},
		],
		lines: [
			"%% col-start:preset:apple-bento %%",
			...column(40, "### Sidebar\n\n- Overview\n- Notes\n- Tasks", "preset:soft-blue"),
			"%% col-break:60,preset:apple-card %%",
			"### Dashboard",
			"",
			"%% col-start:preset:glass-panel %%",
			...column(50, "Card one", "preset:soft-mint"),
			...column(50, "Card two", "preset:soft-amber"),
			"%% col-end %%",
			"",
			"%% col-start:preset:glass-panel %%",
			...column(50, "Card three", "preset:soft-rose"),
			...column(50, "Card four", "preset:soft-purple"),
			"%% col-end %%",
			"%% col-end %%",
		],
	},
	{
		id: "holy-grail",
		title: "Holy Grail Note",
		description: "20% navigation, 60% body, 20% metadata — the classic note layout.",
		preview: [
			{width: 20, rows: 1, tinted: true},
			{width: 60, rows: 1},
			{width: 20, rows: 1, tinted: true},
		],
		lines: [
			"%% col-start:preset:apple-bento %%",
			...column(20, "### Nav\n\n[[Home]]", "preset:minimal-flush"),
			...column(60, "### Body\n\nStart writing here."),
			...column(20, "### Metadata\n\n#status/active", "preset:minimal-flush"),
			"%% col-end %%",
		],
	},
];
