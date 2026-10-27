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
	isKickoff,
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
	assert.deepEqual(parseArgs("  finish the port --review "), {
		goal: "finish the port",
		now: false,
		review: true,
		cancel: false,
		switchNow: false,
	});
	assert.equal(parseArgs("--now").now, true);
	assert.equal(parseArgs("--cancel").cancel, true);
	assert.equal(parseArgs("").goal, "");
});

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
	for (const name of ["land", "write", "kickoff", "summary"] as const) assert.ok(loadTemplate(name, dir).length > 50, name);
	const write = fill(loadTemplate("write", dir), { tool: "rethread_save", headings: headingsList(), goal_line: "G", previous: "(none)" });
	assert.ok(!/\{\{\w+\}\}/.test(write), "all placeholders filled");
	assert.ok(write.indexOf("next_message") < write.indexOf("**`ledger`**"), "letter is asked for before the ledger");
	const kick = fill(loadTemplate("kickoff", dir), { ledger_path: "p", letter: "L", goal_line: "G", status: "landed", ledger: LEDGER });
	assert.ok(isKickoff(kick));
	assert.ok(!/\{\{\w+\}\}/.test(kick));
	mkdirSync(join(dir, ".pi", "rethread"), { recursive: true });
	writeFileSync(join(dir, ".pi", "rethread", "land.md"), "MY LAND");
	assert.equal(loadTemplate("land", dir), "MY LAND");
	assert.equal(fill("a {{x}} {{unknown}}", { x: "1" }), "a 1 {{unknown}}");
});

test("splitSummary and looksLikeLedger", () => {
	const s = splitSummary(`## Letter\nYou: hi\n\n## Ledger\n${LEDGER}`);
	assert.equal(s.letter, "You: hi");
	assert.ok(looksLikeLedger(s.ledger));
	assert.deepEqual(splitSummary("just text"), { letter: "", ledger: "just text" });
	assert.equal(looksLikeLedger("### Goal\nonly one"), false);
	assert.equal(existsSync("/nonexistent"), false);
});
