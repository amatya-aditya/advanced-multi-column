# 06 - Styling and context menu

All styling actions are available from the right-click popover.

## Open style popover

1. Right-click a column in Live Preview.
2. Use sections in the popover to style column and parent container.

## Apply style to one or multiple columns

1. For multi-select: `Ctrl/Cmd` click columns first.
2. Right-click one selected column.
3. Style changes apply to selected set.

## Column style options

1. `Stacked` toggle.
2. `Border` toggle + color.
3. `Background`.
4. `Text color` — also applies to links (internal, external, tags) within the column.

## Separator options

1. `Show separator`.
2. `Style` (`solid`, `dashed`, `dotted`, `double`, `custom`).
3. `Color`.
4. `Width`.
5. `Character` (shown when style is `custom`).

## Parent/container options

1. `Layout` (`Row` or `Stack`).
2. Parent border toggle + color.
3. Parent background.
4. Parent text color.

## Reset and clear actions

1. `Reset` in a section clears only that section's style fields.
2. `Clear all` removes style tokens recursively from parent and nested blocks.

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

