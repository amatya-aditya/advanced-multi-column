# 07 - Commands and templates

This page lists every insert command and template.

Every layout is available both in the command palette and in the editor context menu.

| Command palette | Context menu | What it inserts |
|---|---|---|
| `Insert 2-wide layout` | `Insert 2 columns` | Two equal columns |
| `Insert 3-wide layout` | `Insert 3 columns` | Three equal columns |
| `Insert 4-wide layout` | `Insert 4 columns` | Four equal columns |
| `Insert layout (custom count)` | `Insert layout → Default column count` | Uses the `Default column count` setting |
| `Insert nested layout (parent + children)` | `Insert layout → Nested columns` | Outer + child block starter |
| `Insert sidebar + content layout` | `Insert layout → Sidebar + content` | 30/70 sidebar and main column |
| `Insert stacked + wide layout` | `Insert layout → Stacked + wide` | Three stacked rows beside a wide column |
| `Insert Cornell notes layout` | `Insert layout → Cornell notes` | Title, cues and notes |
| `Insert Kanban board layout` | `Insert layout → Kanban board` | Four status columns |

Template columns use the primary background (`b:primary`). Columns added later with `+` also get the primary background, unless **Inherit style on add** copies the neighbor's style.

## Example outputs

### Stacked + wide

```md
%% col-start %%
%% col-break:40,stk:1,b:primary,sb:1 %%
Stacked row 1
%% col-break:stk:1,b:primary,sb:1 %%
Stacked row 2
%% col-break:stk:1,b:primary,sb:1 %%
Stacked row 3
%% col-break:60,b:primary,sb:1 %%
Wide column
%% col-end %%
```

### Sidebar + content

```md
%% col-start %%
%% col-break:30,b:primary %%
Sidebar
%% col-break:70,b:primary %%
Main content
%% col-end %%
```

### Nested columns

```md
%% col-start %%
%% col-break:40,b:primary %%
Top-level content.
%% col-break:60,b:primary %%
This column contains nested columns.

%% col-start %%
%% col-break:b:primary %%
Child column 1
%% col-break:b:primary %%
Child column 2
%% col-end %%
%% col-end %%
```


## MOC (map of content)

| Command palette | Context menu | What it inserts |
|---|---|---|
| `Insert MOC` | `Insert MOC → <template>` | An auto-updating column block of links to the notes a MOC template selects |

MOC templates are set up in **Settings → Advanced Multi Column → MOC**. See [10 - MOC (map of content)](https://github.com/amatya-aditya/advanced-multi-column/wiki/10-moc-map-of-content) for the full guide.
