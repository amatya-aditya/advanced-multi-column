import {AbstractInputSuggest, App, getAllTags, TFolder} from "obsidian";

// Pickers used by the MOC form: vault vocabulary and suggesters.

/** Tags, property keys and values in use, read from the metadata cache. */
export class VaultVocabulary {
	readonly tags: string[];
	readonly propertyKeys: string[];
	private readonly values = new Map<string, Set<string>>();

	constructor(app: App) {
		const tags = new Set<string>();
		for (const file of app.vault.getMarkdownFiles()) {
			const cache = app.metadataCache.getFileCache(file);
			if (!cache) continue;
			const fileTags: string[] = getAllTags(cache) ?? [];
			for (const tag of fileTags) tags.add(tag.replace(/^#/, ""));
			const frontmatter: Record<string, unknown> = cache.frontmatter ?? {};
			for (const key of Object.keys(frontmatter)) {
				if (key === "position") continue;
				const raw = frontmatter[key];
				const set = this.values.get(key) ?? new Set<string>();
				const values: unknown[] = Array.isArray(raw) ? (raw as unknown[]) : [raw];
				for (const value of values) {
					if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
						set.add(String(value).replace(/^\[\[|\]\]$/g, ""));
					}
				}
				this.values.set(key, set);
			}
		}
		this.tags = [...tags].sort((a, b) => a.localeCompare(b));
		this.propertyKeys = [...this.values.keys()].sort((a, b) => a.localeCompare(b));
	}

	propertyValues(key: string): string[] {
		return [...(this.values.get(key) ?? [])].sort((a, b) => a.localeCompare(b));
	}
}

export class ListSuggest extends AbstractInputSuggest<string> {
	constructor(
		app: App,
		private readonly input: HTMLInputElement,
		private readonly source: () => string[],
		private readonly onPick: (value: string) => void,
	) {
		super(app, input);
	}

	getSuggestions(query: string): string[] {
		const q = query.toLowerCase().replace(/^#/, "");
		return this.source().filter((v) => v.toLowerCase().includes(q)).slice(0, 50);
	}

	renderSuggestion(value: string, el: HTMLElement): void {
		el.setText(value);
	}

	selectSuggestion(value: string): void {
		this.input.value = value;
		this.onPick(value);
		this.close();
	}
}

export class FolderSuggest extends AbstractInputSuggest<TFolder> {
	constructor(app: App, private readonly input: HTMLInputElement, private readonly onPick: (folder: TFolder) => void) {
		super(app, input);
	}

	getSuggestions(query: string): TFolder[] {
		const q = query.toLowerCase();
		return this.app.vault.getAllLoadedFiles()
			.filter((f): f is TFolder => f instanceof TFolder)
			.filter((f) => f.path.toLowerCase().includes(q))
			.slice(0, 50);
	}

	renderSuggestion(folder: TFolder, el: HTMLElement): void {
		el.setText(folder.path === "/" ? "/ (vault root)" : folder.path);
	}

	selectSuggestion(folder: TFolder): void {
		this.input.value = folder.path;
		this.onPick(folder);
		this.close();
	}
}
