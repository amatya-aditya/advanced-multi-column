# 09 - Troubleshooting and FAQ

## Columns not rendering in editor

Check:

1. You are in Live Preview mode.
2. `Enable in live preview` is on.
3. Markers are valid and balanced (`col-start`, `col-break`, `col-end`).

## Columns not rendering in Reading View

Check:

1. `Enable in reading view` is on.
2. Marker block exists in note source.
3. Reload note/view after major edits.

## Right-click style popover does not open

Check:

1. Right-click directly on a column item area.
2. Not right-clicking inside active input/textarea controls.

## Drag reorder not working

Try:

1. Drag from header grip (`⋮⋮`).
2. Or hold `Alt` while dragging column body.
3. Ensure note is in Live Preview.

## Resizing feels blocked

Reason:

1. Minimum column width is enforced.

Fix:

1. Lower `Minimum column width` in settings.

## Selected columns do not clear

Expected behavior:

1. `Ctrl/Cmd` click selects multiple columns.
2. Plain click inside or outside column block clears selection.

## Unstack behavior question

If you unstack a contiguous trailing subset from a stacked run, example `3,4` from `2,3,4`:

1. Selected subset is moved into a nested row inside the immediate left stacked sibling.
2. If selection does not match transform rules, plugin falls back to normal unstack (clears `stk` flags only).

## Wikilink/slash suggestions not appearing

Check:

1. You are typing inside a column editor textarea.
2. Wikilink trigger is `[[`.
3. Slash trigger is `/` at line start or after whitespace.

## Markers render as plain text

Common causes:

1. Typo in marker syntax.
2. Missing `%% col-end %%`.
3. Marker text is not on its own line.

