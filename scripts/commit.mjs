import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const TYPES = [
  "feat",
  "fix",
  "docs",
  "chore",
  "refactor",
  "test",
  "perf",
  "style",
  "ci",
  "build",
  "revert",
];

const proc = globalThis.process;

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    stdio: "pipe",
    encoding: "utf8",
    ...options,
  });
}

function runInherit(command, args) {
  return spawnSync(command, args, {
    stdio: "inherit",
    encoding: "utf8",
  });
}

function isInsideGitRepo() {
  const result = run("git", ["rev-parse", "--is-inside-work-tree"]);
  return result.status === 0 && result.stdout.trim() === "true";
}

function getStagedFiles() {
  const result = run("git", ["diff", "--cached", "--name-only", "--diff-filter=ACMRTUXB"]);
  if (result.status !== 0) return [];
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.replace(/\\/g, "/"));
}

function getTopLevelDirs(files) {
  const dirs = new Set();
  for (const file of files) {
    const parts = file.split("/");
    const top = parts[0];
    if (top && top !== ".") dirs.add(top);
  }
  return [...dirs];
}

function inferType(files) {
  if (files.length === 0) return "chore";
  const docsOnly = files.every(
    (file) =>
      file.startsWith("docs/") ||
      file.startsWith("wiki/") ||
      file.toLowerCase() === "readme.md",
  );
  if (docsOnly) return "docs";

  const testsOnly = files.every(
    (file) =>
      file.startsWith("test/") ||
      file.includes(".test.") ||
      file.includes(".spec."),
  );
  if (testsOnly) return "test";

  return "feat";
}

function inferScope(files) {
  if (files.length === 0) return "";
  const dirs = getTopLevelDirs(files);
  if (dirs.length === 1) return sanitizeScope(dirs[0]);
  return "";
}

function sanitizeScope(rawScope) {
  return rawScope
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._/-]/g, "");
}

function inferSubject(files) {
  if (files.length === 0) return "update project files";
  if (files.length === 1) return `update ${files[0]}`;

  const dirs = getTopLevelDirs(files);
  if (dirs.length === 1) return `update ${dirs[0]} files`;
  return `update ${files.length} files`;
}

async function ask(rl, prompt, defaultValue = "") {
  const suffix = defaultValue ? ` [${defaultValue}]` : "";
  const answer = (await rl.question(`${prompt}${suffix}: `)).trim();
  return answer || defaultValue;
}

async function askYesNo(rl, prompt, defaultYes = true) {
  const defaultText = defaultYes ? "Y/n" : "y/N";
  const answer = (await rl.question(`${prompt} [${defaultText}]: `)).trim().toLowerCase();
  if (!answer) return defaultYes;
  return answer === "y" || answer === "yes";
}

async function askType(rl, suggestedType) {
  output.write("\nSelect commit type:\n");
  for (let i = 0; i < TYPES.length; i++) {
    const type = TYPES[i];
    const marker = type === suggestedType ? " (suggested)" : "";
    output.write(`  ${i + 1}. ${type}${marker}\n`);
  }

  while (true) {
    const defaultIndex = String(Math.max(1, TYPES.indexOf(suggestedType) + 1));
    const answer = (await ask(rl, "Type number or name", defaultIndex)).toLowerCase();
    const byNumber = Number.parseInt(answer, 10);
    if (Number.isFinite(byNumber) && byNumber >= 1 && byNumber <= TYPES.length) {
      return TYPES[byNumber - 1];
    }
    if (TYPES.includes(answer)) return answer;
    output.write("Invalid type. Choose a valid number or type name.\n");
  }
}

async function main() {
  if (!isInsideGitRepo()) {
    output.write("[commit] Not inside a git repository.\n");
    proc.exit(1);
  }

  let stagedFiles = getStagedFiles();
  const rl = createInterface({ input, output });

  try {
    if (stagedFiles.length === 0) {
      output.write("[commit] No staged files found.\n");
      const stageAll = await askYesNo(rl, "Stage all changes with `git add -A`?", true);
      if (!stageAll) {
        output.write("[commit] Aborted. Stage files first with `git add ...`.\n");
        proc.exit(1);
      }
      const addResult = runInherit("git", ["add", "-A"]);
      if (addResult.status !== 0) {
        output.write("[commit] Failed to stage changes.\n");
        proc.exit(addResult.status ?? 1);
      }
      stagedFiles = getStagedFiles();
      if (stagedFiles.length === 0) {
        output.write("[commit] Nothing to commit.\n");
        proc.exit(1);
      }
    }

    output.write(`\n[commit] Staged files: ${stagedFiles.length}\n`);
    for (const file of stagedFiles.slice(0, 8)) {
      output.write(`  - ${file}\n`);
    }
    if (stagedFiles.length > 8) {
      output.write(`  ...and ${stagedFiles.length - 8} more\n`);
    }

    const suggestedType = inferType(stagedFiles);
    const suggestedScope = inferScope(stagedFiles);
    const suggestedSubject = inferSubject(stagedFiles);

    const type = await askType(rl, suggestedType);
    const scopeInput = await ask(rl, "Scope (optional)", suggestedScope);
    const scope = scopeInput ? sanitizeScope(scopeInput) : "";

    let subject = await ask(rl, "Subject (leave empty for auto)", "");
    if (!subject) subject = suggestedSubject;
    subject = subject.replace(/\.$/, "").trim();
    if (!subject) subject = "update files";

    const breaking = await askYesNo(rl, "Breaking change?", false);
    const body = await ask(rl, "Body (optional, one short line)", "");

    let breakingNote = "";
    if (breaking) {
      const defaultNote = "BREAKING CHANGE: behavior changed";
      breakingNote = await ask(rl, "Breaking note", defaultNote);
      if (!breakingNote.toUpperCase().startsWith("BREAKING CHANGE:")) {
        breakingNote = `BREAKING CHANGE: ${breakingNote}`;
      }
    }

    const header = `${type}${scope ? `(${scope})` : ""}${breaking ? "!" : ""}: ${subject}`;

    output.write("\nCommit preview:\n");
    output.write(`  ${header}\n`);
    if (body) output.write(`\n  ${body}\n`);
    if (breakingNote) output.write(`\n  ${breakingNote}\n`);

    const confirm = await askYesNo(rl, "\nCreate commit now?", true);
    if (!confirm) {
      output.write("[commit] Aborted.\n");
      proc.exit(1);
    }

    const args = ["commit", "-m", header];
    if (body) args.push("-m", body);
    if (breakingNote) args.push("-m", breakingNote);

    const commitResult = runInherit("git", args);
    proc.exit(commitResult.status ?? 0);
  } finally {
    rl.close();
  }
}

void main();

