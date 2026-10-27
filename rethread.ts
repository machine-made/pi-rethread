// Pure helpers for pi-rethread: templates, ledger file, kickoff. No Pi runtime imports.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

export const ENTRY_MARK = "<!-- ledger-entry -->";
export const DEFAULT_LEDGER = ".pi/ledger.md";
export const DEFAULT_AUTO_PERCENT = 70;
export const TOOL_NAME = "rethread_save";
export const KICKOFF_TAG = "rethread-ledger";
export const OVERRIDE_DIR = ".pi/rethread";
export const USAGE = "Usage: /rethread [goal for the next session] [--now] [--review] [--cancel]";

export const LEDGER_HEADINGS = ["Goal", "Done", "Decisions", "Files", "Commands", "Open problems", "Next steps"] as const;
export const STATUSES = ["landed", "partial", "blocked"] as const;
export type Status = (typeof STATUSES)[number];

export type TemplateName = "land" | "write" | "kickoff" | "summary";

const PACKAGE_PROMPTS = join(dirname(fileURLToPath(import.meta.url)), "prompts");

/** Project override in .pi/rethread/<name>.md wins over the packaged template. */
export function loadTemplate(name: TemplateName, cwd: string): string {
	const own = join(cwd, OVERRIDE_DIR, `${name}.md`);
	return readFileSync(existsSync(own) ? own : join(PACKAGE_PROMPTS, `${name}.md`), "utf8");
}

/** Replace {{key}} placeholders; unknown keys are left as they are. */
export function fill(template: string, vars: Record<string, string>): string {
	return template.replace(/\{\{(\w+)\}\}/g, (m, k: string) => (k in vars ? vars[k] : m)).trim();
}

export const headingsList = (): string => LEDGER_HEADINGS.map((h) => `### ${h}`).join("\n");

export function goalLine(goal: string, forNextSession: boolean): string {
	if (goal) return `The user's goal for ${forNextSession ? "the next" : "this"} session: ${goal}`;
	return forNextSession
		? "The user gave no goal: the next session continues the work."
		: 'Continue with the first item under "Next steps".';
}

export interface Args {
	goal: string;
	now: boolean;
	review: boolean;
	cancel: boolean;
	switchNow: boolean;
}

export function parseArgs(raw: string): Args {
	const words = raw.trim().split(/\s+/).filter(Boolean);
	const flags = new Set(words.filter((w) => w.startsWith("--")));
	return {
		goal: words.filter((w) => !w.startsWith("--")).join(" "),
		now: flags.has("--now"),
		review: flags.has("--review"),
		cancel: flags.has("--cancel"),
		switchNow: flags.has("--switch"), // internal: sent by the extension itself
	};
}

export function resolveLedgerPath(cwd: string, flag: unknown): string {
	const p = typeof flag === "string" && flag.trim() ? flag.trim() : DEFAULT_LEDGER;
	return isAbsolute(p) ? p : join(cwd, p);
}

/** Context percent that starts an automatic rethread; 0 means off. */
export function parseThreshold(flag: unknown): number {
	if (typeof flag !== "string" || flag.trim() === "") return DEFAULT_AUTO_PERCENT;
	const n = Number(flag);
	return Number.isFinite(n) && n > 0 ? n : 0;
}

export function readEntries(file: string): string[] {
	if (!existsSync(file)) return [];
	return readFileSync(file, "utf8")
		.split(ENTRY_MARK)
		.slice(1)
		.map((s) => s.trim())
		.filter(Boolean);
}

export interface Handoff {
	goal: string;
	letter: string;
	ledger: string;
	status: Status;
	source: "agent" | "summary";
}

/** Append one entry atomically (temp file, then rename). Returns the entry number. */
export function appendEntry(file: string, sessionFile: string | undefined, h: Handoff, now = new Date()): number {
	mkdirSync(dirname(file), { recursive: true });
	const header = existsSync(file)
		? readFileSync(file, "utf8")
		: "# Ledger\n\nWritten by /rethread (pi-rethread). Newest entry last. Each entry is self-contained.\n";
	const n = readEntries(file).length + 1;
	const meta = [
		`## Entry ${n} — ${now.toISOString()}`,
		"",
		`- From session: \`${sessionFile ? basename(sessionFile) : "in-memory"}\``,
		`- Status: ${h.status} (written by ${h.source === "agent" ? "the agent" : "a summary"})`,
		h.goal ? `- Goal for next session: ${h.goal.replace(/\s+/g, " ").trim()}` : undefined,
	]
		.filter((l) => l !== undefined)
		.join("\n");
	const letter = h.letter.trim() ? `\n\n### Letter to the next session\n${h.letter.trim()}` : "";
	const text = `${header.trimEnd()}\n\n${ENTRY_MARK}\n${meta}\n\n${h.ledger.trim()}${letter}\n`;
	const tmp = `${file}.${process.pid}.tmp`;
	writeFileSync(tmp, text, "utf8");
	renameSync(tmp, file);
	return n;
}

/** The ledger part of a stored entry (no metadata, no letter): what the next write builds on. */
export function entryLedger(entry: string): string {
	return entry
		.replace(/^## Entry \d+ — .*$/m, "")
		.replace(/^- (From session|Status|Goal for next session):.*$/gm, "")
		.split(/^### Letter to the next session$/m)[0]
		.trim();
}

/** Split the fallback summary ("## Letter" / "## Ledger") into its parts. */
export function splitSummary(text: string): { letter: string; ledger: string } {
	const m = text.match(/^##\s*Letter\s*$([\s\S]*?)^##\s*Ledger\s*$([\s\S]*)/im);
	if (!m) return { letter: "", ledger: text.trim() };
	return { letter: m[1].trim(), ledger: m[2].trim() };
}

export function isKickoff(prompt: string): boolean {
	return prompt.includes(`<${KICKOFF_TAG}`);
}

/** A usable ledger has most of the expected headings. */
export function looksLikeLedger(text: string): boolean {
	return LEDGER_HEADINGS.filter((h) => new RegExp(`^#{2,4}\\s*${h}\\b`, "mi").test(text)).length >= 4;
}

export function shownPath(file: string, cwd: string): string {
	const r = relative(cwd, file);
	return r && !r.startsWith("..") ? r : file;
}
