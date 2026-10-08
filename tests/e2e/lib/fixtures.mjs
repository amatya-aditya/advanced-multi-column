// Notes of the test vault, written fresh for every run.

import {mkdirSync, writeFileSync} from "node:fs";
import {join} from "node:path";

const cols = (...columns) => ["%% col-start %%", "", ...columns.flatMap((c) => ["%% col-break %%", "", c, ""]), "%% col-end %%"].join("\n");

/** A long note: `sections` sections, a column block every third, embeds, code, lists. */
function longNote(title, word, sections) {
	const lorem = "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.";
	const out = ["---", "tags: long", "---", `# ${title}`, ""];
	for (let i = 1; i <= sections; i++) {
		out.push(`## ${word} ${i}`, "", `${lorem} [[A]] and [[Plain]] in section ${i}.`, "");
		if (i % 3 === 0) {
			out.push(cols(`### Left ${i}\n\nLeft text ${i}.\n\n- item ${i}.1\n\t- child ${i}.1.1\n- item ${i}.2`, `Right text ${i} with a [[B]] link.\n\n> [!note] Callout ${i}\n> inside a column`), "");
		}
		if (i % 25 === 0) out.push("![[I31C]]", "");
		if (i % 7 === 0) out.push("```js", `console.log(${i});`, "```", "");
	}
	out.push("## End", "", "The end.", "");
	return out.join("\n");
}

const NOTES = {
	"A.md": `---\ntags: test\n---\n# Note A\n\nA normal paragraph.\n\n${cols("first column", "second column")}\n\nafter\n`,
	"B.md": `# Note B\n\n${cols("B left", "B right")}\n`,
	"C2.md": `# Note C2\n\nIntro text of C2.\n\n${cols("C2 left", "C2 right")}\n\nC2 tail.\n`,
	"Plain.md": "# Plain\n\nA note without columns.\n",
	"Plain2.md": "# Plain2\n\nAnother note without columns.\n",
	"I31A.md": "![[I31B]]\n",
	"I31B.md": `# B\n\n${cols("Left column of B.", "Right column of B.")}\n\n![[I31C]]\n`,
	"I31C.md": `# C\n\n${cols("Left column of C.", "Right column of C.")}\n`,
	"I30.md": `# Outside heading\n\nText under outside heading.\n\n- outer item\n\t- child item\n\t- child item 2\n\n${cols("## Inside heading\n\nText under inside heading.\n\n- in item\n\t- in child", "Right side.")}\n\n## Second outside heading\n\nTail text.\n`,
	"FnCols.md": `# Footnotes in columns\n\n${cols("This is the reference notes cited in [^1]\n\n[^1]: I also added information here", "This is reference in 2nd column [^2]\n\n[^2]: This is something I added, **bold**, see also [^1]\n\n[^orphan]: A definition nobody references")}\n`,
	"ReuseFn.md": `# Reuse test\n\nIntro with a footnote[^a].\n\n${cols("## Left heading\n\nLeft text with[^b].", "Right text.")}\n\nMiddle text.\n\n${cols("Second block left[^c].", "Second block right.")}\n\n![[I31C]]\n\nTail.\n\n[^a]: Footnote A.\n[^b]: Footnote B.\n[^c]: Footnote C.\n`,
};

export function writeFixtures(vaultDir) {
	mkdirSync(join(vaultDir, ".obsidian"), {recursive: true});
	for (const [name, text] of Object.entries(NOTES)) writeFileSync(join(vaultDir, name), text);
	const long = longNote("Long note", "Section", 400);
	const long2 = longNote("Long note 2", "Part", 400);
	writeFileSync(join(vaultDir, "Long.md"), long);
	writeFileSync(join(vaultDir, "Long2.md"), long2);
	writeFileSync(join(vaultDir, "LongPlain.md"), long.split("\n").filter((l) => !l.startsWith("%% col-")).join("\n"));
	writeFileSync(join(vaultDir, "LongPlain2.md"), long2.split("\n").filter((l) => !l.startsWith("%% col-")).join("\n"));
}

/** Contents of a fixture note as written (to reset a note between tests). */
export function fixture(name) {
	return NOTES[name];
}
