import { describe, expect, it } from "vitest";

import {
	parseToolTrajectory,
	scoreToolSequence,
	toolSequenceFromTrajectory,
} from "../src/tool-trajectory";

describe("tool trajectory projection", () => {
	it("parses the ordered public tool trajectory and scores the complete sequence", () => {
		const trajectory = parseToolTrajectory({
			available_tools: ["personal_memory_recall"],
			conversation_id: "conv_1",
			decision_kind: "tool_assisted",
			environment: "staging",
			release: "release-1",
			request_id: "req_1",
			run_id: "run_1",
			schema_version: "tool_trajectory.v3",
			surface: "campus-web",
			tool_calls: [
				{
					arguments_hash: "sha256:args",
					duration_ms: 42,
					result_kind: "typed_tool_result",
					status: "completed",
					tool_call_id: "call_1",
					tool_name: "personal_memory_recall",
				},
			],
			trace_id: "trace_1",
		});

		expect(toolSequenceFromTrajectory(trajectory)).toEqual(["personal_memory_recall"]);
		expect(scoreToolSequence(trajectory, ["personal_memory_recall"])).toBe(true);
		expect(scoreToolSequence(trajectory, [])).toBe(false);
	});

	it("rejects retired routing fields and tools", () => {
		expect(() =>
			parseToolTrajectory({
				available_tools: ["personal_memory_recall"],
				decision_kind: "tool_assisted",
				request_id: "req_1",
				run_id: "run_1",
				schema_version: "tool_trajectory.v3",
				selected_tool: "knowledge_query",
				tool_calls: [],
				trace_id: "trace_1",
			}),
		).toThrow(/forbidden/i);
		expect(() =>
			parseToolTrajectory({
				available_tools: ["retrieve_document_evidence"],
				decision_kind: "fail_closed",
				request_id: "req_1",
				run_id: "run_1",
				schema_version: "tool_trajectory.v3",
				tool_calls: [],
				trace_id: "trace_1",
			}),
		).toThrow(/active agent runtime tool/i);
	});

	it("does not count fail closed as a direct answer", () => {
		const trajectory = parseToolTrajectory({
			available_tools: ["personal_memory_recall"],
			decision_kind: "fail_closed",
			fail_close_reason: "tool_contract_missing",
			request_id: "req_1",
			run_id: "run_1",
			schema_version: "tool_trajectory.v3",
			tool_calls: [],
			trace_id: "trace_1",
		});

		expect(trajectory.decision_kind).toBe("fail_closed");
		expect(scoreToolSequence(trajectory, [])).toBe(true);
	});

	it("parses a bounded personal memory call without accepting memory content", () => {
		const trajectory = parseToolTrajectory({
			available_tools: ["personal_memory_recall"],
			decision_kind: "tool_assisted",
			request_id: "req_memory",
			run_id: "run_memory",
			schema_version: "tool_trajectory.v3",
			tool_calls: [
				{
					arguments_hash: "sha256:memory-query",
					duration_ms: 18,
					result_kind: "typed_tool_result",
					status: "completed",
					tool_call_id: "call_memory",
					tool_name: "personal_memory_recall",
				},
			],
			trace_id: "trace_memory",
		});

		expect(toolSequenceFromTrajectory(trajectory)).toEqual(["personal_memory_recall"]);
		expect(() =>
			parseToolTrajectory({
				...trajectory,
				tool_calls: [{ ...trajectory.tool_calls[0], memory_text: "不得进入评测轨迹" }],
			}),
		).toThrow(/forbidden/i);
	});
});
