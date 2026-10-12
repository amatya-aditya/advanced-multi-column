// Launch a separate, debuggable Obsidian on a test vault, next to (not instead of) the user's.

import {spawn} from "node:child_process";
import {copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync} from "node:fs";
import {homedir, platform} from "node:os";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {connect} from "./cdp.mjs";

const PAGE_HELPERS = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "page-helpers.js"), "utf8");

const PLUGIN_ID = "advanced-multi-column";

function obsidianExecutable() {
	if (process.env.OBSIDIAN_PATH) return process.env.OBSIDIAN_PATH;
	if (platform() === "win32") return join(process.env.LOCALAPPDATA ?? "", "Programs", "obsidian", "Obsidian.exe");
	if (platform() === "darwin") return "/Applications/Obsidian.app/Contents/MacOS/Obsidian";
	return "obsidian";
}

function obsidianConfigDir() {
	if (platform() === "win32") return join(process.env.APPDATA ?? "", "obsidian");
	if (platform() === "darwin") return join(homedir(), "Library", "Application Support", "obsidian");
	return join(homedir(), ".config", "obsidian");
}

/**
 * Start Obsidian with its own user data folder (so it runs next to the user's
 * Obsidian) on `vaultDir`, enable the plugin, and return a CDP session.
 */
export async function launchObsidian({rootDir, vaultDir, pluginFiles, port}) {
	const userData = join(rootDir, "userdata");
	mkdirSync(userData, {recursive: true});
	writeFileSync(join(userData, "obsidian.json"), JSON.stringify({vaults: {amce2e0000000001: {path: vaultDir, ts: 1, open: true}}}));
	// Use the Obsidian version the user has installed, not only the installer's.
	const config = obsidianConfigDir();
	if (existsSync(config)) {
		for (const f of readdirSync(config)) if (/^obsidian-[\d.]+\.asar$/.test(f)) copyFileSync(join(config, f), join(userData, f));
	}
	const pluginDir = join(vaultDir, ".obsidian", "plugins", PLUGIN_ID);
	mkdirSync(pluginDir, {recursive: true});
	for (const f of pluginFiles) copyFileSync(f, join(pluginDir, f.split(/[\\/]/).pop()));
	writeFileSync(join(vaultDir, ".obsidian", "community-plugins.json"), JSON.stringify([PLUGIN_ID]));

	const child = spawn(obsidianExecutable(), [`--user-data-dir=${userData}`, `--remote-debugging-port=${port}`], {detached: true, stdio: "ignore"});
	child.unref();

	let session = null;
	for (let i = 0; i < 60 && !session; i++) {
		try {
			session = await connect(port);
		} catch {
			await new Promise((r) => setTimeout(r, 1000));
		}
	}
	if (!session) throw new Error(`Obsidian did not open a debugging port on ${port}`);
	await session.ev(`new Promise((resolve) => { const ok = () => window.app?.workspace?.layoutReady; if (ok()) return resolve(true); const t = setInterval(() => { if (ok()) { clearInterval(t); resolve(true); } }, 200); })`);
	await session.ev(`(async () => {
		app.plugins.setEnable(true);
		await app.plugins.loadManifests();
		await app.plugins.enablePluginAndSave(${JSON.stringify(PLUGIN_ID)});
		// A new vault with plugins asks whether to trust its author, shortly after it opens.
		for (let i = 0; i < 25; i++) {
			const trust = [...document.querySelectorAll(".modal-container button")].find((b) => /trust author/i.test(b.textContent));
			if (trust) { trust.click(); break; }
			await new Promise((r) => setTimeout(r, 200));
		}
		document.querySelectorAll(".modal-container .modal-close-button").forEach((b) => b.click());
		return true;
	})()`);
	await session.ev(PAGE_HELPERS);
	// A freshly started Obsidian ignores its first keyboard shortcut (it sets
	// itself up on the first key event); spend it on a harmless key.
	await session.front();
	await session.key("Escape");
	await session.sleep(500);
	return session;
}

/** Re-install the page helpers (after the app reloads). */
export function installHelpers(session) {
	return session.ev(PAGE_HELPERS);
}
