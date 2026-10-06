# 05 - Resize, drag, and structure operations

This page explains structural editing operations.

## Resize columns

1. Hover between two columns.
2. Drag resize handle.
3. Release to commit new widths.

Details:

1. Minimum width follows `Minimum column width` setting.
2. Resize logic is group-aware (stack groups resize as a single unit).

## Reorder columns by drag

1. Drag the column grip (`⋮⋮`) at the column's top-left corner to reorder. It shows when you hover the column or edit it.
2. Or hold `Alt` before mouse-down and drag the column body.
3. Drop indicator shows before/after insertion position.

Advanced behavior:

1. Drag can move columns across nested containers.
2. Stack inheritance is resolved automatically on insertion.
3. Dragging out of a column container can insert a standalone column block at cursor line.

## Add columns

### Add sibling

1. Click `+` at the column's top-right.
2. New column is inserted to the right (or below if stacked).
3. Tooltip reflects context: "Add column to the right" for non-stacked, "Add stacked item below" for stacked columns.

### Ctrl+Click `+` (opposite mode)

1. Hold `Ctrl` (or `Cmd` on macOS) and click `+`.
2. If the column is non-stacked, a new stacked group is created with the clicked column and the new column.
3. If the column is stacked, a non-stacked column is inserted to the right instead.

### Add child

1. Right-click a column.
2. Select `Add child column`.
3. Plugin inserts nested block inside that column content.

## Remove columns

1. Click `×` at the column's top-right, below `+`.
2. If more than one sibling exists, the column is removed. If the column has content, `×` first turns into a red **Delete?** button; click it again to remove the column. Moving away or waiting 3 seconds cancels. An empty column is removed with one click.
3. Widths are normalized/preserved based on stack context.

Nested edge case:

1. If removing the last nested column in a nested region, the nested region itself is removed.
