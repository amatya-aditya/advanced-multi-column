# 07 - Commands and templates

This page lists every insert command and template.

## Command palette commands

| Command | What it inserts |
|---|---|
| `Insert 2-wide layout` | Two equal columns |
| `Insert 3-wide layout` | Three equal columns |
| `Insert 4-wide layout` | Four equal columns |
| `Insert layout (custom count)` | Uses `Default column count` setting |
| `Insert nested layout (parent + children)` | Outer + child block starter |

## Editor context menu templates

Open editor context menu and use `Insert layout` submenu.

Templates:

1. Nested columns
2. Sidebar + content
3. Stacked + wide
4. Cornell notes
5. Kanban board
6. Info card

## Example outputs

### Stacked + wide

```md
%% col-start %%
%% col-break:40,stk:1,b:secondary %%
Stacked row 1
%% col-break:stk:1,b:secondary %%
Stacked row 2
%% col-break:stk:1,b:secondary %%
Stacked row 3
%% col-break:60,b:secondary %%
Wide column
%% col-end %%
```

### Sidebar + content

```md
%% col-start %%
%% col-break:30,b:secondary %%
Sidebar
%% col-break:70,b:secondary %%
Main content
%% col-end %%
```

### Nested columns

```md
%% col-start %%
%% col-break:40,b:secondary %%
Top-level content.
%% col-break:60,b:secondary %%
This column contains nested columns.

%% col-start %%
%% col-break:b:secondary %%
Child column 1
%% col-break:b:secondary %%
Child column 2
%% col-end %%
%% col-end %%
```

