# 02 - Syntax reference

This is the exact marker syntax used by the plugin.

## Rules

1. Markers must be on their own lines.
2. A block starts at `%% col-start %%` and ends at `%% col-end %%`.
3. Content before the first `%% col-break %%` in a block is ignored.

## Core markers

| Marker | Purpose |
|---|---|
| `%% col-start %%` | Start a column block |
| `%% col-break %%` | Start a new column |
| `%% col-end %%` | End the column block |

## Width syntax

Use either of these forms:

```md
%% col-break:40 %%
%% col-break:w:40 %%
```

## Stack syntax

Use `stk:<id>` on consecutive columns to stack vertically as one group.

```md
%% col-break:40,stk:1 %%
%% col-break:stk:1 %%
%% col-break:stk:1 %%
```

## Container tokens (`col-start`)

You can attach layout/style tokens to `col-start`.

```md
%% col-start:l:stack,b:secondary,bc:accent,sb:1 %%
```

## Column tokens (`col-break`)

You can attach width/stack/style tokens to each `col-break`.

```md
%% col-break:35,stk:1,b:blue-soft,bc:blue,t:text,sb:1,sep:1,sc:blue,ss:dashed,sw:2 %%
```

## Token reference

| Token | Meaning | Values |
|---|---|---|
| `l:` | Container layout | `row`, `stack` |
| `w:` or first number | Column width percent | `1..100` |
| `stk:` | Stack group ID | positive number (`1`, `2`, ...) |
| `b:` | Background | `transparent`, `primary`, `secondary`, `alt`, `accent-soft`, `red-soft`, `orange-soft`, `yellow-soft`, `green-soft`, `cyan-soft`, `blue-soft`, `pink-soft` |
| `bc:` | Border color | `gray`, `accent`, `muted`, `text`, `red`, `orange`, `yellow`, `green`, `cyan`, `blue`, `pink` |
| `t:` / `tc:` | Text color | same palette as `bc:` |
| `sb:` | Show border | `1/0`, `true/false`, `yes/no`, `on/off` |
| `h:` / `hd:` | Horizontal dividers | same boolean values as `sb:` |
| `sep:` | Show separator | same boolean values as `sb:` |
| `sc:` | Separator color | same palette as `bc:` |
| `ss:` | Separator style | `solid`, `dashed`, `dotted`, `double`, `custom` |
| `sw:` | Separator width | `1..8` |
| `sx:` | Custom separator chars | up to 3 chars |

## Complete example

```md
%% col-start:b:primary,bc:muted,sb:1 %%
%% col-break:30,b:alt,bc:gray,t:text,sb:1,sep:1,sc:gray,ss:solid,sw:1 %%
Sidebar
%% col-break:70,b:transparent %%
Main content
%% col-end %%
```

