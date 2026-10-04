import {CachedMetadata, debounce, getAllTags, Notice, TAbstractFile, TFile} from "obsidian";
import type ColumnsPlugin from "../main";
import {hasMocBlocks, MocNoteUsage, updateMocBlocks} from "./generate";
import {createMocMatcher, MocQueryCache} from "./query";

const REFRESH_DELAY_MS = 1500;

/** Tags and properties: the only note metadata a MOC query reads. */
function metadataSignature(cache: CachedMetadata | null): string {
	if (!cache) return "";
	const tags = (getAllTags(cache) ?? []).slice().sort();
	const frontmatter: Record<string, unknown> = {...cache.frontmatter};
	delete frontmatter.position;
	return JSON.stringify([tags, frontmatter]);
}

/**
 * Keeps written MOC blocks in sync with the vault, incrementally:
 *
 * - Notes containing MOC blocks are tracked by path (persisted in settings and
 *   re-discovered when such a note is opened).
 * - Vault events only record which notes changed. Metadata changes count only
 *   when a note's tags or properties actually changed — typing in a note does
 *   not — unless a MOC sorts by modification time.
 * - A debounced refresh then regenerates only the MOC notes a change can
 *   affect: notes that list a changed note, or whose query now matches it. The
 *   check is per changed note, so no vault scan happens for unrelated edits.
 *   Queries shared by several MOCs (same template and folder) run once.
 * - A note is only written when its text changes, so the plugin's own writes
 *   settle immediately.
 */
export class MocSync {
	private refreshing = false;
	private rerun = false;
	/** Refresh every tracked note next time (startup, template edits). */
	private refreshEverything = true;
	private readonly changed = new Set<string>();
	private readonly signatures = new Map<string, string>();
	private readonly usage = new Map<string, MocNoteUsage>();
	/** Some MOC sorts by "Last modified": any edit to a listed note matters. */
	private sortsByModified = false;
	private readonly scheduleRefresh = debounce(() => void this.refreshAll(), REFRESH_DELAY_MS, true);

	constructor(private readonly plugin: ColumnsPlugin) {}

	register(): void {
		const {app} = this.plugin;
		const markChanged = (path: string) => {
			this.changed.add(path);
			this.scheduleRefresh();
		};
		const isNote = (file: TAbstractFile): file is TFile => file instanceof TFile && file.extension === "md";

		this.plugin.registerEvent(app.vault.on("create", (file) => {
			if (isNote(file)) markChanged(file.path);
		}));
		this.plugin.registerEvent(app.vault.on("delete", (file) => {
			if (!isNote(file)) return;
			this.signatures.delete(file.path);
			this.usage.delete(file.path);
			if (this.isTracked(file.path)) void this.untrack(file.path);
			markChanged(file.path);
		}));
		this.plugin.registerEvent(app.vault.on("rename", (file, oldPath) => {
			if (!isNote(file)) return;
			const signature = this.signatures.get(oldPath);
			this.signatures.delete(oldPath);
			if (signature !== undefined) this.signatures.set(file.path, signature);
			const usage = this.usage.get(oldPath);
			this.usage.delete(oldPath);
			if (usage) this.usage.set(file.path, usage);
			if (this.isTracked(oldPath)) void this.retrack(oldPath, file.path);
			// A moved MOC note may resolve its folder differently.
			this.changed.add(oldPath);
			markChanged(file.path);
		}));
		this.plugin.registerEvent(app.metadataCache.on("changed", (file, _data, cache) => {
			if (!isNote(file)) return;
			const signature = metadataSignature(cache);
			const previous = this.signatures.get(file.path);
			this.signatures.set(file.path, signature);
			if (previous === signature && !this.sortsByModified) return;
			markChanged(file.path);
		}));
		this.plugin.registerEvent(app.workspace.on("file-open", (file) => {
			if (file?.extension === "md") void this.discover(file);
		}));
		app.workspace.onLayoutReady(() => this.refreshSoon());
	}

