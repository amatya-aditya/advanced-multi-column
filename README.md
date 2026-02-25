<div align="center">
  <a href="https://github.com/amatya-aditya/obsidian-rss-dashboard" target="_blank">
    <img src="https://github.com/amatya-aditya/advanced-multi-column/blob/master/assets/amclogo.png" alt="AMC Logo" width="100%" />
  </a>
</div>

<div align="center">

# Advanced Multi Column

Create interactive, nested multi-column layouts in Obsidian using simple Markdown markers.

Columns render in both **Live Preview** and **Reading View** while keeping your notes in plain text.

</div>

<p align="center">
  <a href="https://github.com/amatya-aditya/advanced-multi-column/releases/latest">
    <img src="https://img.shields.io/github/v/release/amatya-aditya/advanced-multi-column?style=flat-square&color=573E7A&label=release">
  </a>
  <a href="https://github.com/amatya-aditya/advanced-multi-column/blob/main/LICENSE">
    <img src="https://img.shields.io/github/license/amatya-aditya/advanced-multi-column">
  </a>
  <img src="https://img.shields.io/github/downloads/amatya-aditya/advanced-multi-column/total">
</p>

<p align="center">
  <a href="#features">Features</a> &bull;
  <a href="./docs/releases/usage.md">Usage</a> &bull;
  <a href="./docs/releases/legacy-usage.md">Legacy Usage</a> &bull;
  <a href="#quick-start">Quick Start</a> &bull;
  <a href="#syntax-reference">Syntax</a> &bull;
  <a href="#installation">Installation</a> &bull;
  <a href="#troubleshooting">Troubleshooting</a>
</p>

<!-- Replace with actual screenshots once captured from docs/releases/usage.md examples -->
<!-- ## Screenshots -->

## Features

- **Marker-based syntax** — `%% col-start %%`, `%% col-break %%`, `%% col-end %%`
- **Live Preview + Reading View** — renders in both modes, toggleable independently
- **Nested columns** — columns inside columns, unlimited depth
- **Drag to reorder** — grab handle or Alt+drag to rearrange columns
- **Resize by dragging** — drag the vertical divider between columns
- **Right-click style popover** — per-column and container styling
- **Inline editing** — click to edit with live markdown preview
- **Wikilink autocomplete** — `[[` triggers file suggestions inside column editors
- **Image paste** — paste images to auto-save and insert `![[image.png]]`
- **Style tokens** — portable styling via marker parameters (`b:`, `bc:`, `t:`, `sb:`, `hd:`)
- **Quick add/remove** — `+` / `x` buttons in each column header
- **Global settings** — default layout, colors, borders, dividers

## Quick Start

1. Open the command palette and run **Insert 2-wide layout**.
2. Click inside each column preview area to edit.
3. Drag the vertical divider between columns to resize.
4. Right-click a column to open style options.

### Basic syntax

```md
%% col-start %%
%% col-break %%
Left column content
%% col-break %%
Right column content
%% col-end %%
```

> Content between `%% col-start %%` and the first `%% col-break %%` is ignored.

## Syntax Reference

Markers must be on their own lines.

### Container markers

| Marker | Purpose |
|--------|---------|
| `%% col-start %%` | Start a column block |
| `%% col-end %%` | End a column block |

`col-start` accepts optional container style tokens:

```md
%% col-start:b:secondary,bc:accent,sb:1 %%
```

### Column markers

| Marker | Purpose |
|--------|---------|
| `%% col-break %%` | Start a new column (equal width) |
| `%% col-break:40 %%` | Start a column at 40% width |
| `%% col-break:w:40 %%` | Explicit width form |

Width and style tokens can be combined:

```md
%% col-break:35,b:blue-soft,bc:blue,t:text,sb:1 %%
```

### Style tokens

