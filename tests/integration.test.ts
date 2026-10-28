// End to end: real Pi in RPC mode, this extension, and a scripted fake model (no API calls).
import test from "node:test";
import assert from "node:assert/strict";
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PI = join(ROOT, "node_modules", ".bin", "pi");
const EXT = join(ROOT, "index.ts");
const FAKE = join(ROOT, "tests", "fake-provider.ts");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Json = Record<string, any>;

class Pi {
	p: ChildProcessWithoutNullStreams;
	events: Json[] = [];
	responses = new Map<string, Json>();
	n = 0;
	constructor(
		readonly cwd: string,
		env: Record<string, string> = {},
		flags: string[] = [],
	) {
		// Hermetic: Pi reads ~/.agents/skills and PI_* variables from the real environment, which
		// changes the system prompt size and so which compaction path Pi takes. Give it an empty home.
		const home = join(cwd, ".home");
		mkdirSync(home, { recursive: true });
		const base = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("PI_")));
		this.p = spawn(PI, ["--mode", "rpc", "-e", EXT, "-e", FAKE, "--provider", "fake", "--model", "fake-1", ...flags], {
			cwd,
			env: { ...base, HOME: home, USERPROFILE: home, PI_CODING_AGENT_DIR: join(cwd, ".agent"), PI_OFFLINE: "1", ...env },
		});
		createInterface({ input: this.p.stdout }).on("line", (line) => {
			let m: Json;
			try {
				m = JSON.parse(line);
			} catch {
				return;
			}
			if (m.type === "response" && m.id) this.responses.set(m.id, m);
			this.events.push(m);
		});
		this.p.stderr.on("data", () => {});
	}
	async call(type: string, extra: Json = {}, timeout = 30000): Promise<Json> {
		const id = `r${++this.n}`;
		this.p.stdin.write(`${JSON.stringify({ id, type, ...extra })}\n`);
		const t = Date.now();
		while (!this.responses.has(id)) {
			if (Date.now() - t > timeout) throw new Error(`timeout: ${type}`);
			await sleep(25);
		}
		return this.responses.get(id)!;
	}
	/** Wait until Pi has been idle for `settle` ms (covers deferred follow-ups and session switches). */
	async idle(settle = 1500, timeout = 60000): Promise<Json> {
		const t = Date.now();
		let quietSince = 0;
		while (Date.now() - t < timeout) {
			const st = (await this.call("get_state")).data;
			if (!st.isStreaming && !st.isCompacting) {
				quietSince ||= Date.now();
				if (Date.now() - quietSince > settle) return st;
			} else quietSince = 0;
			await sleep(150);
		}
		throw new Error("idle timeout");
	}
	async prompt(message: string, settle?: number) {
		await this.call("prompt", { message });
		return this.idle(settle);
	}
	async lastText(): Promise<string> {
		return (await this.call("get_last_assistant_text")).data?.text ?? "";
	}
	async userMessages(): Promise<string[]> {
		const msgs: Json[] = (await this.call("get_messages")).data.messages;
		return msgs.filter((m) => m.role === "user").map((m) => JSON.stringify(m.content));
	}
	notes(): string[] {
		return this.events
			.filter((e) => e.type === "extension_ui_request" && e.method === "notify")
			.map((e) => String(e.message));
	}
	close() {
		this.p.kill();
	}
}

const tmp = (tag: string) => mkdtempSync(join(tmpdir(), `rethread-${tag}-`));
const entries = (ledger: string) => (existsSync(ledger) ? readFileSync(ledger, "utf8").split("<!-- ledger-entry -->").length - 1 : 0);

