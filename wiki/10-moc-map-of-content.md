# 10 - MOC (map of content)

A MOC is a column block that lists your notes as links — for example every note in a project folder, every note tagged `#book`, or every note whose `status` is `active` — and keeps that list up to date on its own.

The links are written into the note as real Markdown links, so they appear in graph view, backlinks and search, and still work if you disable the plugin.

## Quick start

1. Open **Settings → Advanced Multi Column → MOC**.
2. Click **Add MOC template** (or edit the example **Folder map** template).
3. Under **Sources**, enter a folder such as `Projects`, and turn on **Include subfolders**.
4. Set **Group by** to **Subfolder** and **Columns** to `3`. The **Preview** at the bottom shows the result from your vault.
5. Open a note, right-click in the editor and choose **Insert MOC → your template** (or run **Insert MOC** from the command palette).

The note now contains a column block with one column per subfolder, each listing its notes as links. Create, rename or delete a note in `Projects` and the MOC updates a moment later.

## Template settings

Each template has a name and three groups of settings. Changes are saved immediately and every inserted MOC that uses the template is updated.

### Sources — which notes are listed

| Setting | What it does |
|---|---|
| **Folder** | Lists notes in this folder. Type a path or pick one from the suggestions. Use `/` for the whole vault. Leave empty to not filter by folder. |
| **Include subfolders** | Also lists notes in all subfolders of the folder. |
| **Tags** | Comma-separated tags, with or without `#` (`project, area/work`). A parent tag also matches its subtags: `area` matches `#area/work`. Tags in properties and in the note body both count. |
| **Properties** | One per line. `status: active` lists notes whose `status` property is `active` (case-insensitive; for list properties any item may match, and `[[Link]]` values match `Link`). A line with only a key, such as `type`, lists notes that have that property with any value. |
| **Combine sources** | **Match all sources**: a note must match the folder *and* every tag *and* every property line. **Match any source**: matching one of them is enough. |

The note that contains the MOC is never listed in its own MOC. A template with no sources lists nothing.

### Layout — how notes are arranged

| Setting | What it does |
|---|---|
| **Group by** | **Subfolder**: one group per top-level subfolder of the chosen folder (notes directly in the folder form a group named after it). **Tag**: one group per tag — the tags listed under Sources, or every tag of the notes if none are listed; notes without tags go to *Untagged*. **Property value**: one group per value of the **Group property** (a note with a list value appears under each value; notes without it go to *No value*). **No grouping**: one list. |
| **Group property** | Shown when grouping by property value — the property key to group by. |
| **Columns** | 1–6. Groups are placed into columns; if there are fewer groups than columns, fewer columns are used. With **No grouping**, the list is split evenly across the columns. |
| **Sort notes by** | **Name** (A–Z, numbers in natural order), **Last modified** or **Created** (newest first). Groups are always sorted by name. |
| **Show group headings** | Writes each group's name as a `###` heading above its links. |
| **Show bullets** | On: links are a bulleted list (`- [[Note]]`). Off: one plain link per line. Plain lines rely on Obsidian's default line breaks; with **Settings → Editor → Strict line breaks** turned on they run together on one line, so keep bullets on in that case. |
| **Notes per group** | Lists at most this many notes per group (`0` = all). Useful with **Last modified** to show only recent notes. |

### Column for each group

Lists the groups found in your vault right now. Choose a column for a group to pin it there, or leave it on **Automatic** — automatic groups are placed, in name order, into whichever column is currently shortest. Groups that appear later (for example a new subfolder) are placed automatically.

### Preview

Shows the column block the template produces from your current vault, with up to 8 notes per group.

## Inserting a MOC

- **Editor context menu → Insert MOC →** a template. The same submenu has **Manage MOC templates…** to jump to the settings.
- **Command palette → Insert MOC**, then pick a template.

The block is inserted at the cursor. You can insert several MOCs (from the same or different templates) into one note.

## How the MOC stays up to date

The block is regenerated from its template, a second or two after:

- a note is created, renamed, moved or deleted,
- a note's tags or properties change,
- the template is edited in settings,
- or the note with the MOC is opened.

The note is only rewritten when the list actually changed. Renamed notes are also covered by Obsidian's own link updating.

What is kept and what is replaced:

- **Kept:** styles you set on the MOC block and its columns from the right-click menu (background, border, separators, layout), and everything outside the block.
- **Replaced:** the links and headings inside the block. Anything you type inside a MOC block is overwritten at the next update — put your own notes above or below it.

To stop a MOC from updating, remove `moc:<id>` from its `%% col-start %%` marker; it becomes a normal column block. Deleting the template has the same effect for all its MOCs (they keep their last list).

## Syntax

A MOC is an ordinary column block whose start marker names its template:

```md
%% col-start:moc:moc-1 %%

%% col-break:b:primary %%

### Alpha
- [[Notes]]
- [[Plan]]

%% col-break:b:primary %%

### Beta
- [[Spec]]

%% col-end %%
```

`moc-1` is the template's id (shown nowhere else — templates are matched by id, so renaming a template is safe). Links use your **Files and links** settings (wikilinks or Markdown links, shortest or full path).

## Examples

**Project dashboard** — every project folder in its own column:

- Folder `Projects`, Include subfolders on
- Group by **Subfolder**, Columns `3`, Sort by **Name**

**Reading list by status** — books grouped by status, `reading` always first:

- Tags `book`
- Group by **Property value**, Group property `status`
- Column for each group: `reading` → Column 1, others Automatic

**Recently edited work notes**:

- Tags `area/work`
- Group by **No grouping**, Columns `2`, Sort by **Last modified**, Notes per group `20`

**Active items from anywhere**:

- Properties `status: active`
- Group by **Tag**

## Tips and limits

- Templates and the list of notes containing MOCs are stored in the plugin's settings (`data.json`). A MOC added on another device is picked up the first time you open that note on this device.
- A template that matches thousands of notes writes thousands of links. Narrow the sources or set **Notes per group** for large vaults.
- Settings → **MOC** templates are separate from the layout templates in the **Insert layout** menu.

## Troubleshooting

See [09 - Troubleshooting and FAQ](https://github.com/amatya-aditya/advanced-multi-column/wiki/09-troubleshooting-and-faq#moc-does-not-update).
