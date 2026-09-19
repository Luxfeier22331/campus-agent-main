import { describe, expect, it } from "vitest";
import type {
	AgentRunnerInput,
	AgentRunnerResult,
	StreamingAgentRunner,
} from "../src/agent-run-contract.ts";
import { createFunctionToolContext, invokeFunctionTool } from "../src/function-tools.ts";
import { type RetrievalObservation, streamWithRetrieval } from "../src/retrieval-status.ts";

const input: AgentRunnerInput = {
	requestId: "r",
	operation: "execute_step",
	input: [],
	instructions: "",
	tools: [],
	allowWebSearch: true,
	citationStart: 1,
	providerConfig: {
		provider: "google",
		transport: "generate_content",
		model: "test",
		apiKey: "test",
	},
	limits: {
		agentDeadlineMs: 90000,
		contextCharLimit: 16000,
		currentInputCharLimit: 8000,
		maxFunctionToolCalls: 3,
		maxTurns: 4,
	},
};
const result: AgentRunnerResult = {
	finalOutput: "答案",
	providerResponseId: "test",
	toolResults: [],
	usage: { modelRequestCount: 1, inputTokens: 0, outputTokens: 0, usageObserved: false },
};
async function observations(
	runner: StreamingAgentRunner,
	overrides: Partial<AgentRunnerInput> = {},
) {
	const events: RetrievalObservation[] = [];
	for await (const event of streamWithRetrieval({ ...input, ...overrides }, runner)) {
		if ("retrieval" in event) {
			events.push(event.retrieval);
		}
	}
	return events;
}
describe("retrieval stream", () => {
	it("delivers a start while the tool is still running", async () => {
		let release!: () => void;
		const wait = new Promise<void>((resolve) => {
			release = resolve;
		});
		const stream = streamWithRetrieval(input, async function* (input) {
			input.reportRetrieval?.("campus", "a", "started");
			await wait;
			input.reportRetrieval?.("campus", "a", "completed");
			yield result;
		});
		expect(await stream.next()).toMatchObject({
			value: { retrieval: { source: "campus", status: "started" } },
		});
		release();
		expect(await stream.next()).toMatchObject({ value: { retrieval: { status: "completed" } } });
		expect(await stream.next()).toMatchObject({ value: result });
		expect((await stream.next()).done).toBe(true);
	});
	it("aggregates concurrent calls and deduplicates provider events", async () => {
		const events = await observations(async function* (input) {
			for (const id of ["a", "a", "b"]) {
				input.reportRetrieval?.("campus", id, "started");
			}
			input.reportRetrieval?.("campus", "a", "completed");
			input.reportRetrieval?.("campus", "a", "started");
			input.reportRetrieval?.("campus", "c", "started");
			input.reportRetrieval?.("campus", "c", "no_match");
			input.reportRetrieval?.("campus", "b", "completed");
			yield result;
		});
		expect(events.map(({ source, status }) => [source, status])).toEqual([
			["campus", "started"],
			["campus", "completed"],
		]);
	});
	it("does not infer searching from a final grounding result", async () => {
		expect(
			await observations(async function* () {
				yield { ...result, webSearchUsed: true };
			}),
		).toEqual([]);
	});
	it.each([false, true])("closes an interrupted retrieval (canceled=%s)", async (canceled) => {
		const controller = new AbortController();
		const events = await observations(
			async function* (input) {
				input.reportRetrieval?.("campus", "c", "started");
				if (canceled) {
					controller.abort();
				}
				yield { ...result, failure: { code: "failed", operation: "execute_step" } };
			},
			{ signal: controller.signal },
		);
		expect(events.map((event) => event.status)).toEqual([
			"started",
			canceled ? "canceled" : "failed",
		]);
	});
	it.each([0, 1])("uses actual campus tool result count %s", async (count) => {
		const events = await observations(async function* (input) {
			await invokeFunctionTool(
				{
					name: "campus_search",
					description: "",
					execute: async () => ({
						status: "completed",
						result: { results: count ? [{ citation_index: 1 }] : [] },
					}),
				},
				{},
				createFunctionToolContext(input),
				"campus-call",
			);
			yield result;
		});
		expect(events.map((event) => event.status)).toEqual([
			"started",
			count ? "completed" : "no_match",
		]);
	});
});