	/** Refresh all MOC notes soon (e.g. after template settings changed). */
	refreshSoon(): void {
		this.refreshEverything = true;
		this.scheduleRefresh();
	}

	isTracked(path: string): boolean {
		return this.plugin.settings.mocNotes.includes(path);
	}

	async track(path: string): Promise<void> {
		if (this.isTracked(path)) return;
		this.plugin.settings.mocNotes.push(path);
		await this.plugin.saveSettings();
	}

	private async untrack(path: string): Promise<void> {
		this.plugin.settings.mocNotes = this.plugin.settings.mocNotes.filter((p) => p !== path);
		this.usage.delete(path);
		await this.plugin.saveSettings();
	}

	private async retrack(oldPath: string, newPath: string): Promise<void> {
		this.plugin.settings.mocNotes = this.plugin.settings.mocNotes.map((p) => (p === oldPath ? newPath : p));
		await this.plugin.saveSettings();
	}

	/** Track a note opened with MOC blocks (e.g. synced from another device). */
	private async discover(file: TFile): Promise<void> {
		if (!this.plugin.settings.enableMoc) return;
		const text = await this.plugin.app.vault.cachedRead(file);
		if (!hasMocBlocks(text)) return;
		await this.track(file.path);
		await this.refreshFile(file, new Map());
	}

	/** Whether any of the changed notes can alter the MOCs in `notePath`. */
	private isAffected(notePath: string, changed: ReadonlySet<string>): boolean {
		if (changed.has(notePath)) return true;
		const usage = this.usage.get(notePath);
		if (!usage) return true;
		for (const path of changed) {
			if (usage.listed.has(path)) return true;
		}
		const {app} = this.plugin;
		const files = [...changed]
			.map((path) => app.vault.getAbstractFileByPath(path))
			.filter((f): f is TFile => f instanceof TFile);
		if (files.length === 0) return false;
		for (const id of usage.templates) {
			const template = this.plugin.settings.mocTemplates.find((t) => t.id === id);
			if (!template) continue;
			const matches = createMocMatcher(app, template, notePath);
			if (files.some(matches)) return true;
		}
		return false;
	}

	private async refreshAll(): Promise<void> {
		// MOCs disabled: keep collecting changes, refresh everything when re-enabled.
		if (!this.plugin.settings.enableMoc) return;
		if (this.refreshing) {
			this.rerun = true;
			return;
		}
		this.refreshing = true;
		const everything = this.refreshEverything;
		this.refreshEverything = false;
		const changed = new Set(this.changed);
		this.changed.clear();
		const cache: MocQueryCache = new Map();
		try {
			for (const path of [...this.plugin.settings.mocNotes]) {
				const file = this.plugin.app.vault.getAbstractFileByPath(path);
				if (!(file instanceof TFile)) {
					await this.untrack(path);
					continue;
				}
				if (!everything && !this.isAffected(path, changed)) continue;
				await this.refreshFile(file, cache);
			}
		} finally {
			this.refreshing = false;
		}
		if (this.rerun) {
			this.rerun = false;
			this.scheduleRefresh();
		}
	}

	async refreshFile(file: TFile, cache: MocQueryCache = new Map()): Promise<void> {
		const {app} = this.plugin;
		const templates = this.plugin.settings.mocTemplates;
		try {
			const current = await app.vault.cachedRead(file);
			if (!hasMocBlocks(current)) {
				await this.untrack(file.path);
				return;
			}
			const usage: MocNoteUsage = {listed: new Set(), templates: new Set()};
			const next = updateMocBlocks(app, current, file.path, templates, cache, usage);
			this.usage.set(file.path, usage);
			this.sortsByModified = [...this.usage.values()].some((u) => [...u.templates].some(
				(id) => templates.find((t) => t.id === id)?.sort === "modified",
			));
			if (next === current) return;
			await app.vault.process(file, (data) => updateMocBlocks(app, data, file.path, templates, cache));
		} catch (error) {
			console.error("[Advanced Multi Column] MOC refresh failed", file.path, error);
			new Notice(`Could not update the MOC in ${file.basename}.`);
		}
	}
}