test("/rethread: land, letter + ledger by the agent, new session, readback", async () => {
	const cwd = tmp("a");
	const pi = new Pi(cwd, {}, ["--rethread-auto-percent", "0"]);
	try {
		const s0 = await pi.prompt("Start the --json flag");
		const s1 = await pi.prompt("/rethread finish the port", 2500);
		const ledger = join(cwd, ".pi", "ledger.md");
		const text = readFileSync(ledger, "utf8");

		assert.notEqual(s1.sessionFile, s0.sessionFile, "a new session file");
		assert.match(text, /- Status: partial \(written by the agent\)/);
		assert.match(text, /- Goal for next session: finish the port/);
		assert.match(text, /AGENT-1 no-previous/);
		assert.match(text, /### Letter to the next session\nYou: LETTER-1/);

		const old = readFileSync(s0.sessionFile, "utf8");
		assert.ok(old.indexOf("[rethread 1/2: land]") < old.indexOf("[rethread 2/2: write]"), "land before write");
		assert.match(old, /LANDED\. Verified/);

		const users = await pi.userMessages();
		assert.equal(users.length, 1, "new session starts with the kickoff only");
		assert.match(users[0], /Letter from the previous session's agent/);
		assert.match(users[0], /LETTER-1/);
		assert.match(users[0], /3-line readback/);
		assert.match(users[0], /rethread-ledger status=\\"partial\\"/);
		assert.match(await pi.lastText(), /^READBACK/);
		assert.ok(readFileSync(s1.sessionFile, "utf8").includes(String(String(s0.sessionFile).split("/").pop())), "parent recorded");

		// Second rethread builds on the first entry.
		const s2 = await pi.prompt("/rethread", 2500);
		assert.equal(entries(ledger), 2);
		assert.match(readFileSync(ledger, "utf8").split("<!-- ledger-entry -->")[2], /saw-previous/, "the write prompt carried the previous ledger");
		assert.notEqual(s2.sessionFile, s1.sessionFile);
		assert.ok(!readdirSync(join(cwd, ".pi")).some((f) => f.endsWith(".tmp")), "no temp file left");

		await pi.prompt("/ledger", 500);
		assert.ok(pi.notes().some((n) => n.includes("(2 entries)")));
	} finally {
		pi.close();
	}
});

test("agent ignores the write request: summary fallback still moves", async () => {
	const cwd = tmp("b");
	const pi = new Pi(cwd, { FAKE_SKIP_TOOL: "1" }, ["--rethread-auto-percent", "0"]);
	try {
		const s0 = await pi.prompt("Start");
		const s1 = await pi.prompt("/rethread", 2500);
		const text = readFileSync(join(cwd, ".pi", "ledger.md"), "utf8");
		assert.notEqual(s1.sessionFile, s0.sessionFile);
		assert.match(text, /written by a summary/);
		assert.match(text, /SUMMARY/);
		assert.match(text, /You: summary letter/);
		assert.ok(pi.notes().some((n) => n.includes("did not save a handoff")));
		assert.match(await pi.lastText(), /^READBACK/);
	} finally {
		pi.close();
	}
});

test("/rethread --now skips the agent", async () => {
	const cwd = tmp("c");
	const pi = new Pi(cwd, {}, ["--rethread-auto-percent", "0"]);
	try {
		const s0 = await pi.prompt("Start");
		const s1 = await pi.prompt("/rethread --now", 2500);
		assert.notEqual(s1.sessionFile, s0.sessionFile);
		const old = readFileSync(s0.sessionFile, "utf8");
		assert.ok(!old.includes("[rethread 1/2"), "no land/write turns");
		assert.match(readFileSync(join(cwd, ".pi", "ledger.md"), "utf8"), /SUMMARY/);
	} finally {
		pi.close();
	}
});

test("automatic rethread at the context threshold, once", async () => {
	const cwd = tmp("d");
	const pi = new Pi(cwd, { FAKE_CTX: "100000", FAKE_PAD: "160000" }, ["--rethread-auto-percent", "30"]);
	try {
		const s0 = await pi.prompt("Start", 4000); // one padded reply crosses 30%
		const ledger = join(cwd, ".pi", "ledger.md");
		assert.equal(entries(ledger), 1, "fired exactly once");
		assert.ok(pi.notes().some((n) => /context at \d+%; rethreading/.test(n)));
		assert.ok(s0.sessionFile, "moved to a new session");
		assert.match(readFileSync(ledger, "utf8"), /written by the agent/);
		assert.match(await pi.lastText(), /^READBACK/);
	} finally {
		pi.close();
	}
});

test("Pi's auto-compaction is replaced by a rethread", async () => {
	const cwd = tmp("e");
	const pi = new Pi(cwd, { FAKE_CTX: "60000", FAKE_PAD: "200000" }, ["--rethread-auto-percent", "99"]);
	try {
		const s0 = await pi.prompt("Start", 4000);
		const first = (pi.events.find((e) => e.command === "get_state") as Json).data.sessionFile;
		assert.equal(entries(join(cwd, ".pi", "ledger.md")), 1);
		assert.ok(!readFileSync(first, "utf8").includes('"type":"compaction"'), "old session not compacted");
		assert.notEqual(s0.sessionFile, first);
		assert.ok(pi.notes().some((n) => n.includes("Pi would compact now")));
	} finally {
		pi.close();
	}
});

test("a reply past the whole window (silent overflow): rethread, no compaction mid-handoff", async () => {
	// A 70k-token reply in a 60k window: Pi first tries "threshold", then "overflow" with nothing to
	// retry after the land reply. Neither may compact the old session while the agent writes its letter.
	const cwd = tmp("o");
	const pi = new Pi(cwd, { FAKE_CTX: "60000", FAKE_PAD: "280000" });
	try {
		const s0 = await pi.prompt("Start", 4000);
		const first = (pi.events.find((e) => e.command === "get_state") as Json).data.sessionFile;
		assert.notEqual(s0.sessionFile, first, "moved to a new session");
		assert.ok(!readFileSync(first, "utf8").includes('"type":"compaction"'), "old session not compacted");
		assert.match(readFileSync(join(cwd, ".pi", "ledger.md"), "utf8"), /written by the agent/);
		assert.match(await pi.lastText(), /^READBACK/);
	} finally {
		pi.close();
	}
});

test("the provider rejects the write as too long: Pi's recovery compacts, retries, the move still happens", async () => {
	const cwd = tmp("r");
	const pi = new Pi(cwd, { FAKE_REJECT_WRITE: "1", FAKE_PAD: "160000" }, ["--rethread-auto-percent", "0"]); // ~40k tokens: enough history for Pi to compact
	try {
		const s0 = await pi.prompt("Start");
		const s1 = await pi.prompt("/rethread", 3000);
		const old = readFileSync(s0.sessionFile, "utf8");
		assert.match(old, /prompt is too long/, "the rejection happened");
		assert.ok(old.includes('"type":"compaction"'), "Pi's recovery was allowed to compact");
		assert.notEqual(s1.sessionFile, s0.sessionFile, "moved to a new session");
		assert.match(readFileSync(join(cwd, ".pi", "ledger.md"), "utf8"), /written by the agent/);
		assert.match(await pi.lastText(), /^READBACK/);
	} finally {
		pi.close();
	}
});

test("hostile: a fresh session already over the limit does not loop", async () => {
	const cwd = tmp("f");
	const pi = new Pi(cwd, { FAKE_CTX: "3000" }, ["--rethread-auto-percent", "10"]);
	try {
		await pi.prompt("hello", 5000);
		assert.ok(entries(join(cwd, ".pi", "ledger.md")) <= 1);
		assert.ok(pi.notes().some((n) => n.includes("automatic rethread is off")));
	} finally {
		pi.close();
	}
});

test("below the threshold nothing happens; --cancel stops a rethread", async () => {
	const cwd = tmp("g");
	const pi = new Pi(cwd, { FAKE_TPS: "15" }); // a realistic typing speed: cancel lands mid-stream
	try {
		const s0 = await pi.prompt("hello", 500);
		assert.ok(!existsSync(join(cwd, ".pi", "ledger.md")));
		await pi.call("prompt", { message: "/rethread" });
		await sleep(300);
		await pi.call("prompt", { message: "/rethread --cancel" });
		assert.ok(pi.notes().includes("rethread: cancelled"));
		const s1 = await pi.idle(2500);
		assert.equal(s1.sessionFile, s0.sessionFile, "stayed in the same session");
		assert.ok(!existsSync(join(cwd, ".pi", "ledger.md")));
	} finally {
		pi.close();
	}
});

test("project templates in .pi/rethread override the packaged ones", async () => {
	const cwd = tmp("h");
	const { writeFileSync } = await import("node:fs");
	mkdirSync(join(cwd, ".pi", "rethread"), { recursive: true });
	writeFileSync(join(cwd, ".pi", "rethread", "kickoff.md"), "CUSTOM KICKOFF {{letter}} <rethread-ledger>{{ledger}}</rethread-ledger>");
	const pi = new Pi(cwd, {}, ["--rethread-auto-percent", "0"]);
	try {
		await pi.prompt("Start");
		await pi.prompt("/rethread", 2500);
		const users = await pi.userMessages();
		assert.match(users[0], /CUSTOM KICKOFF You: LETTER-1/);
	} finally {
		pi.close();
	}
});
