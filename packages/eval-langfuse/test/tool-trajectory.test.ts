import { describe, expect, it } from "vitest";

import {
	expectedToolFromTrajectory,
	parseToolTrajectory,
	scoreToolSelection,
} from "../src/tool-trajectory";

describe("tool trajectory projection", () => {
	it("parses sanitized tool trajectory and scores tool selection", () => {
		const trajectory = parseToolTrajectory({
			available_tools: ["knowledge_query", "transport_schedule_lookup"],
			conversation_id: "conv_1",
			decision_kind: "tool_call",
			environment: "staging",
			internal_tool_calls: [
				{
					candidate_count: 4,
					duration_ms: 42,
					eval_safe_args: { include_history: false, target: "student_rules" },
					outcome: "found",
					query_hash: "sha256:query",
					result_kind: "knowledge_search_result",
					search_ordinal: 1,
					status: "completed",
					tool_call_id: "search_1",
					tool_name: "knowledge_search",
				},
			],
			release: "release-1",
			request_id: "req_1",
			run_id: "run_1",
			schema_version: "tool_trajectory.v2",
			selected_tool: "knowledge_query",
			surface: "campus-web",
			tool_calls: [
				{
					arguments_hash: "sha256:args",
					result_kind: "knowledge_query",
					status: "completed",
					tool_call_id: "call_1",
					tool_name: "knowledge_query",
				},
			],
			trace_id: "trace_1",
		});

		expect(expectedToolFromTrajectory(trajectory)).toBe("knowledge_query");
		expect(scoreToolSelection(trajectory, "knowledge_query")).toBe(true);
		expect(scoreToolSelection(trajectory, "transport_schedule_lookup")).toBe(false);
		expect(trajectory.internal_tool_calls).toEqual([
			expect.objectContaining({
				search_ordinal: 1,
				outcome: "found",
				eval_safe_args: { include_history: false, target: "student_rules" },
			}),
		]);
	});

	it("rejects forbidden payload fields instead of sanitizing in eval", () => {
		expect(() =>
			parseToolTrajectory({
				decision_kind: "tool_call",
				raw_provider_response: "must not enter eval",
				request_id: "req_1",
				run_id: "run_1",
				schema_version: "tool_trajectory.v2",
				selected_tool: "knowledge_query",
				tool_calls: [],
				trace_id: "trace_1",
			}),
		).toThrow(/forbidden/i);
	});

	it("does not count fail closed as a direct answer", () => {
		const trajectory = parseToolTrajectory({
			available_tools: ["knowledge_query", "transport_schedule_lookup"],
			decision_kind: "fail_closed",
			fail_close_reason: "tool_contract_missing",
			internal_tool_calls: [],
			request_id: "req_1",
			run_id: "run_1",
			schema_version: "tool_trajectory.v2",
			tool_calls: [],
			trace_id: "trace_1",
		});

		expect(scoreToolSelection(trajectory, "direct_answer")).toBe(false);
	});
});
