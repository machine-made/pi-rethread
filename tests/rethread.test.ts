import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	appendEntry,
	DEFAULT_AUTO_PERCENT,
	entryLedger,
	fill,
	headingsList,
	isUnpack,
	LETTER_SHAPE,
	loadTemplate,
	looksLikeLedger,
	parseArgs,
	parseThreshold,
	readEntries,
	resolveLedgerPath,
	shownPath,
	splitSummary,
} from "../rethread.ts";

const LEDGER = "### Goal\ng\n### Done\nd\n### Decisions\nnone\n### Files\nf\n### Commands\nc\n### Open problems\nnone\n### Next steps\n1. x";

test("parseArgs separates goal and flags", () => {
	assert.deepEqual(parseArgs("  finish the port --cancel "), {
		goal: "finish the port",
		summary: false,
		cancel: true,
		move: false,
	});
	assert.equal(parseArgs("--summary").summary, true);
	assert.equal(parseArgs("--cancel").cancel, true);
	assert.equal(parseArgs("").goal, "");
})

test("parseThreshold: default, explicit, off", () => {
	assert.equal(parseThreshold(undefined), DEFAULT_AUTO_PERCENT);
	assert.equal(parseThreshold(""), DEFAULT_AUTO_PERCENT);
	assert.equal(parseThreshold("55"), 55);
	assert.equal(parseThreshold("0"), 0);
	assert.equal(parseThreshold("abc"), 0);
	assert.equal(parseThreshold("-5"), 0);
});

test("resolveLedgerPath: relative to cwd, absolute kept", () => {
	assert.equal(resolveLedgerPath("/w", undefined), "/w/.pi/ledger.md");
	assert.equal(resolveLedgerPath("/w", "notes/l.md"), "/w/notes/l.md");
	assert.equal(resolveLedgerPath("/w", "/abs/l.md"), "/abs/l.md");
	assert.equal(shownPath("/w/.pi/ledger.md", "/w"), ".pi/ledger.md");
	assert.equal(shownPath("/abs/l.md", "/w"), "/abs/l.md");
});

test("appendEntry: atomic, numbered, letter after ledger, readable back", () => {
	const dir = mkdtempSync(join(tmpdir(), "rethread-unit-"));
	const file = join(dir, ".pi", "ledger.md");
	const h = { goal: "port it", letter: "You: do X first.", ledger: LEDGER, status: "partial" as const, source: "agent" as const };
	assert.equal(appendEntry(file, "/s/one.jsonl", h, new Date("2026-10-27T10:00:00Z")), 1);
	assert.equal(appendEntry(file, undefined, { ...h, goal: "", letter: "" }), 2);
	const text = readFileSync(file, "utf8");
	assert.match(text, /^# Ledger/);
	assert.match(text, /## Entry 1 — 2026-10-27T10:00:00.000Z/);
	assert.match(text, /- From session: `one.jsonl`/);
	assert.match(text, /- Status: partial \(written by the agent\)/);
	assert.ok(text.indexOf("### Next steps") < text.indexOf("### Letter to the next session"));
	assert.equal(readEntries(file).length, 2);
	assert.ok(!readdirSync(join(dir, ".pi")).some((f) => f.endsWith(".tmp")));
	// entryLedger strips metadata and the letter
	const body = entryLedger(readEntries(file)[0]);
	assert.ok(body.startsWith("### Goal"));
	assert.ok(!body.includes("Letter to the next session"));
	assert.ok(!body.includes("From session"));
});

test("readEntries on a missing file", () => {
	assert.deepEqual(readEntries("/nonexistent/ledger.md"), []);
});

test("templates: packaged ones load and fill; project override wins", () => {
	const dir = mkdtempSync(join(tmpdir(), "rethread-tpl-"));
	for (const name of ["pack", "unpack", "summary"] as const) assert.ok(loadTemplate(name, dir).length > 50, name);
	const pack = fill(loadTemplate("pack", dir), { tool: "rethread_pack", headings: headingsList(), goal_line: "G", previous: "(none)", letter_shape: "SHAPE" });
	assert.ok(!/\{\{\w+\}\}/.test(pack), "all placeholders filled");
	assert.ok(pack.includes("SHAPE"), "{{letter_shape}} is filled");
	assert.ok(pack.indexOf("**`letter`**") > 0, "the letter field is named exactly");
	assert.ok(pack.indexOf("**`letter`**") < pack.indexOf("**`entry`**"), "letter is asked for before the entry");
	const unpack = fill(loadTemplate("unpack", dir), { ledger_path: "p", letter: "L", goal_line: "G", status: "landed", ledger: LEDGER });
	assert.ok(isUnpack(unpack));
	assert.ok(!/\{\{\w+\}\}/.test(unpack));
	mkdirSync(join(dir, ".pi", "rethread"), { recursive: true });
	writeFileSync(join(dir, ".pi", "rethread", "pack.md"), "MY PACK");
	assert.equal(loadTemplate("pack", dir), "MY PACK");
	assert.equal(fill("a {{x}} {{unknown}}", { x: "1" }), "a 1 {{unknown}}");
});

test("the letter shape has one source: pack and summary use LETTER_SHAPE", () => {
	const dir = mkdtempSync(join(tmpdir(), "rethread-shape-"));
	const shape = "SHAPE LINE";
	const pack = fill(loadTemplate("pack", dir), { letter_shape: shape });
	const summary = fill(loadTemplate("summary", dir), { letter_shape: shape });
	assert.ok(pack.includes(shape), "pack fills {{letter_shape}}");
	assert.ok(summary.includes(shape), "summary fills {{letter_shape}}");
	assert.ok(!pack.includes("**Trust**"), "pack does not repeat the shape text");
	assert.ok(!summary.includes("**Trust**"), "summary does not repeat the shape text");
	assert.ok(LETTER_SHAPE.includes("**Trust**"), "LETTER_SHAPE is the one place the parts are listed");
});

test("splitSummary and looksLikeLedger", () => {
	const s = splitSummary(`## Letter\nYou: hi\n\n## Ledger\n${LEDGER}`);
	assert.equal(s.letter, "You: hi");
	assert.ok(looksLikeLedger(s.ledger));
	assert.deepEqual(splitSummary("just text"), { letter: "", ledger: "just text" });
	assert.equal(looksLikeLedger("### Goal\nonly one"), false);
	assert.equal(existsSync("/nonexistent"), false);
});
