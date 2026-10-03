import {debounce, Notice, TAbstractFile, TFile} from "obsidian";
import type ColumnsPlugin from "../main";
import {hasMocBlocks, updateMocBlocks} from "./generate";

const REFRESH_DELAY_MS = 1500;

/**
 * Keeps written MOC blocks in sync with the vault. Notes containing MOC blocks
 * are tracked by path (persisted in settings, and re-discovered whenever such a
 * note is opened). Any change that can affect a query — notes created,
 * deleted, renamed, or their tags/properties edited — schedules a debounced
 * refresh of the tracked notes; a note is only written when its text changes,
 * so the plugin's own writes settle immediately.
 */
export class MocSync {
	private refreshing = false;
	private rerun = false;
	private readonly scheduleRefresh = debounce(() => void this.refreshAll(), REFRESH_DELAY_MS, true);

	constructor(private readonly plugin: ColumnsPlugin) {}

	register(): void {
		const {app} = this.plugin;
		const onVaultChange = (file: TAbstractFile) => {
			if (file instanceof TFile && file.extension === "md") this.scheduleRefresh();
		};
		this.plugin.registerEvent(app.vault.on("create", onVaultChange));
		this.plugin.registerEvent(app.vault.on("delete", (file) => {
			if (this.isTracked(file.path)) void this.untrack(file.path);
			onVaultChange(file);
		}));
		this.plugin.registerEvent(app.vault.on("rename", (file, oldPath) => {
			if (this.isTracked(oldPath)) void this.retrack(oldPath, file.path);
			onVaultChange(file);
		}));
		this.plugin.registerEvent(app.metadataCache.on("changed", (file) => onVaultChange(file)));
		this.plugin.registerEvent(app.workspace.on("file-open", (file) => {
			if (file?.extension === "md") void this.discover(file);
		}));
		app.workspace.onLayoutReady(() => this.scheduleRefresh());
	}

	/** Refresh all MOC notes soon (e.g. after template settings changed). */
	refreshSoon(): void {
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
		await this.plugin.saveSettings();
	}

	private async retrack(oldPath: string, newPath: string): Promise<void> {
		this.plugin.settings.mocNotes = this.plugin.settings.mocNotes.map((p) => (p === oldPath ? newPath : p));
		await this.plugin.saveSettings();
	}

	/** Track a note opened with MOC blocks (e.g. synced from another device). */
	private async discover(file: TFile): Promise<void> {
		const text = await this.plugin.app.vault.cachedRead(file);
		if (!hasMocBlocks(text)) return;
		await this.track(file.path);
		await this.refreshFile(file);
	}

	private async refreshAll(): Promise<void> {
		if (this.refreshing) {
			this.rerun = true;
			return;
		}
		this.refreshing = true;
		try {
			for (const path of [...this.plugin.settings.mocNotes]) {
				const file = this.plugin.app.vault.getAbstractFileByPath(path);
				if (!(file instanceof TFile)) {
					await this.untrack(path);
					continue;
				}
				await this.refreshFile(file);
			}
		} finally {
			this.refreshing = false;
		}
		if (this.rerun) {
			this.rerun = false;
			this.scheduleRefresh();
		}
	}

	async refreshFile(file: TFile): Promise<void> {
		const {app} = this.plugin;
		const templates = this.plugin.settings.mocTemplates;
		try {
			const current = await app.vault.cachedRead(file);
			if (!hasMocBlocks(current)) {
				await this.untrack(file.path);
				return;
			}
			if (updateMocBlocks(app, current, file.path, templates) === current) return;
			await app.vault.process(file, (data) => updateMocBlocks(app, data, file.path, templates));
		} catch (error) {
			console.error("[Advanced Multi Column] MOC refresh failed", file.path, error);
			new Notice(`Could not update the MOC in ${file.basename}.`);
		}
	}
}
