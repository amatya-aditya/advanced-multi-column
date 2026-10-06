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

![Row layout: three columns, one with an image](https://raw.githubusercontent.com/amatya-aditya/advanced-multi-column/master/assets/demo-plain-image.png)

## B. Container stack layout (`l:stack`)

All top-level columns render vertically. Stacked columns are spaced 8px apart, so bordered or tinted columns don't touch.

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

![Container stack layout: every column on its own row](https://raw.githubusercontent.com/amatya-aditya/advanced-multi-column/master/assets/demo-stacked-layout.png)

## C. Per-group stacking (`stk:<id>`)

Only consecutive columns with same stack ID are stacked together. To stack a column with its neighbour from the menu, right-click it and turn on **Stack with next column** (This column tab).

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

![Per-group stacking: three stacked rows beside a wide column](https://raw.githubusercontent.com/amatya-aditya/advanced-multi-column/master/assets/demo-stacked.png)

![Cornell notes built with a stacked group](https://raw.githubusercontent.com/amatya-aditya/advanced-multi-column/master/assets/demo-cornell.png)

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

![Nested columns inside the right column](https://raw.githubusercontent.com/amatya-aditya/advanced-multi-column/master/assets/demo-nested.png)

## E. Split stacked subset into separate group

Scenario:

1. You have `1 | (3,4,5,6,7 stacked:1)`.
2. You select `6,7`.
3. Turn `Stack selected columns` off.

Result:

1. `3,4,5` remain stacked together (group 1).
2. `6,7` become their own separate stacked group (group 2).
3. Final shape matches `1 | (3,4,5 stacked:1) | (6,7 stacked:2)`.

Notes:

1. This transform applies when selected columns are a contiguous run within a larger stack group.
2. It requires at least one non-selected column remaining in the original group.
3. If the entire group is selected, normal unstack is used (stack flags are cleared).