| Token | Property | Values |
|-------|----------|--------|
| `b:` | Background | `transparent`, `primary`, `secondary`, `alt`, `accent-soft`, `red-soft`, `orange-soft`, `yellow-soft`, `green-soft`, `cyan-soft`, `blue-soft`, `pink-soft` |
| `bc:` | Border color | `gray`, `accent`, `muted`, `text`, `red`, `orange`, `yellow`, `green`, `cyan`, `blue`, `pink` |
| `t:` / `tc:` | Text color | Same as border color |
| `sb:` | Show border | `1`/`0`, `true`/`false`, `yes`/`no`, `on`/`off` |
| `h:` / `hd:` | Horizontal dividers | Same as show border |

## Nested Layout Example

```md
%% col-start %%
%% col-break:40 %%
# Column 1
Top-level content.
%% col-break:60 %%
# Parent column
This column contains nested columns.

%% col-start %%
%% col-break %%
## Child column 1
Nested content.
%% col-break %%
## Child column 2
Nested content.
%% col-end %%
%% col-end %%
```

## Commands

| Command | Description |
|---------|-------------|
| Insert 2-wide layout | Two equal columns |
| Insert 3-wide layout | Three equal columns |
| Insert 4-wide layout | Four equal columns |
| Insert layout (custom count) | Uses default count from settings |
| Insert nested layout | Parent with child columns template |

## Editing

- **Click** preview content to enter edit mode
- **Tab** / **Shift+Tab** — cycle through columns
- **Esc** — commit and exit edit mode
- **`[[`** — wikilink suggestions
- **Ctrl/Cmd+B** — bold, **Ctrl/Cmd+I** — italic
- **Paste image** — auto-saves and inserts `![[...]]`
- **Drag handle** or **Alt+drag** — reorder columns
- **`+`** — add column, **`x`** — remove column

## Right-Click Style Popover

Right-click any column to:
- Style current column (background, border, text, toggles)
- Style parent container
- Add column / add child column
- Reset styles (column or parent)
- Clear all styles recursively

## Settings

**Settings → Community Plugins → Advanced Multi Column**

- **General** — enable/disable live preview and reading view, default column count, minimum column width, drag handles
- **Appearance** — style target (all or specific column), container background/border/radius/text, vertical and horizontal divider configuration

## Installation

### Community Plugins

1. Open **Settings → Community Plugins**.
2. Disable **Restricted mode**.
3. Search for **Advanced Multi Column**.
4. Install and enable.

### Manual

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/amatya-aditya/advanced-multi-columns/releases).
2. Create folder: `.obsidian/plugins/advanced-multi-column/`
3. Copy the files into that folder.
4. Reload Obsidian and enable the plugin.


## Legacy Syntax

CSS for older callout-based layouts (`[!col]` / `[!col-md-*]`) is supported. Marker syntax is recommended for new notes for extended features.

Use nested sibling callouts in this format:

```md
> [!col]
> > [!col-md]
> > Left column
>
> > [!col-md]
> > Right column
```

If `[!col-md]` appears as plain text, the nested callout structure is malformed.

## Development

```bash
npm install
npm run dev      # watch mode
npm run build    # production
```

## Other Plugins

- [RSS Dashboard](https://github.com/amatya-aditya/obsidian-rss-dashboard)
- [Media Slider](https://github.com/amatya-aditya/obsidian-media-slider)
- [Zen Space](https://github.com/amatya-aditya/obsidian-zen-space)

## Support

If you find this plugin useful, consider supporting development:

<p align="center">
  <a href="https://www.buymeacoffee.com/amatya_aditya" target="_blank">☕ Buy me a coffee</a>
  &nbsp;&nbsp;&bull;&nbsp;&nbsp;
  <a href="https://ko-fi.com/Y8Y41FV4WI" target="_blank">Ko-fi</a>
  &nbsp;&nbsp;&bull;&nbsp;&nbsp;
  <a href="https://discord.gg/9bu7V9BBbs" target="_blank">Discord</a>
</p>

## Privacy

This plugin runs locally in your vault and does not include telemetry.
