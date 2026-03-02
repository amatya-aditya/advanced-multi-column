# Plan: Vertical (Stacked) Column Layout

## Overview

Add a `layout` property to the container (ColumnRegion) level that switches columns from the default side-by-side (`row`) arrangement to a top-to-bottom (`stack`) arrangement. This is a **container-level** property — all columns in a block share the same layout direction.

## Current Architecture

- `%% col-start %%` accepts container-level style tokens (e.g. `b:secondary,sb:1,bc:gray`)
- `ColumnRegion.containerStyle` stores container-level style (`ColumnStyleData`)
- `.columns-container` uses `display: flex; flex-direction: row` in CSS
- `widthPercent` on each column controls horizontal sizing via `flex: 0 0 calc(X% - ...)`
- Resize handles sit between columns for horizontal drag resizing
- Context menu has a "Parent" section for container-level styling
- Reading view renders the same structure

## Design: Container-level `layout` token

### Syntax

A new token `l:stack` (or `l:row` for explicit default) on `col-start`:

```
%% col-start:l:stack %%          ← vertical layout
%% col-start:l:row %%            ← explicit horizontal (default)
%% col-start:l:stack,sb:1 %%     ← vertical + styled
```

### Data Model Changes

**`ColumnRegion`** gets a new field:
```ts
layout?: "row" | "stack";   // undefined = "row" (default)
```

This lives on `ColumnRegion` directly (NOT inside `ColumnStyleData`), because it's a structural property that affects rendering logic, not just CSS variables. This keeps `ColumnStyleData` purely visual.

## Files to Change

### 1. `types.ts` — Add `layout` to `ColumnRegion`
- Add `layout?: "row" | "stack"` field to the `ColumnRegion` interface

### 2. `parser.ts` — Parse & serialize `l:` token
- **`parseStartPayload`**: Extract `l:row` or `l:stack` token from the col-start payload and return it alongside `containerStyle`. Currently returns only `ColumnStyleData | undefined`. Change to return `{ containerStyle?, layout? }`.
- **`serializeStartPayload`**: If `layout` is `"stack"`, include `l:stack` in the output tokens.
- **`findColumnRegions`**: Store the parsed `layout` on each `ColumnRegion`.
- **`serializeColumns`**: Accept optional `layout` parameter and pass it to `serializeStartPayload`.

### 3. `column-style.ts` — No changes needed
Layout is structural, not a CSS-variable style. No changes here.

### 4. `layout.css` — Add `.columns-stacked` CSS
- New modifier class `.columns-container.columns-stacked`:
  - `flex-direction: column`
  - `.column-item` gets `flex: none; width: 100%` (ignore `widthPercent`)
- Resize handles hidden in stacked mode (no horizontal resizing makes sense)
- Separator visual becomes horizontal (border-top instead of border-left)

### 5. `column-renderer.ts` — Apply layout class + skip resizers
- In `buildColumns` and `renderNestedRegion`:
  - If `region.layout === "stack"`, add `.columns-stacked` class to container
  - Skip `buildResizeHandle` calls (no horizontal resizing in stack mode)
  - Skip `flex` sizing on column items (CSS handles it via `.columns-stacked .column-item`)
  - `buildSeparatorElement` — in stacked mode, separators become horizontal dividers between rows (change class or CSS handles it)

### 6. `reading-view.ts` — Apply layout class
- In `renderColumnsRegion`: if `region.layout === "stack"`, add `.columns-stacked` to containerEl
- Skip separator elements or let CSS handle their orientation

### 7. `style-context-menu.ts` — Add layout toggle in Parent section
- In the "Parent" collapsible section of `renderPopoverContent`, add a layout select/toggle:
  - Label: "Layout"
  - Options: "Row" (default) / "Stack"
- The toggle calls a new `patchLayoutAndRerender` that updates `region.layout` and dispatches
- Need to thread `layout` through `PopoverRenderState` and `ColumnStyleContextMenuData`

### 8. `column-serializer.ts` — Thread `layout` through dispatch
- `dispatchUpdate` currently takes `region, columns, view, containerStyle?`. Add optional `layout?` parameter.
- All callers that pass `containerStyle` may also pass `layout`.

### 9. `column-drag.ts` — No changes needed
Drag/drop moves columns between containers; it doesn't care about layout direction. The visual drop indicators (before/after) work the same way conceptually.

## What Does NOT Change

- **`ColumnData`** — individual column data is unchanged. `widthPercent` is still stored but ignored in stack mode.
- **`ColumnStyleData`** — purely visual styles, unaffected.
- **Drag & drop** — reordering columns within a container works the same (just visually vertical instead of horizontal).
- **Context menu column/separator styling** — all per-column styles still apply.
- **Nested columns** — a stacked parent can contain row children and vice versa.
- **Editor suggest / editing** — unaffected.

## Behavioral Details

- **Resize handles**: Hidden in stack mode (CSS `display: none` on `.columns-stacked .column-resize-handle`). Columns in stack mode are always full-width.
- **`widthPercent`**: Preserved in the data but not applied to DOM in stack mode. If user switches back to row, widths are restored.
- **Separators**: In stack mode, the existing vertical separator CSS becomes a horizontal line between stacked items. This is handled purely in CSS by rotating the separator visual.
- **Drag indicators**: The existing `column-drop-before` / `column-drop-after` pseudo-elements switch from left/right placement to top/bottom placement in stack mode (CSS change).
- **"Add column" button**: Label stays "Add column" — it adds another row in stacked mode, which is conceptually the same operation.

## Implementation Order

1. `types.ts` + `parser.ts` — data model + serialization (foundation)
2. `layout.css` — stacked CSS rules
3. `column-renderer.ts` + `reading-view.ts` — apply layout class, skip resizers
4. `column-serializer.ts` — thread layout through dispatch
5. `style-context-menu.ts` — UI toggle in Parent section
6. Build + test
