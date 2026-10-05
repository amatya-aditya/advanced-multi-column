# 10 - MOC (map of content)

A MOC is a column block that lists your notes as links — for example every note in a project folder, every note tagged `#book`, or every note whose `status` is `active` — and keeps that list up to date on its own.

The links are written into the note as real Markdown links, so they appear in graph view, backlinks and search, and still work if you disable the plugin.

## Quick start

1. Open a note in the folder you want to map — for example `Projects/Projects.md`.
2. Right-click in the editor and choose **Insert MOC → New MOC…** (or run **New MOC** from the command palette).
3. The dialog starts with **Folder: This note's folder**, **Include subfolders** on, **Group by: Subfolder** and 3 columns. The **Preview** shows the result from your vault.
4. Optionally add tags or properties, change the grouping or columns, then select **Insert**.

The note now contains a column block with one column per subfolder of `Projects`, each listing its notes as links. Create, rename or delete a note in `Projects` and the MOC updates a moment later.

![Two MOCs: notes grouped by subfolder, and by an era property without bullets](https://raw.githubusercontent.com/amatya-aditya/advanced-multi-column/master/assets/demo-moc.png)

## Two ways to set up a MOC

- **New MOC… (one MOC).** Build the MOC in a dialog for the note you are in. Its options belong to that MOC only. Change them later with right-click on the MOC → **Edit MOC** (the list icon in the column menu).
- **Templates (reused in many notes).** Save options once in **Settings → Advanced Multi Column → MOC** — or tick **Save as template** in the New MOC dialog — then insert them with **Insert MOC → a template**. Editing a template updates every MOC made from it.

Because the folder can be relative to the note (**This note's folder** / **Parent of this note's folder**), one template works everywhere: insert the same template in the index note of every project and each MOC lists its own folder. New installs include such a template, **This folder**.

## MOC options

The New MOC dialog, **Edit MOC** and the template settings show the same options. In settings, changes are saved immediately and every inserted MOC that uses the template is updated; in the dialog, they apply when you select **Insert** or **Save**.

### Sources — which notes are listed

| Setting | What it does |
|---|---|
| **Folder** | **This note's folder**: the folder of the note that contains the MOC. **Parent of this note's folder**: one level up. **A specific folder**: pick a **Folder path** (with suggestions; `/` is the whole vault). **Any folder**: don't filter by folder. Note-relative folders are resolved per MOC — and again if the note is moved. |
| **Include subfolders** | Also lists notes in all subfolders of the folder. |
| **Tags** | Type a tag (suggestions come from your vault) and press Enter or pick it; picked tags appear as chips you can remove. A parent tag also matches its subtags: `area` matches `#area/work`. Tags in properties and in the note body both count. |
| **Properties** | Pick a property and, optionally, a value (both suggested from your vault), then press Enter or **+**. `status` + `active` lists notes whose `status` is `active` (case-insensitive; for list properties any item may match, and `[[Link]]` values match `Link`). A property without a value lists notes that have it with any value. |
| **Combine sources** | **Match all sources**: a note must match the folder *and* every tag *and* every property line. **Match any source**: matching one of them is enough. |

The note that contains the MOC is never listed in its own MOC. A template with no sources lists nothing.

### Layout — how notes are arranged

| Setting | What it does |
|---|---|
| **Group by** | **Subfolder**: one group per top-level subfolder of the chosen folder (notes directly in the folder form a group named after it). **Tag**: one group per tag — the tags listed under Sources, or every tag of the notes if none are listed; notes without tags go to *Untagged*. **Property value**: one group per value of the **Group property** (a note with a list value appears under each value; notes without it go to *No value*). **No grouping**: one list. |
| **Group property** | Shown when grouping by property value — the property key to group by. |
| **Columns** | 1–6. Groups are placed into columns; if there are fewer groups than columns, fewer columns are used. With **No grouping**, the list is split evenly across the columns. |
| **Sort notes by** | **Name** (A–Z, numbers in natural order), **Last modified** or **Created** (newest first). Groups are always sorted by name. |
| **Reverse sort order** | Lists notes in the opposite order: **Name** Z–A, **Last modified** and **Created** oldest first. **Notes per group** then keeps the oldest notes instead of the newest. |
| **Show group headings** | Writes each group's name as a `###` heading above its links. |
| **Show bullets** | On: links are a bulleted list (`- [[Note]]`). Off: one plain link per line. Plain lines rely on Obsidian's default line breaks; with **Settings → Editor → Strict line breaks** turned on they run together on one line, so keep bullets on in that case. |
| **Notes per group** | Lists at most this many notes per group (`0` = all). Useful with **Last modified** to show only recent notes. |

### Column for each group

Lists the groups found in your vault right now. Choose a column for a group to pin it there, or leave it on **Automatic** — automatic groups are placed, in name order, into whichever column is currently shortest. Groups that appear later (for example a new subfolder) are placed automatically.

### Preview

Shows the column block the options produce from your current vault, with up to 8 notes per group, and which folder a note-relative folder resolves to. In settings, note-relative templates preview against the note that is currently open.

## Inserting and editing a MOC

- **Editor context menu → Insert MOC → New MOC…** — build a MOC in a dialog. Tick **Save as template** to also keep the options as a reusable template.
- **Editor context menu → Insert MOC →** a template. The same submenu has **Manage MOC templates…** to jump to the settings.
- **Command palette → New MOC**, or **Insert MOC from template**.

The block is inserted at the cursor. You can insert several MOCs into one note.

![New MOC dialog: sources and layout](https://raw.githubusercontent.com/amatya-aditya/advanced-multi-column/master/assets/demo-moc-dialog.png)

![New MOC dialog: column for each group and live preview](https://raw.githubusercontent.com/amatya-aditya/advanced-multi-column/master/assets/demo-moc-dialog-preview.png)

To change an inserted MOC, right-click one of its columns and select **Edit MOC** (list icon) in the column menu. If the MOC comes from a template, the dialog says so: changes then apply to every MOC from that template, unless you turn on **Only change this MOC**, which gives this MOC its own copy of the options.

## How the MOC stays up to date

The block is regenerated from its template, a second or two after:

- a note is created, renamed, moved or deleted,
- a note's tags or properties change,
- its options are edited (in settings or with **Edit MOC**),
- or the note with the MOC is opened.

The note is only rewritten when the list actually changed. Renamed notes are also covered by Obsidian's own link updating.

What is kept and what is replaced:

- **Kept:** styles you set on the MOC block and its columns from the right-click menu (background, border, separators, layout), and everything outside the block.
- **Replaced:** the links and headings inside the block. Anything you type inside a MOC block is overwritten at the next update — put your own notes above or below it.

To stop a MOC from updating, remove `moc:<id>` from its `%% col-start %%` marker; it becomes a normal column block. Deleting a template has the same effect for all its MOCs (they keep their last list).

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

`moc-1` is the id of the MOC's options (a template, or the options of a single MOC). It is shown nowhere else; options are matched by id, so renaming a template is safe. Links use your **Files and links** settings (wikilinks or Markdown links, shortest or full path).

## Examples

**Folder index in every folder** — one template for all project notes:

- Folder **This note's folder**, Include subfolders on
- Group by **Subfolder**, Columns `3`, Sort by **Name**
- Save it as a template, then insert it in each folder's index note.

**Siblings of this folder** — from a note in `Projects/Alpha`, list everything under `Projects`:

- Folder **Parent of this note's folder**, Group by **Subfolder**

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

- MOC features can be turned off with **Settings → Advanced Multi Column → MOC → Enable MOC**. Inserted MOCs then stay as ordinary columns and are not updated until it is turned back on.
- Templates, the options of single MOCs and the list of notes containing MOCs are stored in the plugin's settings (`data.json`). A MOC added on another device is picked up the first time you open that note on this device.
- Updates are incremental: typing in a note, or changing notes no MOC lists or matches, does not regenerate any MOC. Only MOCs that list a changed note, or whose sources now match it, are rewritten (MOCs sorted by **Last modified** also react to edits of the notes they list).
- A template that matches thousands of notes writes thousands of links. Narrow the sources or set **Notes per group** for large vaults.
- Settings → **MOC** templates are separate from the layout templates in the **Insert layout** menu.

## Troubleshooting

See [09 - Troubleshooting and FAQ](https://github.com/amatya-aditya/advanced-multi-column/wiki/09-troubleshooting-and-faq#moc-does-not-update).
