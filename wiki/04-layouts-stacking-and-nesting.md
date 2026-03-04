# 04 - Layouts, stacking, and nesting

This page covers advanced layout composition.

## A. Row layout (default)

Columns render side by side.

```md
%% col-start %%
%% col-break %%
Left
%% col-break %%
Right
%% col-end %%
```

## B. Container stack layout (`l:stack`)

All top-level columns render vertically.

```md
%% col-start:l:stack %%
%% col-break %%
Row 1
%% col-break %%
Row 2
%% col-break %%
Row 3
%% col-end %%
```

## C. Per-group stacking (`stk:<id>`)

Only consecutive columns with same stack ID are stacked together.

```md
%% col-start %%
%% col-break:40,stk:1 %%
Stacked top
%% col-break:stk:1 %%
Stacked middle
%% col-break:stk:1 %%
Stacked bottom
%% col-break:60 %%
Wide column
%% col-end %%
```

## D. Nested columns inside a column

1. Create outer block.
2. Put inner `col-start ... col-end` block inside one outer column.

```md
%% col-start %%
%% col-break:35 %%
Sidebar
%% col-break:65 %%
Parent column content

%% col-start %%
%% col-break %%
Child 1
%% col-break %%
Child 2
%% col-end %%

More parent content
%% col-end %%
```

## E. Unstack subset into nested row (new behavior)

Scenario:

1. You have `1 | (2,3,4 stacked)`.
2. You select `3,4`.
3. Toggle `Stacked` off.

Result:

1. `3,4` are moved into a nested row block inside `2`.
2. `2` becomes regular (not stacked).
3. Final shape matches `1 | 2(with nested row 3,4)`.

Notes:

1. This transform applies when selected columns are a contiguous stacked run.
2. It requires an immediate stacked sibling on the left (host column).
3. If conditions do not match, normal unstack is used (stack flags are cleared only).

