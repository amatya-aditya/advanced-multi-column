// End-to-end tests: drive a separate Obsidian on a fresh test vault.
//
//   npm run test:e2e                  build, then run every suite
//   npm run test:e2e -- --grep footnote   only tests whose name matches
//   npm run test:e2e -- --no-build --keep   skip the build, keep the temp vault
//
// Environment: OBSIDIAN_PATH (Obsidian executable), AMC_E2E_PORT (debugging port, default 9339).

import {execSync} from "node:child_process";
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {writeFixtures} from "./lib/fixtures.mjs";
import {launchObsidian} from "./lib/obsidian.mjs";
import editing from "./suites/editing.mjs";
import livepreview from "./suites/livepreview.mjs";
import reading from "./suites/reading.mjs";
import quit from "./suites/quit.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const grepAt = args.indexOf("--grep");
const grep = grepAt >= 0 ? new RegExp(args[grepAt + 1], "i") : null;
const keep = args.includes("--keep") || args.includes("--leave-open");
const port = Number(process.env.AMC_E2E_PORT ?? 9339);
const TEST_TIMEOUT_MS = 60_000;

const suites = [["editing", editing], ["reading", reading], ["live preview", livepreview], ["quit", quit]];
const selected = suites
	.map(([name, tests]) => [name, tests.filter((t) => !grep || grep.test(`${name} ${t.name}`))])
	.filter(([, tests]) => tests.length > 0);
if (selected.length === 0) {
	console.log("No tests match.");
	process.exit(0);
}

if (!args.includes("--no-build")) {
	console.log("Building…");
	execSync("npm run build", {cwd: repo, stdio: "inherit"});
}

// A test Obsidian left open (--leave-open) still holds the port; tests would drive it instead.
const portTaken = await fetch(`http://127.0.0.1:${port}/json/version`).then(() => true, () => false);
if (portTaken) {
	console.error(`Port ${port} is in use (an Obsidian left open by --leave-open?). Close it, or set AMC_E2E_PORT.`);
	process.exit(1);
}

const root = mkdtempSync(join(tmpdir(), "amc-e2e-"));
const vaultDir = join(root, "vault");
writeFixtures(vaultDir);
console.log(`Test vault: ${vaultDir}`);

const session = await launchObsidian({
	rootDir: root,
	vaultDir,
	pluginFiles: ["main.js", "manifest.json", "styles.css"].map((f) => join(repo, f)),
	port,
});
const o = {...session, vaultDir};
let failed = 0, passed = 0, open = true;

for (const [suite, tests] of selected) {
	console.log(`\n${suite}`);
	for (const test of tests) {
		const t0 = Date.now();
		try {
			if (open) {
				await o.front();
				await o.call("closeModals");
			}
			await Promise.race([
				test.run(o),
				new Promise((_, reject) => setTimeout(() => reject(new Error(`timed out after ${TEST_TIMEOUT_MS / 1000}s`)), TEST_TIMEOUT_MS)),
			]);
			passed++;
			console.log(`  ✓ ${test.name} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
		} catch (error) {
			failed++;
			console.log(`  ✗ ${test.name}\n      ${String(error?.message ?? error).split("\n").join("\n      ")}`);
		}
		if (test.closesObsidian) open = false;
	}
}

const leaveOpen = args.includes("--leave-open");
if (open && !leaveOpen) {
	o.send("Runtime.evaluate", {expression: "setTimeout(() => window.close(), 10)"});
	await o.sleep(1500);
}
if (leaveOpen) console.log(`Obsidian left open on port ${port}; the test vault is kept.`);
o.close();
if (!keep) {
	await o.sleep(1500);
	try { rmSync(root, {recursive: true, force: true}); } catch { console.log(`Could not remove ${root}`); }
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
