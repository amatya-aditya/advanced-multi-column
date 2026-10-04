import tseslint from 'typescript-eslint';
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";
import { globalIgnores } from "eslint/config";

export default tseslint.config(
	{
		languageOptions: {
			globals: {
				...globals.browser,
				// DOM helpers and window globals Obsidian defines at runtime.
				activeDocument: "readonly",
				activeWindow: "readonly",
				createDiv: "readonly",
				createEl: "readonly",
				createSpan: "readonly",
				createFragment: "readonly",
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: [
						'eslint.config.js',
						'manifest.json'
					]
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json']
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		plugins: {obsidianmd},
		rules: {
			// "MOC" (map of content) is a feature name, written in capitals.
			"obsidianmd/ui/sentence-case": ["error", {ignoreWords: ["MOC"]}],
		},
	},
	globalIgnores([
		"node_modules",
		"dist",
		"esbuild.config.mjs",
		"eslint.config.js",
		"version-bump.mjs",
		"versions.json",
		"main.js",
	]),
);
