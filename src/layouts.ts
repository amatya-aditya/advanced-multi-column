import type {ColumnsPluginSettings} from "./settings";

/**
 * Insertable layouts. One list feeds both the command palette and the editor
 * context menu so the two always offer the same layouts.
 */
export interface LayoutTemplate {
	/** Command id — stable, never rename (users bind hotkeys to it). */
	id: string;
	/** Command palette name. */
	name: string;
	/** Context menu label. */
	menuTitle: string;
	icon: string;
	/** Shown directly in the context menu instead of the "Insert layout" submenu. */
	quick?: boolean;
	lines: (settings: ColumnsPluginSettings) => string[];
}

/** Default style token for template columns. */
const BG = "b:primary";

function equalColumns(count: number): string[] {
	const lines = ["%% col-start %%"];
	for (let i = 0; i < count; i++) {
		lines.push(`%% col-break:${BG} %%`, `Column ${i + 1}`);
	}
	lines.push("%% col-end %%");
	return lines;
}

export const LAYOUT_TEMPLATES: LayoutTemplate[] = [
	{
		id: "insert-2-columns",
		name: "Insert 2-wide layout",
		menuTitle: "Insert 2 columns",
		icon: "columns-2",
		quick: true,
		lines: () => equalColumns(2),
	},
	{
		id: "insert-3-columns",
		name: "Insert 3-wide layout",
		menuTitle: "Insert 3 columns",
		icon: "columns-3",
		quick: true,
		lines: () => equalColumns(3),
	},
	{
		id: "insert-4-columns",
		name: "Insert 4-wide layout",
		menuTitle: "Insert 4 columns",
		icon: "columns-4",
		quick: true,
		lines: () => equalColumns(4),
	},
	{
		id: "insert-column-block",
		name: "Insert layout (custom count)",
		menuTitle: "Default column count",
		icon: "layout-grid",
		lines: (settings) => equalColumns(settings.defaultColumnCount),
	},
	{
		id: "insert-nested-layout",
		name: "Insert nested layout (parent + children)",
		menuTitle: "Nested columns",
		icon: "git-merge",
		lines: () => [
			"%% col-start %%",
			`%% col-break:40,${BG} %%`,
			"Top-level content.",
			`%% col-break:60,${BG} %%`,
			"This column contains nested columns.",
			"",
			"%% col-start %%",
			`%% col-break:${BG} %%`,
			"Child column 1",
			`%% col-break:${BG} %%`,
			"Child column 2",
			"%% col-end %%",
			"%% col-end %%",
		],
	},
	{
		id: "insert-sidebar-layout",
		name: "Insert sidebar + content layout",
		menuTitle: "Sidebar + content",
		icon: "panel-left",
		lines: () => [
			"%% col-start %%",
			`%% col-break:30,${BG} %%`,
			"Sidebar",
			`%% col-break:70,${BG} %%`,
			"Main content",
			"%% col-end %%",
		],
	},
	{
		id: "insert-stacked-layout",
		name: "Insert stacked + wide layout",
		menuTitle: "Stacked + wide",
		icon: "rows-3",
		lines: () => [
			"%% col-start %%",
			`%% col-break:40,stk:1,${BG},sb:1 %%`,
			"Stacked row 1",
			`%% col-break:stk:1,${BG},sb:1 %%`,
			"Stacked row 2",
			`%% col-break:stk:1,${BG},sb:1 %%`,
			"Stacked row 3",
			`%% col-break:60,${BG},sb:1 %%`,
			"Wide column",
			"%% col-end %%",
		],
	},
	{
		id: "insert-cornell-layout",
		name: "Insert Cornell notes layout",
		menuTitle: "Cornell notes",
		icon: "notebook-pen",
		lines: () => [
			"%% col-start %%",
			`%% col-break:stk:1,${BG} %%`,
			"**Topic / Title**",
			`%% col-break:30,stk:1,${BG} %%`,
			"**Cues / Questions**",
			"",
			"- Key term 1",
			"- Key question",
			"- Concept",
			`%% col-break:70,${BG} %%`,
			"**Notes**",
			"",
			"Main lecture or reading notes go here.",
			"%% col-end %%",
		],
	},
	{
		id: "insert-kanban-layout",
		name: "Insert Kanban board layout",
		menuTitle: "Kanban board",
		icon: "kanban",
		lines: () => [
			"%% col-start:sb:1,bc:secondary %%",
			`%% col-break:${BG},sb:1,bc:gray %%`,
			"### Backlog",
			"- [ ] Task 1",
			"- [ ] Task 2",
			"%% col-break:b:cyan-soft,sb:1,bc:cyan %%",
			"### In Progress",
			"- [ ] Task 3",
			"%% col-break:b:yellow-soft,sb:1,bc:yellow %%",
			"### Review",
			"- [ ] Task 4",
			"%% col-break:b:green-soft,sb:1,bc:green %%",
			"### Done",
			"- [x] Task 5",
			"%% col-end %%",
		],
	},
];
