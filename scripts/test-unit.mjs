/*
 * Unit tests without pulling Obsidian into Node: each test file is bundled by
 * esbuild (which also handles TypeScript and path resolution) and executed by
 * node:test.
 */
import esbuild from "esbuild";
import {spawn} from "node:child_process";
import {mkdir, readdir, rm} from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const testsDir = path.join(root, "tests", "unit");
const outDir = path.join(root, ".test-dist");

await rm(outDir, {recursive: true, force: true});
await mkdir(outDir, {recursive: true});

const entries = (await readdir(testsDir))
	.filter((name) => name.endsWith(".test.ts"))
	.map((name) => path.join(testsDir, name));

if (entries.length === 0) {
	console.error("No tests/unit/*.test.ts files found.");
	process.exit(1);
}

await esbuild.build({
	entryPoints: entries,
	outdir: outDir,
	bundle: true,
	format: "esm",
	platform: "node",
	target: "node20",
	sourcemap: "inline",
	logLevel: "warning",
});

const files = (await readdir(outDir))
	.filter((name) => name.endsWith(".test.js"))
	.map((name) => path.join(outDir, name));

const child = spawn(process.execPath, ["--test", ...files], {
	stdio: "inherit",
	cwd: root,
});
child.on("exit", (code) => process.exit(code ?? 1));
