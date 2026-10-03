# 06 - Styling and context menu

All styling actions are available from the right-click popover.

## Open style popover

1. Right-click a column in Live Preview.
2. The header names the column and has quick actions: edit, add column, add nested columns, delete.
3. Switch between the **Column** and **Block** tabs to style the column or the whole column block.

The popover always shows what is currently rendered, including values that come from the global **Appearance** settings (block border, background, vertical dividers). Changing a value writes it to the markers; picking the default again removes it, so the block follows the global settings again.

## Apply style to one or multiple columns

1. For multi-select: `Ctrl/Cmd` click columns first.
2. Right-click one selected column.
3. Style changes apply to selected set.

## Column tab

1. `Background`.
2. `Text color` — also applies to links (internal, external, tags) within the column.
3. `Border` toggle + color.
4. `Accent stripe` (callout-style left border).
5. `Stacked` toggle.
6. `Separator after` (or `Separator below` inside a stack) — toggle; when on, choose line style (`solid`, `dashed`, `dotted`, `double`, or a custom `Character`), color and width. Turning it off also hides the global vertical divider after this column (`sep:0`). Not shown for the last column.

## Block tab

1. `Layout` (`Side by side` or `Stacked`).
2. `Background`.
3. `Text color`.
4. `Border` toggle + color.

## Reset and clear actions

1. `Reset column` / `Reset block` clears the styles of the current tab.
2. `Clear all styles` removes style tokens recursively from the block and nested blocks.

## Custom palette colors (CSS snippet)

Every palette color is a CSS variable, so a theme or CSS snippet can recolor it without `!important`:

```css
body {
	--amc-bg-blue-soft: rgba(80, 120, 200, 0.18); /* backgrounds: --amc-bg-<name> */
	--amc-color-blue: #4f7bd9;                     /* text/border/separator colors: --amc-color-<name> */
	--amc-stripe-blue-soft: #4f7bd9;               /* header left-border stripe: --amc-stripe-<background> */
}
```

Names match the style tokens (`b:blue-soft` → `--amc-bg-blue-soft`, `bc:red` → `--amc-color-red`).

## Example: style by markers (portable)

```md
%% col-start:b:primary,bc:muted,sb:1 %%
%% col-break:50,b:blue-soft,bc:blue,t:text,sb:1,sep:1,sc:blue,ss:dashed,sw:2 %%
Left styled pane
%% col-break:50,b:green-soft,bc:green,t:text,sb:1 %%
Right styled pane
%% col-end %%
```

