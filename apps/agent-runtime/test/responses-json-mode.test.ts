import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentRunnerInput } from "../src/agent-run-contract.ts";
import { createConfiguredRunner } from "../src/provider-config.ts";
import { runOpenAIModelTurn } from "../src/sdk-runner.ts";
import { loadToolCatalog } from "../src/tool-catalog.ts";
import { createWorkflowOperationRuntime } from "../src/workflow-runtime.ts";

const providerConfig = {
	provider: "openai-compatible",
	transport: "responses",
	model: "test",
	baseUrl: "https://provider.example/v1",
	apiKey: "test",
	hostedWebSearch: true,
};
const limits = {
	agentDeadlineMs: 90000,
	contextCharLimit: 32000,
	currentInputCharLimit: 8000,
	maxOutputTokens: 2048,
	maxFunctionToolCalls: 3,
	maxTurns: 4,
};
function input(operation: AgentRunnerInput["operation"]): AgentRunnerInput {
	return {
		providerConfig,
		operation,
		limits,
		requestId: "test",
		citationStart: 1,
		input: [{ role: "user", content: "查询偏好" }],
		instructions: "Return JSON.",
		allowWebSearch: true,
		tools: ["campus_search", "personal_memory_recall"].map((name) => ({
			name,
			description: name,
			parameters: {
				type: "object",
				properties: { query: { type: "string" } },
				required: ["query"],
				additionalProperties: false,
			},
			execute: async () => ({ status: "completed" as const, result: { outcome: "no_match" } }),
		})),
		...(operation === "synthesize"
			? {}
			: {
					outputSchema: {
						name: operation,
						schema: { type: "object", properties: {}, additionalProperties: false },
					},
				}),
	};
}
function message(text: string) {
	return {
		type: "message",
		id: "msg",
		role: "assistant",
		status: "completed",
		content: [{ type: "output_text", text, annotations: [] }],
	};
}
function streamResponse(output: unknown[]) {
	const response = {
		id: "resp",
		object: "response",
		created_at: 1,
		model: "test",
		status: "completed",
		output,
		usage: {
			input_tokens: 10,
			output_tokens: 5,
			total_tokens: 15,
			input_tokens_details: { cached_tokens: 0 },
			output_tokens_details: { reasoning_tokens: 0 },
		},
	};
	return new Response(
		`event: response.completed\ndata: ${JSON.stringify({ type: "response.completed", sequence_number: 0, response })}\n\n`,
		{ headers: { "content-type": "text/event-stream" } },
	);
}
function mockProvider(outputs: unknown[][]) {
	const requests: {
		stream: boolean;
		text?: { format?: { type: string } };
		tools: { type: string; name?: string; parameters: { required?: string[] } }[];
		instructions: string;
		input: unknown[];
	}[] = [];
	vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
		requests.push(JSON.parse(String(init?.body)));
		const output = outputs.shift();
		if (!output) {
			throw new Error("Unexpected provider call");
		}
		return streamResponse(output);
	});
	return requests;
}
afterEach(() => vi.restoreAllMocks());
describe("Responses JSON mode over streaming transport", () => {
	it.each(["solve", "execute_step", "replan", "synthesize"] as const)(
		"streams %s even without an answer delta callback",
		async (operation) => {
			const text =
				operation === "solve"
					? '{"result":{"outcome":"answer","answer":"hello"}}'
					: operation === "synthesize"
						? "hello"
						: "{}";
			const requests = mockProvider([[message(text)]]);
			const turn = await runOpenAIModelTurn(input(operation));
			expect(turn.result.failure).toBeUndefined();
			expect(requests[0]?.stream).toBe(true);
			expect(requests[0]?.tools.map((t) => t.name ?? t.type)).toEqual([
				"campus_search",
				"personal_memory_recall",
				"web_search",
			]);
			expect(requests[0]?.tools[0]?.parameters.required).toEqual(["query"]);
			if (operation === "synthesize") {
				expect(requests[0]?.text?.format?.type).not.toBe("json_object");
				expect(turn.result.finalOutput).toBe("hello");
			} else {
				expect(requests[0]?.text).toEqual({ format: { type: "json_object" } });
				expect(requests[0]?.instructions).toContain("application contract");
			}
		},
	);
	it("completes a buffered Runner tool loop using SSE and JSON object on both turns", async () => {
		const requests = mockProvider([
			[
				{
					type: "function_call",
					id: "call",
					call_id: "call",
					name: "personal_memory_recall",
					arguments: '{"query":"偏好"}',
					status: "completed",
				},
			],
			[message('{"result":{"outcome":"answer","answer":"hello"}}')],
		]);
		const result = await createConfiguredRunner()(input("solve"));
		expect(result.failure).toBeUndefined();
		expect(result.finalOutput).toBe("hello");
		expect(result.toolResults).toHaveLength(1);
		expect(requests).toHaveLength(2);
		for (const request of requests) {
			expect(request.stream).toBe(true);
			expect(request.text).toEqual({ format: { type: "json_object" } });
		}
		expect(requests[1]?.input).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ type: "function_call_output", call_id: "call" }),
			]),
		);
	});
	it.each(["not JSON", '{"result":{"outcome":"answer","answer":"hello","plan":{}}}'])(
		"rejects invalid output locally: %s",
		async (text) => {
			mockProvider([[message(text)]]);
			const runtime = createWorkflowOperationRuntime({
				catalog: loadToolCatalog(
					new URL("../../../configs/runtime/tools.v8.json", import.meta.url).pathname,
				),
				runner: createConfiguredRunner(),
			});
			const result = await runtime.run({
				operation: "solve",
				operationInput: { goal: "hello", maxSteps: 3 },
				providerConfig,
				limits,
				requestId: "test",
				conversationId: "test",
				visibleFunctionToolNames: [],
			});
			expect(result.status).toBe("failed");
			expect(result.failure?.code).toBe("model_output_invalid");
		},
	);
});
