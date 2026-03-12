# 03 - Editing and interaction

This page covers daily editing behavior in Live Preview.

## Enter and exit edit mode

1. Click a column preview area to open editor for that column.
2. Type content.
3. Use one of these to finish:
4. Press `Esc`.
5. Click outside the active editor.
6. Press `Tab` to commit and move to next column.

## Keyboard shortcuts in column editor

| Shortcut | Action |
|---|---|
| `Esc` | Commit and close editor |
| `Tab` | Commit and move to next column |
| `Shift+Tab` | Commit and move to previous column |
| `Ctrl/Cmd + B` | Toggle bold markdown |
| `Ctrl/Cmd + I` | Toggle italic markdown |

## Wikilink autocomplete (`[[`)

1. Type `[[` in a column editor.
2. Continue typing file name/path.
3. Use arrow keys to select.
4. Press `Enter` to insert.

Behavior:

1. Empty query shows recent files first.
2. Non-empty query prioritizes starts-with matches.

## Slash command autocomplete (`/`)

Trigger `/` at start of line or after whitespace.

Built-in slash items include:

1. Heading 1/2/3
2. Bullet, numbered, task
3. Quote, code block, callout
4. Table, divider, math block, image embed

## Third-party plugin autocomplete

Column editors automatically bridge Obsidian's EditorSuggest API, so suggestions from third-party plugins (e.g. Iconize `:` trigger) work inside columns. The bridge:

1. Detects trigger patterns registered by other plugins.
2. Fetches and renders their suggestions in a popup.
3. Delegates selection back to the plugin for insertion.

## Image paste

1. Copy an image.
2. Paste inside a column editor.
3. Plugin saves image to current note folder.
4. Plugin inserts embed like `![[pasted-image-...png]]`.

## Add column shortcuts

| Action | Result |
|---|---|
| Click `+` | Add sibling (respects stacked context) |
| `Ctrl/Cmd + Click` `+` | Add opposite type (stacked → non-stacked, non-stacked → stacked) |

## Column multi-select behavior

1. Hold `Ctrl` (or `Cmd` on macOS).
2. Click columns to add/remove from selection.
3. Right-click one selected column to apply style actions to selection.

Deselect behavior:

1. Plain click (no `Ctrl/Cmd`) inside a column block clears prior selection.
2. Plain click outside the column block also clears prior selection.

