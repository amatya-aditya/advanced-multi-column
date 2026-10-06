# Changelog

All notable changes to **Advanced Multi Column** are listed here, newest first.
Versions follow [Semantic Versioning](https://semver.org/). Each version links to its
[GitHub release](https://github.com/amatya-aditya/advanced-multi-column/releases).

## [2.4.0](https://github.com/amatya-aditya/advanced-multi-column/releases/tag/2.4.0) - 2026-10-05

### Added
- Footnotes work inside columns, including in tables inside columns. `[^label]` and inline `^[…]` footnotes keep their definitions from anywhere in the note:
  - **Reading view:** footnotes are numbered across the whole note and listed at its end. Click a number to jump to its footnote, and ↩︎ to jump back.
  - **Live Preview:** references show as `[^label]` and `^[text]`, as in the editor. Click one to move the cursor to its definition.
  - Hovering a reference previews the footnote in both views.
- Removing a column with content asks first: the first click on `×` turns it into **Delete?**, and only a second click removes the column. Moving away or waiting 3 seconds cancels. Empty columns are still removed with one click.

### Changed
- The drag handle moved to the column's top-left corner, so it no longer covers text; `+` and `×` stay at the top right, with more space between them.
- Style menu: the tabs are now **This column** and **All columns** (was **Column** and **Block**). A line under the tabs says what the settings change, and the page outlines it while the menu is open. **Reset block** is now **Reset box**.
- Style menu: **Stacked** in the column tab is now **Stack with next column** (**Stack with previous column** for the last column, **Stack selected columns** for a selection). It is hidden when the whole block is already stacked, and turning it off no longer leaves one-column stacks behind.
- Columns stacked on top of each other are spaced 8px apart.

### Fixed
- Live Preview: editing a column no longer shifts its text sideways with themes that restyle tables (such as Willemstad with wide tables), and no longer shifts it slightly on mobile in any theme ([#27](https://github.com/amatya-aditya/advanced-multi-column/issues/27)).
- Live Preview: text right after a nested column block now has the same space as the text before it.
- Appearance settings (border, background, dividers) now apply in every window, including popout windows, and reloading the plugin no longer leaves old styles behind.
- The style menu now closes when the plugin is turned off or reloaded.

### Internal
- Added `CONTRIBUTING.md`.

## [2.3.0](https://github.com/amatya-aditya/advanced-multi-column/releases/tag/2.3.0) - 2026-10-05

### Added
- MOC: a **Reverse sort order** toggle under **Sort notes by**. It lists notes Z to A by name, or oldest first by **Last modified** or **Created** ([#26](https://github.com/amatya-aditya/advanced-multi-column/issues/26)).

### Fixed
- Live Preview: text typed in a column is now saved when you switch to another note without clicking outside the column first. Before, if the other note also had columns, the unsaved text could open in that note's column instead ([#25](https://github.com/amatya-aditya/advanced-multi-column/issues/25)).
- Reading view: with the Minimal theme, notes with columns now follow Minimal's line width settings and line up with the properties block and the rest of the note ([#6](https://github.com/amatya-aditya/advanced-multi-column/issues/6)).

## [2.2.0](https://github.com/amatya-aditya/advanced-multi-column/releases/tag/2.2.0) - 2026-10-03

**Requires Obsidian 1.13.0 or newer.**

### Changed
- Settings are rebuilt on Obsidian's native settings layout:
  - General options and **Narrow screens** are on the main page; **MOC**, **Appearance** and **Column headers** open as sub-pages.
  - Every option can be found with the settings search.
  - Sliders show their value inline.
  - MOC templates and header types are cards: **+** adds one, the pencil opens it, and delete removes it.
- **MOC → Settings** in the editor menu opens the MOC settings page directly.
- Reading view: the column layout renders faster when a note opens, because the column contents render in parallel.

### Fixed
- Live Preview and Source mode no longer scroll down by themselves after a column is dragged.
- Reading view: switching notes no longer shows the note's text collapsed for a moment before the columns appear, or a previous note's columns.
- Reading view: opening a note no longer re-renders the previously open note.

### Internal
- Fewer plugin-scanner warnings:
  - `!important` reduced to the two `display: flex` rules that themes override;
  - window timers and `instanceOf` checks;
  - typed frontmatter access in the MOC dialog.
- `obsidian` type definitions updated to 1.13.1.

## [2.1.0](https://github.com/amatya-aditya/advanced-multi-column/releases/tag/2.1.0) - 2026-10-03

### Added
- **New MOC… dialog**, from the editor context menu and the command palette:
  - pick folders, tags and properties from your vault, with a live preview;
  - save the options as a reusable template.
- MOC folder sources relative to the note (**this note's folder** or **its parent**), so one template works in any folder.
- **Edit MOC**: right-click an inserted MOC to change it.
- **Enable MOC** setting (on by default). When off, inserted MOCs stay as ordinary columns and are not updated.
- Screenshot gallery in the README and wiki; privacy and vault-access notes.

### Changed
- MOCs update incrementally:
  - typing and unrelated changes no longer regenerate them;
  - only MOCs that list a changed note, or now match it, are rewritten;
  - MOCs share vault queries.
- The MOC settings tab moved before Appearance.
- Unsaved column drafts are offered in a dialog instead of being copied to the clipboard.

### Fixed
- Reading view:
  - no more scroll jumps (the backlinks footer is no longer moved, and scroll positions map through the column layer);
  - content deleted in the editor no longer lingers;
  - column headers reach the column edges;
  - columns no longer overflow their block.
- The column editor no longer grows or gains padding while editing.

## [2.0.0](https://github.com/amatya-aditya/advanced-multi-column/releases/tag/2.0.0) - 2026-10-03

### Added
- **MOC (map of content) columns:**
  - templates select notes by folder (with subfolders), tags and/or properties;
  - notes are grouped by subfolder, tag or property value and placed into chosen columns;
  - each template has a live preview, sorting, per-group limits, headings and optional bullets.
- **Insert MOC** (command palette and editor context menu) writes real links in a column block. The block regenerates when notes are added, renamed, deleted or retagged, and keeps its styles.
- New "secondary" color option.

### Changed
- Redesigned column style menu:
  - **Column** and **Block** tabs, native toggles and dropdowns, and the separator inside the column settings;
  - it shows the rendered state, including global Appearance defaults;
  - turning a separator off hides the global divider for that column.
- One layout list now drives both the command palette and the context menu.
- New layouts and columns default to the primary background.
- The **Stacked + wide** layout gets borders; the Kanban block border uses "secondary".

### Removed
- The **Info card** layout.

### Fixed
- Typing into an empty text segment before a nested block no longer breaks the layout.
- Dragging separators no longer promotes child columns.
- Paragraph spacing in Reading view and Live Preview, and spacing around nested blocks.
- No padding or height jump while editing a column.

## [1.4.0](https://github.com/amatya-aditya/advanced-multi-column/releases/tag/1.4.0) - 2026-10-02

### Added
- **Stack columns on narrow screens** setting, for phones and narrow panes ([#11](https://github.com/amatya-aditya/advanced-multi-column/issues/11)).
- Columns render in **PDF export** ([#22](https://github.com/amatya-aditya/advanced-multi-column/issues/22)).
- Columns render in whole-note embeds and canvas file cards ([#13](https://github.com/amatya-aditya/advanced-multi-column/issues/13)).
- An **×** remove button and an **Edit column** action ([#14](https://github.com/amatya-aditya/advanced-multi-column/issues/14)).
- Palette colors are CSS variables, for themes and snippets ([#10](https://github.com/amatya-aditya/advanced-multi-column/issues/10)).

### Fixed
- Live Preview is much faster: typing above a column block no longer re-renders it on every keystroke ([#20](https://github.com/amatya-aditya/advanced-multi-column/issues/20)).
- Column edits are no longer lost:
  - an editor re-opens with its unsaved text after the block rebuilds;
  - a draft is written to the note if you switch tabs before it is saved.
- The main cursor can no longer type into hidden column markers.
- Ctrl/Cmd+click opens links, collapsible callouts toggle, and image-only columns are editable ([#21](https://github.com/amatya-aditya/advanced-multi-column/issues/21)).
- Appearance settings are now applied ([#7](https://github.com/amatya-aditya/advanced-multi-column/issues/7)); per-column borders are kept in Reading view ([#24](https://github.com/amatya-aditya/advanced-multi-column/issues/24)).
- Links in the About section ([#23](https://github.com/amatya-aditya/advanced-multi-column/issues/23)).

## [1.3.1](https://github.com/amatya-aditya/advanced-multi-column/releases/tag/1.3.1) - 2026-08-06

### Fixed
- Reading view scrolling is more stable.

## [1.3.0](https://github.com/amatya-aditya/advanced-multi-column/releases/tag/1.3.0) - 2026-08-06

### Added
- Columns are edited with Obsidian's Live Preview editor ([#17](https://github.com/amatya-aditya/advanced-multi-column/pull/17)).

### Fixed
- Reading view no longer gets stuck re-rendering in an endless loop ([#16](https://github.com/amatya-aditya/advanced-multi-column/pull/16)).
- Native backlinks stay below the columns, same-length edits are detected, and blank lines around column markers are preserved ([#9](https://github.com/amatya-aditya/advanced-multi-column/issues/9)).
- Embedded Live Preview editors are cleaned up properly.

## [1.2.4](https://github.com/amatya-aditya/advanced-multi-column/releases/tag/1.2.4) - 2026-06-03

### Fixed
- The plugin failed to load on Obsidian 1.13.0.
- Stylesheet cleanup: far fewer `!important` rules, and no `:has` selectors.

## [1.2.3](https://github.com/amatya-aditya/advanced-multi-column/releases/tag/1.2.3) - 2026-05-24

### Added
- **Fold note properties by default** setting, applied smoothly when a note opens.

## [1.2.2](https://github.com/amatya-aditya/advanced-multi-column/releases/tag/1.2.2) - 2026-05-12

### Changed
- Compatibility updates to the column menu, column renderer and resizer.
- Release builds now carry build attestations.

## [1.2.1](https://github.com/amatya-aditya/advanced-multi-column/releases/tag/1.2.1) - 2026-05-08

### Changed
- Faster column rendering and backlinks handling.
- Settings placeholders use sentence case.

## [1.2.0](https://github.com/amatya-aditya/advanced-multi-column/releases/tag/1.2.0) - 2026-04-04

### Fixed
- Internal links in Reading view are clickable.
- Columns from a previous note no longer stay visible after you navigate to a note without columns.
- The left border toggle is saved; its color follows the header background.
- Header padding, bullet markers in unordered lists, and clipped list markers in Reading view.

## [1.1.1](https://github.com/amatya-aditya/advanced-multi-column/releases/tag/1.1.1) - 2026-03-28

### Changed
- Reworked column toolbar: a narrow vertical toolbar on the right with a drag handle and a **+** button. Delete moved to the context menu, styled as a danger action.

### Fixed
- Dragging a column from left to right.

## [1.1.0](https://github.com/amatya-aditya/advanced-multi-column/releases/tag/1.1.0) - 2026-03-28

First stable release with **stacked columns**. Includes everything from the 1.1.0 betas:

### Added
- **Stacked columns**, and splitting part of a stack into its own group.
- **Inherit style on add** setting: new columns copy their neighbor's style.
- Ctrl/Cmd+click **+** adds the opposite column type (stacked ↔ side by side).
- List editing inside columns:
  - **Tab** / **Shift+Tab** indent and unindent;
  - **Enter** continues lists;
  - **Ctrl/Cmd+L** toggles checkboxes, including custom task statuses.
- Suggestions from other plugins work inside columns (for example Iconize icons).
- Wiki documentation, synced to the GitHub Wiki.

### Changed
- Built-in layouts use the secondary background.
- A centered drag handle.
- The **+** tooltip reflects the column type.
- Custom text colors also apply to links.

### Fixed
- List spacing and blank-line gaps between blocks.
- Task checkboxes toggle correctly in preview.
- Ctrl+click on **+** no longer selects columns.

## 1.1.0 betas - 2026-03-01 to 2026-03-28

- **1.1.0-beta.4:** list editing (Tab, Shift+Tab, Enter), Ctrl/Cmd+L checkbox toggle, list spacing fixes.
- **1.1.0-beta.3:** style inheritance, Ctrl/Cmd+click opposite add, stack splitting, third-party suggestions, new drag handle.
- **1.1.0-beta.2:** stacked columns (breaking change to column behavior).
- **1.1.0-beta.1:** first stacked column preview.

## 1.0.x betas - 2026-02-23 to 2026-02-25

- **1.0.2-beta.1 – beta.4:** drop indicator improvements, plugin logo, README updates and smaller fixes.
- **1.0.1-beta.1 – beta.2:** CodeMirror dependencies aligned with Obsidian's versions.
- **1.0.0 beta:** first release: marker-based columns (`%% col-start %%`) rendered in Live Preview and Reading view, with resizing, drag-and-drop and a style menu.
