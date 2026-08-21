import { describe, expect, it } from "vitest";

import { parseAgentProductEvalResult } from "../src/product-result";

function payload(): Record<string, unknown> {
	return {
		eval_run_id: "eval-001",
		items: [
			{
				case: {
					argument_mode: "name_only",
					case_id: "case-001",
					forbidden_context_ids: [],
					query: "你好",
					reference_context_ids: [],
					reference_contexts: [],
					reference_tool_calls: [],
				},
				projection: {
					retrieved_context_ids: [],
					retrieved_contexts: [],
					run_id: "run-001",
					trace_id: "trace-001",
					tool_trajectory: {
						available_tools: [],
						decision_kind: "direct_answer",
						request_id: "request-001",
						run_id: "run-001",
						schema_version: "tool_trajectory.v3",
						tool_calls: [],
						trace_id: "trace-001",
					},
				},
				terminal: {
					answer: "你好！",
					conversation_id: "conversation-001",
					request_id: "request-001",
					result_kind: "answer",
					run_id: "run-001",
					trace_id: "trace-001",
				},
			},
		],
		schema_version: "agent_product_eval_result.v1",
	};
}

describe("agent product result contract", () => {
	it("parses a product result with empty retrieval", () => {
		const result = parseAgentProductEvalResult(payload());
		expect(result.items[0]?.projection.retrievedContexts).toEqual([]);
	});

	it("rejects mismatched terminal and projection identity", () => {
		const value = payload();
		const item = (value.items as Record<string, unknown>[])[0];
		const terminal = item?.terminal as Record<string, unknown>;
		terminal.trace_id = "trace-other";
		expect(() => parseAgentProductEvalResult(value)).toThrow("identity do not match");
	});
});
