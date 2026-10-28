// Test-only Pi extension: a scripted model, so the integration test runs real Pi with no API calls.
// Env: FAKE_CTX (context window), FAKE_PAD (chars of padding in ordinary replies),
//      FAKE_TPS (simulated typing speed), FAKE_SKIP_TOOL=1 (the agent ignores the write request, to exercise the
//      fallback), FAKE_REJECT_WRITE=1 (the provider rejects the first write request as too long).
import { createFauxCore, fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const LEDGER = (tag: string) =>
	`### Goal\nAdd a --json flag to the demo CLI (${tag})\n### Done\n- read the argument parser\n### Decisions\n- keep the existing flag style\n### Files\n- src/cli.ts\n### Commands\n- npm test\n### Open problems\nnone\n### Next steps\n1. Write the flag in src/cli.ts`;

export default function (pi: ExtensionAPI) {
	const ctxWindow = Number(process.env.FAKE_CTX ?? 200000);
	const core = createFauxCore({
		api: "fake-api",
		provider: "fake",
		models: [{ id: "fake-1", contextWindow: ctxWindow, maxTokens: 4000 }],
		...(process.env.FAKE_TPS ? { tokensPerSecond: Number(process.env.FAKE_TPS) } : {}),
	});
	let writes = 0;
	let rejected = false;
	const respond = (context: unknown) => {
		const all = JSON.stringify(context);
		const msgs = (context as { messages?: unknown[] }).messages ?? [];
		const last = JSON.stringify(msgs.at(-1) ?? {});
		if (all.includes("You are a context summarization assistant")) {
			return fauxAssistantMessage("## Goal\nPI-COMPACTION-SUMMARY");
		}
		if (process.env.FAKE_REJECT_WRITE === "1" && !rejected && last.includes("[rethread 2/2: write]")) {
			rejected = true; // the provider refuses this request once, as a real one does when it is too long
			return fauxAssistantMessage("", { stopReason: "error", errorMessage: "prompt is too long: 70000 tokens > 60000 maximum" });
		}
		if (all.includes("You write a handoff so a fresh coding-agent session")) {
			return fauxAssistantMessage(`## Letter\nYou: summary letter.\n\n## Ledger\n${LEDGER("SUMMARY")}`);
		}
		if (last.includes("toolResult") && last.includes("Saved. Stop now")) return fauxAssistantMessage("Done.");
		if (last.includes("[rethread 1/2: land]")) {
			return fauxAssistantMessage("LANDED. Verified: build. Assumed: nothing.");
		}
		if (last.includes("[rethread 2/2: write]")) {
			if (process.env.FAKE_SKIP_TOOL === "1") return fauxAssistantMessage("I will not call the tool.");
			writes++;
			const sawPrevious = last.includes("AGENT-1") ? "saw-previous" : "no-previous";
			return fauxAssistantMessage([
				fauxText("Writing the handoff."),
				fauxToolCall("rethread_save", {
					status: "partial",
					next_message: `You: LETTER-${writes}. Do first: write the flag in src/cli.ts.`,
					ledger: LEDGER(`AGENT-${writes} ${sawPrevious}`),
				}),
			]);
		}
		if (last.includes("<rethread-ledger")) return fauxAssistantMessage("READBACK: goal, first action, risk.");
		return fauxAssistantMessage(`Working on it. ${"x".repeat(Number(process.env.FAKE_PAD ?? 0))}`);
	};
	core.setResponses(Array.from({ length: 200 }, () => respond));
	pi.registerProvider("fake", {
		baseUrl: "http://fake.invalid",
		apiKey: "fake",
		api: "fake-api" as never,
		streamSimple: core.streamSimple as never,
		models: [
			{
				id: "fake-1",
				name: "Fake 1",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: ctxWindow,
				maxTokens: 4000,
			},
		],
	});
}
