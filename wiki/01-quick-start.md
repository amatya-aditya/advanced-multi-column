# 01 - Quick start

This page gets you from zero to a working layout in a few minutes.

## Goal

Create, edit, resize, and style your first column block.

## Step 1: Insert a layout

1. Open Command Palette.
2. Run `Insert 2-wide layout`.

You will get markers like this:

```md
%% col-start %%
%% col-break %%
Column 1
%% col-break %%
Column 2
%% col-end %%
```

## Step 2: Edit content in place

1. Click inside a column preview.
2. Type content.
3. Press `Esc` to commit.

Tip: `Tab` moves to the next column editor, `Shift+Tab` moves to previous.

## Step 3: Resize columns

1. Hover between two columns.
2. Drag the vertical resize handle.
3. Release mouse to apply width.

## Step 4: Reorder columns

1. Drag from the column grip handle (`⋮⋮`) in the column header.
2. Drop before/after another column.

Alternative: hold `Alt` first, then mouse-down and drag a column body.

## Step 5: Apply styles

1. Right-click a column.
2. Change `Background`, `Border`, `Text color`, or `Separator`.
3. Close the popover.

## Step 6: Add/remove columns quickly

1. Click `+` in a column header to add a column to the right.
2. Click `×` in a column header to remove that column.

## A clean starter example

```md
%% col-start %%
%% col-break:35 %%
## Notes
- Item A
- Item B
%% col-break:65 %%
## Main content
Write your main note here.
%% col-end %%
```
