import { describe, expect, it } from "vitest";

import { parseAgentProductEvalResult } from "../src/product-result";

function payload(): Record<string, unknown> {
	return {
		eval_run_id: "eval-001",
		items: [
			{
				answer: "你好！",
				cited_context_ids: [],
				cited_contexts: [],
				case: {
					argument_mode: "name_only",
					case_id: "case-001",
					forbidden_context_ids: [],
					query: "你好",
					reference_context_ids: [],
					reference_contexts: [],
					reference_tool_calls: [],
				},
				request_id: "request-001",
				retrieved_context_ids: [],
				retrieved_contexts: [],
				tool_trajectory: {
					decision_kind: "direct_answer",
					schema_version: "tool_trajectory.v4",
					tool_calls: [],
				},
			},
		],
		schema_version: "agent_product_eval_result.v3",
	};
}

describe("agent product result contract", () => {
	it("parses a product result with empty retrieval", () => {
		const result = parseAgentProductEvalResult(payload());
		expect(result.items[0]?.retrievedContexts).toEqual([]);
	});

	it("rejects duplicate request identity", () => {
		const value = payload();
		const first = (value.items as Record<string, unknown>[])[0];
		(value.items as Record<string, unknown>[]).push({
			...first,
			case: { ...(first?.case as Record<string, unknown>), case_id: "case-002" },
		});
		expect(() => parseAgentProductEvalResult(value)).toThrow("request_id is duplicated");
	});

	it("rejects a v3 product result that omits cited contexts", () => {
		const value = payload();
		delete (value.items as Record<string, unknown>[])[0]?.cited_contexts;

		expect(() => parseAgentProductEvalResult(value)).toThrow(/cited_contexts must be a list/u);
	});
});
