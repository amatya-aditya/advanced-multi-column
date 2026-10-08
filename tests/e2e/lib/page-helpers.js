// Runs inside Obsidian's window (evaluated by obsidian.mjs). Helpers the suites call as
// `call("name", ...args)`. Panes are addressed as "L" and "R" after layout(), or "A" for the
// active pane.
(() => {
	const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
	const panes = {};
	let trace = [];
	const leafOf = (side) => (side === "A" || !panes[side] ? app.workspace.activeLeaf : panes[side]);
	const viewOf = (side) => leafOf(side).view;
	const readingEl = (side) => viewOf(side).containerEl.querySelector(".markdown-reading-view .markdown-preview-view");
	/** The first column block the pane shows (reading view's or live preview's). */
	const shownContainer = (side) => [...viewOf(side).containerEl.querySelectorAll(".columns-container")]
		.find((c) => c.getClientRects().length > 0 && !c.closest(".amc-rv-hidden, .internal-embed"));
	/** A point on `el`, inside the part of it its scroll container shows (not under a header or toggle). */
	/**
	 * Give the main window back the focus after a modal that showed in a window
	 * of its own, as clicking into it would. Until then Obsidian schedules the
	 * main window's rendering on that hidden window, where it never runs.
	 */
	const refocusMain = () => {
		if (activeWindow !== window) window.dispatchEvent(new FocusEvent("focus"));
	};
	const centerOf = (el, clipEl = el.parentElement) => {
		el.scrollIntoView({block: "center"});
		const r = el.getBoundingClientRect();
		const c = clipEl.getBoundingClientRect();
		const top = Math.max(r.top, c.top), bottom = Math.min(r.bottom, c.bottom);
		const left = Math.max(r.left, c.left);
		// Not laid out yet, or not in view: no point to click.
		if (bottom - top < 4 || Math.min(r.right, c.right) - left < 4) return null;
		return {x: Math.round(left + Math.min(30, (Math.min(r.right, c.right) - left) / 2)), y: Math.round((top + bottom) / 2)};
	};

	window.__amcTest = {
		/** One pane (`right` omitted) or left|right panes, each showing a note in a mode. */
		async layout(left, right, leftMode = "source", rightMode = "source") {
			refocusMain();
			const ws = app.workspace;
			const all = ws.getLeavesOfType("markdown");
			const L = all[0] ?? ws.getLeaf(false);
			for (const l of all.slice(1)) l.detach();
			L.history.backHistory = [];
			L.history.forwardHistory = [];
			await L.setViewState({type: "markdown", state: {file: left, mode: leftMode, source: false}});
			panes.L = L;
			delete panes.R;
			if (right) {
				const R = ws.createLeafBySplit(L, "vertical");
				await R.setViewState({type: "markdown", state: {file: right, mode: rightMode, source: false}});
				panes.R = R;
			}
			ws.setActiveLeaf(L, {focus: true});
			for (const v of [L, panes.R]) if (v?.view.editor?.cm) v.view.editor.cm.scrollDOM.scrollTop = 0;
			await sleep(1200);
			return true;
		},
		async open(side, path, mode = "source") {
			await leafOf(side).openFile(app.vault.getAbstractFileByPath(path), {state: {mode, source: false}});
			return true;
		},
		back(side) {
			leafOf(side).history.back();
			return true;
		},
		activeFile: () => app.workspace.getActiveFile()?.path ?? null,
		/** Screen point inside a live preview column (scrolled into view), or null. */
		columnPoint(side, index) {
			const el = viewOf(side).containerEl.querySelectorAll(".amc-columns-host .column-item .column-preview")[index];
			return el ? centerOf(el, viewOf(side).contentEl) : null;
		},
		/** Screen point of a note in the file explorer (scrolled into view). */
		explorerPoint(path) {
			const el = document.querySelector(`.nav-file-title[data-path="${CSS.escape(path)}"]`);
			return el ? centerOf(el, el.closest(".nav-files-container") ?? el.parentElement) : null;
		},
		isEditingColumn: (side) => !!viewOf(side).containerEl.querySelector(".column-item.is-editing"),
		/** What is under a screen point (to explain a click that missed). */
		hitAt(x, y) {
			const el = document.elementFromPoint(x, y);
			if (!el) return "nothing";
			const modal = el.closest(".modal-container, .menu, .popover, .notice");
			return `${el.tagName.toLowerCase()}.${[...el.classList].join(".")}${modal ? ` inside ${modal.className}` : ""}`;
		},
		/** Log every change to a note, in each pane's editor and on disk (to explain a lost edit). */
		startTrace(path) {
			const t0 = performance.now();
			const lines = (x) => x.split("\n").filter((l) => /^\S+ (left|right)/.test(l)).join(" | ");
			trace = [];
			this.note = (m) => { trace.push(`${Math.round(performance.now() - t0)} ${m}`); return true; };
			app.workspace.getLeavesOfType("markdown").forEach((leaf, i) => {
				const cm = leaf.view.editor.cm;
				const orig = cm.dispatch.bind(cm);
				cm.dispatch = (...a) => {
					const before = cm.state.doc.toString();
					orig(...a);
					const after = cm.state.doc.toString();
					if (before !== after) this.note(`pane${i}: ${lines(after)} via ${new Error().stack.split("\n").slice(2, 7).map((s) => s.trim().split(" ")[1]).join("<")}`);
				};
			});
			app.vault.on("modify", async (f) => { if (f.path === path) this.note(`disk: ${lines(await app.vault.adapter.read(path))}`); });
			return true;
		},
		note: () => true,
		trace: () => trace.join("\n"),
		/** The text of every open column editor, per pane (to explain a lost draft). */
		openColumnEditors: () => JSON.stringify(app.workspace.getLeavesOfType("markdown").map((l) => [...l.view.containerEl.querySelectorAll(".column-item.is-editing .cm-content")].map((c) => c.innerText))),
		/** Columns of the pane's first shown column block that stick out of its border box. */
		columnsOutside(side) {
			const c = shownContainer(side);
			const box = c.getBoundingClientRect();
			return [...c.querySelectorAll(":scope > .column-item")].filter((e) => {
				const r = e.getBoundingClientRect();
				return r.left < box.left + 1 || r.right > box.right - 1 || r.top < box.top + 1 || r.bottom > box.bottom - 1;
			}).map((e) => e.innerText.trim());
		},
		/** The lines drawn between the columns of the pane's first shown column block, in order. */
		dividers(side) {
			const c = shownContainer(side);
			const lines = [];
			for (const el of c.children) {
				const s = el.classList.contains("column-separator-visual") ? getComputedStyle(el) : getComputedStyle(el, "::before");
				if (!el.classList.contains("column-separator-visual") && (s.content === "none" || s.display === "none")) continue;
				const top = parseFloat(s.borderTopWidth) > 0 && s.borderTopStyle !== "none";
				const left = parseFloat(s.borderLeftWidth) > 0 && s.borderLeftStyle !== "none";
				if (!top && !left) continue;
				const color = top ? s.borderTopColor : s.borderLeftColor;
				lines.push(`${top ? "horizontal" : "vertical"}${color === "rgb(239, 68, 68)" ? " red" : ""}`);
			}
			return lines;
		},
		markdownLeafCount: () => app.workspace.getLeavesOfType("markdown").length,
		/** Focus and modal state, to explain a key press that did nothing. */
		focusState() {
			const a = document.activeElement;
			return `hasFocus=${document.hasFocus()} active=${a?.closest(".amc-embedded-editor") ? "column editor" : `${a?.tagName}.${a?.className}`.slice(0, 40)} modal=${!!document.querySelector(".modal-container, .prompt")}`;
		},
		/** The keyboard focus is in a column editor of this pane. */
		focusInColumnEditor: (side) => !!document.activeElement?.closest(".amc-embedded-editor") && viewOf(side).containerEl.contains(document.activeElement),
		quickSwitcherOpen: () => !!app.internalPlugins.plugins.switcher.instance.activeModal?.containerEl.isConnected,
		/** Type into the open quick switcher and open its first match, as Enter does. */
		async quickSwitch(query) {
			const modal = app.internalPlugins.plugins.switcher.instance.activeModal;
			modal.inputEl.value = query;
			modal.inputEl.dispatchEvent(new Event("input"));
			for (let i = 0; i < 20 && !modal.chooser.values?.length; i++) await sleep(50);
			if (!modal.chooser.values?.length) return false;
			modal.chooser.useSelectedItem(new KeyboardEvent("keydown", {key: "Enter"}));
			refocusMain();
			return true;
		},
		closeModals() {
			const text = [...document.querySelectorAll(".modal-container")].map((m) => m.innerText.slice(0, 120)).join(" | ");
			document.querySelectorAll(".modal-container .modal-close-button").forEach((b) => b.click());
			app.internalPlugins.plugins.switcher.instance.activeModal?.close();
			return text;
		},
		read: (path) => app.vault.adapter.read(path),
		async write(path, text) {
			await app.vault.adapter.write(path, text);
			await sleep(600);
			return true;
		},
		async setting(key, value) {
			const p = app.plugins.plugins["advanced-multi-column"];
			p.settings[key] = value;
			await p.saveSettings();
			await sleep(400);
			return true;
		},
		/** Set the cursor of a pane's editor to the end of the first line containing `needle`. */
		cursorAfter(side, needle) {
			const ed = viewOf(side).editor;
			for (let i = 0; i < ed.lineCount(); i++) {
				if (ed.getLine(i).includes(needle)) {
					ed.setCursor({line: i, ch: ed.getLine(i).length});
					ed.focus();
					return true;
				}
			}
			return false;
		},
		/** Set the cursor of a pane's editor inside the first occurrence of `needle`. */
		cursorInside(side, needle) {
			const ed = viewOf(side).editor;
			for (let i = 0; i < ed.lineCount(); i++) {
				const at = ed.getLine(i).indexOf(needle);
				if (at >= 0) {
					ed.setCursor({line: i, ch: at + Math.floor(needle.length / 2)});
					ed.focus();
					return true;
				}
			}
			return false;
		},
		/** Replace the first line containing `needle` in a pane's editor and save the note. */
		async editLine(side, needle, replacement) {
			const view = viewOf(side);
			const ed = view.editor;
			for (let i = 0; i < ed.lineCount(); i++) {
				if (ed.getLine(i).includes(needle)) {
					ed.replaceRange(replacement, {line: i, ch: 0}, {line: i, ch: ed.getLine(i).length});
					await view.save();
					return true;
				}
			}
			return false;
		},
		editorText: (side) => viewOf(side).editor.cm.contentDOM.innerText,
		/** What a pane's reading view shows. */
		reading(side) {
			const pv = readingEl(side);
			const host = pv.querySelector(":scope > .amc-reading-columns-host");
			const wrapper = host?.querySelector(".columns-rv-wrapper");
			const r = pv.getBoundingClientRect();
			let top = "";
			for (const h of pv.querySelectorAll(".columns-rv-wrapper h1, .columns-rv-wrapper h2, .markdown-preview-sizer > div > h1, .markdown-preview-sizer > div > h2")) {
				if (h.closest(".amc-rv-hidden, .internal-embed")) continue;
				const b = h.getBoundingClientRect();
				if (b.height && b.bottom > r.top + 5) { top = h.textContent; break; }
			}
			return {
				file: viewOf(side).file?.path,
				layer: wrapper?.dataset.columnsSourcePath ?? null,
				pending: !!host?.classList.contains("amc-rv-pending"),
				active: pv.classList.contains("amc-reading-columns-active"),
				scrollTop: Math.round(pv.scrollTop),
				top,
				text: (wrapper ?? pv).innerText,
			};
		},
		scrollReading(side, top) {
			readingEl(side).scrollTop = top;
			return true;
		},
		/** Tag the reading layer's blocks so a later call can tell reused blocks from rebuilt ones. */
		markBlocks(side) {
			const w = readingEl(side).querySelector(".columns-rv-wrapper");
			[...w.children].forEach((b, i) => { b.dataset.e2eBlock = String(i); });
			return w.children.length;
		},
		blockIds(side) {
			const w = readingEl(side).querySelector(".columns-rv-wrapper");
			return [...w.children].filter((c) => !c.classList.contains("amc-footnotes")).map((b) => b.dataset.e2eBlock ?? "new");
		},
		footnoteRefs(side) {
			return [...readingEl(side).querySelectorAll(".columns-rv-wrapper sup.footnote-ref a")].map((a) => a.textContent);
		},
		/**
		 * Record, every animation frame for `ms`, which note's column layer a pane's reading
		 * view shows and whether Obsidian's own rendering is visible. Resolves with the samples.
		 */
		watchReading(side, ms) {
			const pv = () => readingEl(side);
			const samples = [];
			const t0 = performance.now();
			return new Promise((resolve) => {
				const sample = () => {
					try {
						const p = pv();
						const r = p.getBoundingClientRect();
						const vis = (el) => { const b = el.getBoundingClientRect(); return b.height > 0 && b.bottom > r.top && b.top < r.bottom && getComputedStyle(el).visibility !== "hidden"; };
						const host = p.querySelector(":scope > .amc-reading-columns-host");
						const wrapper = host?.querySelector(".columns-rv-wrapper");
						const layerShown = !!wrapper && vis(host) && !host.classList.contains("amc-rv-pending");
						const firstLayerHeading = layerShown ? [...wrapper.querySelectorAll("h1, h2")].find(vis) : null;
						samples.push({
							t: Math.round(performance.now() - t0),
							file: viewOf(side).file?.path,
							layer: layerShown ? wrapper.dataset.columnsSourcePath : null,
							headingTop: firstLayerHeading ? Math.round(firstLayerHeading.getBoundingClientRect().top - r.top) : null,
							nativeVisible: [...p.querySelectorAll(":scope > .markdown-preview-sizer > [class*='el-']")].filter(vis).length,
						});
					} catch (e) { samples.push({t: Math.round(performance.now() - t0), error: String(e)}); }
					if (performance.now() - t0 < ms) requestAnimationFrame(sample);
					else resolve(samples);
				};
				requestAnimationFrame(sample);
			});
		},
	};
	return true;
})();
