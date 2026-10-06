# Contributing to Advanced Multi Column

Thanks for helping improve the plugin! Bug reports, ideas, documentation fixes and code are all welcome.

## Report a bug or suggest a feature

Open an [issue](https://github.com/amatya-aditya/advanced-multi-column/issues/new/choose) and pick the **Bug report** or **Feature request** template. For bugs, these details help the most:

- Your Obsidian version, the plugin version, and your platform (Windows, macOS, Linux, iOS, Android).
- Your theme and any CSS snippets. Many layout issues only appear with a particular theme. Please check whether the bug also happens with the default theme and snippets turned off.
- Whether it happens in **Live Preview**, **Reading view**, or both.
- The markdown of a small column block that shows the problem, and a screenshot.

## Set up a development vault

Use a separate test vault, not your everyday one, while you work on the plugin.

1. Clone the repository into the test vault's plugin folder. The folder name must match the plugin ID:

   ```bash
   cd <your-test-vault>/.obsidian/plugins
   git clone https://github.com/amatya-aditya/advanced-multi-column.git
   cd advanced-multi-column
   ```

2. Install dependencies and the git hooks (Node.js 20 or newer):

   ```bash
   npm install
   npm run setup:hooks
   ```

3. Start the watch build:

   ```bash
   npm run dev
   ```

   It rebuilds `main.js` and `styles.css` whenever a file in `src/` changes.

4. In Obsidian, turn on the plugin in **Settings → Community plugins**. After a rebuild, reload it: turn it off and on again, or restart Obsidian. A running Obsidian keeps the plugin code it loaded at startup.

## Project layout

| Path | What it contains |
| --- | --- |
| `src/main.ts` | Plugin lifecycle: loading, commands, settings. Keep feature logic out of it. |
| `src/column/core/` | Parsing and writing column markers, styles, footnotes. No DOM. |
| `src/column/cm/` | The CodeMirror extension that renders column blocks in Live Preview. |
| `src/column/render/` | Building the column DOM: toolbar, drag, resize, style menu. |
| `src/column/editor/` | The embedded editor used to edit a column in place. |
| `src/column/reading-view.ts` | Reading view and PDF export rendering. |
| `src/moc/` | Map of Content (MOC) templates and syncing. |
| `src/settings-tab/` | The settings tab. |
| `src/styles/` | Source CSS, bundled into `styles.css` by the build. |
| `wiki/` | User documentation, synced to the GitHub wiki from `master`. |

## Branches and pull requests

- `master` holds released code. Releases are tagged from it.
- `dev` collects changes for the next release.

Open pull requests against **`dev`**. Keep each pull request to one topic. In the description, say what changed, why, and how you tested it, and link the issue it addresses, for example `Fixes #27`.

## Commit messages

Commits use [Conventional Commits](https://www.conventionalcommits.org/). The `commit-msg` hook rejects other formats.

```text
<type>(optional-scope): <subject>
```

Types: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `perf`, `style`, `ci`, `build`, `revert`.

```text
fix: keep the column editor in place when themes style tables
feat: ask before removing a column with content
docs: describe footnotes in columns
```

Make one commit per logical change, and explain *why* in the body when it isn't obvious. `npm run commit` can help you write a message.

## Checks

The hooks installed by `npm run setup:hooks` run:

| When | Check |
| --- | --- |
| Commit | `npm run lint` (ESLint, including the Obsidian plugin rules) |
| Push | `npm run build` (type check and production build) |

CI runs the same build and lint on Node.js 20 and 22 for every push and pull request. Please make sure both pass locally before you open a pull request.

## Coding guidelines

- **TypeScript.** Edit files in `src/`, never the generated `main.js`.
- **Built CSS.** Edit CSS in `src/styles/`. `styles.css` is generated, but it is committed, so commit the rebuilt file together with your CSS change. Run `npm run build` first; the watch build writes an unminified file. `main.js` is not committed.
- **Work with any theme.** Don't add rules for a specific theme, plugin or snippet. If a theme breaks the layout, find the general cause (often a theme rule that also matches the plugin's elements) and fix that for all themes.
- **Avoid `!important`.** Win with more specific selectors instead. The few existing exceptions are commented.
- **Desktop and mobile.** The plugin is not desktop-only, so don't use Node.js or Electron APIs.
- **Clean up.** Register DOM events, intervals and workspace events with Obsidian's `register*` helpers, so disabling the plugin leaves nothing behind.
- **Popout windows.** Notes can open in separate windows. Use the element's own `el.doc` / `el.win` instead of the global `document` and `window`. Use `activeDocument` only when there is no element to go by. It is whichever window has focus at that moment, which isn't always the one you mean.
- **Keep files focused.** Put new features in their own module rather than growing `main.ts` or very large files.

## Testing your change

There is no automated UI test suite yet, so test by hand in your test vault:

- **Both views:** **Live Preview** and **Reading view**, with the default theme and at least one popular community theme.
- **Nesting and layouts:** nested columns and stacked layouts, if your change touches layout.
- **Mobile:** use Obsidian's mobile emulation (run `app.emulateMobile(true)` in the developer console; `false` turns it off), or a real device.
- **Editing:** editing a column, then switching to another note or closing the tab, if your change touches editing. Unsaved column text must never be lost.

## Documentation

If your change affects how people use the plugin, update the matching page in `wiki/` (and the README feature list if it adds a feature). The maintainer updates `CHANGELOG.md` when releasing.

## Releases

Releases are made by the maintainer: `dev` is merged into `master`, the version is bumped, and a tag starts the release workflow, which builds and attaches `main.js`, `manifest.json` and `styles.css`.

## License

By contributing, you agree that your contributions are licensed under the project's [license](LICENSE).
