/**
 * pi-rethread — end this session cleanly and continue in a new one.
 *
 *   /rethread [goal]     1. land:  the agent finishes its step and says what is verified
 *                        2. write: the agent writes a letter to the next session, then a ledger entry
 *                        3. move:  the ledger is appended, a new session opens with the letter
 *                        4. readback: the new agent restates goal, first action, main risk, then starts
 *   /rethread --now      skip 1-2 (agent stuck): a side model call writes letter + ledger
 *   /rethread --review   edit the ledger entry before moving (interactive only)
 *   /rethread --cancel   abort a rethread in progress
 *   /ledger              show the ledger path and entry count
 *
 * Automatic: after a run settles at or above --rethread-auto-percent of the context window, or when
 * Pi would auto-compact, /rethread starts by itself (once per session; never loops).
 *
 * The session switch uses Pi's documented API (ctx.newSession + withSession), as in Pi's
 * examples/extensions/handoff.ts.
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { type Message, StringEnum, uuidv7 } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import { BorderedLoader, convertToLlm, serializeConversation } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
	appendEntry,
	entryLedger,
	fill,
	goalLine,
	type Handoff,
	headingsList,
	isKickoff,
	loadTemplate,
	looksLikeLedger,
	parseArgs,
	parseThreshold,
	readEntries,
	resolveLedgerPath,
	STATUSES,
	type Status,
	shownPath,
	splitSummary,
	TOOL_NAME,
	USAGE,
} from "./rethread.ts";

type Phase = "idle" | "land" | "write" | "move";

function entryToMessage(entry: SessionEntry): AgentMessage | undefined {
	if (entry.type === "message") return entry.message;
	if (entry.type === "compaction") {
		return {
			role: "compactionSummary",
			summary: entry.summary,
			tokensBefore: entry.tokensBefore,
			timestamp: new Date(entry.timestamp).getTime(),
		};
	}
	return undefined;
}

/** Messages of the active branch, respecting the last compaction (same rule as Pi's handoff.ts). */
function branchMessages(branch: SessionEntry[]): AgentMessage[] {
	let c = -1;
	for (let i = branch.length - 1; i >= 0; i--) {
		if (branch[i].type === "compaction") {
			c = i;
			break;
		}
	}
	if (c < 0) return branch.map(entryToMessage).filter((m) => m !== undefined);
	const comp = branch[c];
	const firstKept = comp.type === "compaction" ? branch.findIndex((e) => e.id === comp.firstKeptEntryId) : -1;
	const kept = [comp, ...(firstKept >= 0 ? branch.slice(firstKept, c) : []), ...branch.slice(c + 1)];
	return kept.map(entryToMessage).filter((m) => m !== undefined);
}

