# 08 - Settings guide

Open `Settings -> Community Plugins -> Advanced multi column`.

## General tab

### Enable in live preview

1. Turn on to render columns in Live Preview editor mode.
2. Turn off to see raw markers in editor.

### Enable in reading view

1. Turn on to render markers in Reading View.
2. Turn off to disable reading-view renderer.

### Default column count

1. Controls `Insert layout (custom count)` output.
2. Range is `2..6`.

### Minimum column width

1. Used by resize logic.
2. Prevents dragging a column below minimum.
3. Range is `5..30` (%).

### Stack columns on narrow screens

1. When the column block is narrower than the breakpoint (phones, narrow panes, split views), columns are placed below each other instead of side by side.
2. Live editing keeps working in the stacked layout.
3. Default: **On**, breakpoint **480 px** (adjust with **Narrow screen breakpoint**).

### Show drag handles

1. Turns header grip visibility on/off.
2. You can still use `Alt+drag` on column body.

### Inherit style on add

1. When enabled, a newly added column inherits the style (background, border, text color, etc.) of its neighbor column.
2. When disabled, new columns are inserted with no style.
3. Default: **On**.

### Show container border

1. Shows a subtle border around the entire column container.
2. Useful for visually distinguishing column blocks from surrounding content.
3. Default: **On**.

## Appearance tab

Sections in UI:

1. Style target (`All columns` or `Specific column` index).
2. Container settings (background, border, width, radius, text color).
3. Vertical divider settings (width, style, color).

These settings apply to every column block in both Live Preview and Reading View. Styles set on a block (marker tokens or the right-click popover) take precedence over them.

With **Specific column**, the vertical divider is drawn only after the chosen column.

## Headers tab

### Enable column headers

1. Turn on to parse `!type: title` as a styled header when it appears as the first non-empty line in a column.
2. Turn off to render those lines as normal column content.
3. Default: **On**.

Example:

```md
%% col-start %%
%% col-break %%
!warning: Migration notes
Check compatibility before updating.
%% col-end %%
```

### Header types

Header types define which `!type:` IDs are recognized and how their rendered header looks.

Built-in types:

1. `note`
2. `info`
3. `tip`
4. `warning`
5. `danger`

Each header type can be configured with:

1. Name: the ID used after `!`, such as `info` in `!info: Details`.
2. Icon: any Obsidian/Lucide icon name, such as `info`, `hash`, or `triangle-alert`.
3. Background: the header background color.
4. Text color: the header text/icon color.
5. Font size: the rendered header text size.
6. Font weight: the rendered header text weight.

### Add a custom header type

1. Select **Add header type**.
2. Set a unique name, such as `quote`, `source`, or `todo`.
3. Pick an icon and colors.
4. Use it as the first non-empty line in a column:

```md
!todo: Follow up
```

Notes:

1. Header names are normalized for marker use.
2. Duplicate names are made unique automatically.
3. Built-in rows do not show the delete button while their original ID is unchanged.

## MOC tab

Create and edit MOC templates — saved queries that list notes by folder, tags and/or properties, grouped into columns. Each template shows a live preview from your vault, and inserted MOCs update automatically when the template changes.

Settings per template: name; **Sources** (folder, include subfolders, tags, properties, combine sources); **Layout** (group by, group property, columns, sort notes by, show group headings, show bullets, notes per group); **Column for each group**; **Preview**.

See [10 - MOC (map of content)](https://github.com/amatya-aditya/advanced-multi-column/wiki/10-moc-map-of-content) for what each setting does.

## About tab

Contains:

1. Plugin version.
2. GitHub and issue links.
3. Support links.
4. Other plugin links.