export default function rethread(pi: ExtensionAPI) {
	pi.registerFlag("ledger-file", { type: "string", description: "Ledger file (default .pi/ledger.md)" });
	pi.registerFlag("rethread-auto-percent", {
		type: "string",
		description: "Start /rethread at this context % (default 70; 0 = off)",
	});

	// Per-session state. Pi runs this factory again for each new session, so it starts fresh there.
	let phase: Phase = "idle";
	let goal = "";
	let review = false;
	let saved: Omit<Handoff, "goal" | "source"> | undefined;
	let autoFired = false;
	let autoDisabled = false;
	let kickoffRun = false;
	let pendingAuto = false;

	const threshold = () => parseThreshold(pi.getFlag("rethread-auto-percent"));
	const ledgerFile = (cwd: string) => resolveLedgerPath(cwd, pi.getFlag("ledger-file"));
	const previousLedger = (cwd: string) => {
		const last = readEntries(ledgerFile(cwd)).at(-1);
		return last ? entryLedger(last) : "";
	};

	const setTool = (on: boolean) => {
		const active = pi.getActiveTools().filter((t) => t !== TOOL_NAME);
		pi.setActiveTools(on ? [...active, TOOL_NAME] : active);
	};

	const reset = () => {
		phase = "idle";
		goal = "";
		review = false;
		saved = undefined;
		setTool(false);
	};

	const send = (ctx: ExtensionContext, text: string) => {
		if (ctx.isIdle()) pi.sendUserMessage(text);
		else pi.sendUserMessage(text, { deliverAs: "followUp" });
	};

	pi.registerTool({
		name: TOOL_NAME,
		label: "Rethread: save handoff",
		description:
			"Save the handoff for the next session: a letter to the next agent, then the ledger entry. Only call this when a [rethread] message asks you to.",
		parameters: Type.Object({
			status: StringEnum(STATUSES, { description: "landed | partial | blocked" }),
			next_message: Type.String({ description: "Letter to the next session's agent. Written first." }),
			ledger: Type.String({ description: "Self-contained ledger entry with the required headings." }),
		}),
		defaultActive: false,
		async execute(_id, params) {
			if (phase !== "write") {
				return {
					content: [{ type: "text", text: "No rethread is in progress; nothing was saved." }],
					details: { saved: false },
				};
			}
			const problems: string[] = [];
			if (!params.next_message.trim()) problems.push("next_message is empty");
			if (!looksLikeLedger(params.ledger)) problems.push("ledger is missing the required ### headings");
			if (problems.length) {
				return {
					content: [{ type: "text", text: `Not saved: ${problems.join("; ")}. Call ${TOOL_NAME} again.` }],
					details: { saved: false },
				};
			}
			saved = { status: params.status as Status, letter: params.next_message, ledger: params.ledger };
			return {
				content: [{ type: "text", text: "Saved. Stop now: the next session starts when you finish." }],
				details: { saved: true },
			};
		},
	});

	/** Side model call: letter + ledger from the transcript (used by --now and as a fallback). */
	async function summarize(ctx: ExtensionCommandContext): Promise<{ letter: string; ledger: string } | null> {
		const messages = branchMessages(ctx.sessionManager.getBranch());
		if (messages.length === 0 || !ctx.model) return null;
		const prompt = [
			"## Previous ledger entry",
			previousLedger(ctx.cwd) || "(none)",
			"",
			"## Conversation",
			serializeConversation(convertToLlm(messages)),
			"",
			"## User's goal for the next session",
			goal || "(none given: continue the work)",
		].join("\n");
		const system = fill(loadTemplate("summary", ctx.cwd), { headings: headingsList() });
		const run = async (signal?: AbortSignal) => {
			const user: Message = { role: "user", content: [{ type: "text", text: prompt }], timestamp: Date.now() };
			const res = await ctx.modelRegistry.complete(
				ctx.model!,
				{ systemPrompt: system, messages: [user] },
				{ signal, cacheRetention: "none", sessionId: uuidv7() },
			);
			if (res.stopReason === "aborted" || res.stopReason === "error") return null;
			const text = res.content
				.filter((c): c is { type: "text"; text: string } => c.type === "text")
				.map((c) => c.text)
				.join("\n")
				.trim();
			return text ? splitSummary(text) : null;
		};
		if (ctx.mode !== "tui") return run(ctx.signal);
		return ctx.ui.custom((tui, theme, _kb, done) => {
			const loader = new BorderedLoader(tui, theme, "Writing the handoff...");
			loader.onAbort = () => done(null);
			run(loader.signal)
				.then(done)
				.catch((err) => {
					console.error("rethread: summary failed:", err);
					done(null);
				});
			return loader;
		});
	}

	/** Step 3: append the ledger, open the new session, send the kickoff. Command context only. */
	async function move(ctx: ExtensionCommandContext): Promise<void> {
		phase = "move";
		setTool(false);
		let h: Handoff | undefined;
		if (saved) h = { ...saved, goal, source: "agent" };
		else {
			ctx.ui.notify("rethread: the agent did not save a handoff; writing a summary instead", "warning");
			const s = await summarize(ctx);
			if (s) h = { ...s, goal, status: "partial", source: "summary" };
		}
		if (!h) {
			ctx.ui.notify("rethread: no handoff could be written; staying in this session", "error");
			reset();
			return;
		}
		if (review && ctx.mode === "tui") {
			const edited = await ctx.ui.editor("Edit the ledger entry", h.ledger);
			if (edited === undefined) {
				ctx.ui.notify("rethread: cancelled; nothing written", "info");
				reset();
				return;
			}
			h.ledger = edited;
		}

		const file = ledgerFile(ctx.cwd);
		const oldSession = ctx.sessionManager.getSessionFile();
		const n = appendEntry(file, oldSession, h);
		const kickoff = fill(loadTemplate("kickoff", ctx.cwd), {
			ledger_path: shownPath(file, ctx.cwd),
			letter: h.letter.trim() || "(none)",
			goal_line: goalLine(h.goal, false),
			status: h.status,
			ledger: h.ledger.trim(),
		});
		reset();

		// Only plain data crosses the switch; ctx is stale afterwards.
		const result = await ctx.newSession({
			parentSession: oldSession,
			withSession: async (next) => {
				next.ui.notify(`Ledger entry ${n} written; new session started`, "info");
				// Not awaited: the run would hold the switch open until it ends.
				next.sendUserMessage(kickoff).catch((err) => console.error("rethread: kickoff failed:", err));
			},
		});
		if (result.cancelled) ctx.ui.notify(`Ledger entry ${n} written, but the new session was cancelled`, "warning");
	}

	pi.registerCommand("rethread", {
		description: "Finish, write a letter and a ledger entry, continue in a new session",
		handler: async (raw, ctx) => {
			const a = parseArgs(raw);
			if (a.cancel) {
				if (phase === "idle") ctx.ui.notify("rethread: nothing to cancel", "info");
				else {
					reset();
					ctx.ui.notify("rethread: cancelled", "info");
				}
				return;
			}
			if (a.switchNow) {
				if (phase === "write") await move(ctx);
				return;
			}
			if (phase !== "idle") {
				ctx.ui.notify(`rethread: already in progress (${phase}); /rethread --cancel to stop`, "warning");
				return;
			}
			if (!ctx.model) {
				ctx.ui.notify("rethread: no model selected", "error");
				return;
			}
			if (branchMessages(ctx.sessionManager.getBranch()).length === 0) {
				ctx.ui.notify(`rethread: nothing to carry over yet. ${USAGE}`, "warning");
				return;
			}
			goal = a.goal;
			review = a.review;
			if (a.now) {
				await ctx.waitForIdle();
				phase = "write"; // so move() accepts it; saved stays empty -> summary path
				await move(ctx);
				return;
			}
			phase = "land";
			ctx.ui.notify("rethread 1/3: asking the agent to finish its step", "info");
			send(ctx, loadTemplate("land", ctx.cwd).trim());
		},
	});

	pi.registerCommand("ledger", {
		description: "Show the ledger file and its number of entries",
		handler: async (_args, ctx) => {
			const file = ledgerFile(ctx.cwd);
			const n = readEntries(file).length;
			ctx.ui.notify(n ? `Ledger: ${file} (${n} entries)` : `No ledger yet (${file})`, "info");
		},
	});

	pi.on("session_start", async () => {
		phase = "idle";
		saved = undefined;
		autoFired = false;
		autoDisabled = false;
		kickoffRun = false;
		pendingAuto = false;
	});

	// Pi's own automatic compaction becomes a rethread. Manual /compact and overflow recovery
	// (which must retry the failed turn) are left alone.
	pi.on("session_before_compact", async (event) => {
		if (event.reason !== "threshold") return;
		if (phase !== "idle") return { cancel: true }; // we are leaving this session anyway
		if (threshold() <= 0 || autoDisabled || autoFired) return;
		pendingAuto = true;
		return { cancel: true };
	});

	pi.on("before_agent_start", async (event) => {
		if (event.messageType === "user" && isKickoff(event.prompt)) kickoffRun = true;
	});

	pi.on("agent_settled", async (_event, ctx) => {
		// Advance a rethread in progress. Prompts sent here are deferred by Pi until settling ends.
		if (phase === "land") {
			phase = "write";
			setTool(true);
			ctx.ui.notify("rethread 2/3: asking for the letter and the ledger", "info");
			pi.sendUserMessage(
				fill(loadTemplate("write", ctx.cwd), {
					tool: TOOL_NAME,
					headings: headingsList(),
					goal_line: goalLine(goal, true),
					previous: previousLedger(ctx.cwd) || "(none)",
				}),
			);
			return;
		}
		if (phase === "write") {
			ctx.ui.notify("rethread 3/3: moving to a new session", "info");
			pi.sendUserMessage("/rethread --switch", { expandPromptTemplates: true });
			return;
		}
		if (phase !== "idle") return;

		const limit = threshold();
		const pct = ctx.getContextUsage()?.percent;
		if (kickoffRun) {
			kickoffRun = false;
			// Loop guard: a new session already over the limit would rethread forever.
			if (pendingAuto || (limit > 0 && pct != null && pct >= limit)) {
				pendingAuto = false;
				autoDisabled = true;
				ctx.ui.notify(
					`rethread: context is already ${pct != null ? `${Math.round(pct)}%` : "at Pi's compaction point"} right after the handoff; automatic rethread is off for this session. Raise --rethread-auto-percent or shorten the ledger.`,
					"warning",
				);
			}
			return;
		}
		if (limit <= 0 || autoFired || autoDisabled) return;
		if (!pendingAuto && (pct == null || pct < limit)) return;
		autoFired = true;
		ctx.ui.notify(
			pendingAuto
				? "rethread: Pi would compact now; rethreading instead"
				: `rethread: context at ${Math.round(pct!)}%; rethreading`,
			"info",
		);
		pendingAuto = false;
		pi.sendUserMessage("/rethread", { expandPromptTemplates: true });
	});
}
