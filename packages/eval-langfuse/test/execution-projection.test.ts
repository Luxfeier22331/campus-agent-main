import { describe, expect, it } from "vitest";

import {
	buildRagasSampleFromExecutionRun,
	parseExecutionRunEvalProjection,
} from "../src/execution-projection";

function runStepsPayload() {
	return {
		agentRuntimeEvalProjection: {
			planning: {
				resolved_targets: ["student_rules", "institutional_rules"],
			},
			rag: {
				answer: "奖学金评审同时受学生规则和学校通用规定约束。",
				retrieved_context_ids: ["doc:student-scholarship", "doc:institution-awards"],
				retrieved_contexts: ["学生奖学金评审条件。", "学校奖励管理通用规定。"],
			},
			run: {
				run_id: "run-001",
				trace_id: "trace-001",
			},
			schema_version: "agent_runtime_eval_projection.v2",
			tool_trajectory: {
				available_tools: ["knowledge_query"],
				conversation_id: "conv-001",
				decision_kind: "tool_call",
				internal_tool_calls: [
					{
						eval_safe_args: { include_history: false, target: "student_rules" },
						outcome: "found",
						result_kind: "knowledge_search_result",
						search_ordinal: 1,
						status: "completed",
						tool_call_id: "search-001",
						tool_name: "knowledge_search",
					},
				],
				request_id: "req-001",
				run_id: "run-001",
				schema_version: "tool_trajectory.v2",
				selected_tool: "knowledge_query",
				tool_calls: [
					{
						result_kind: "agent_handoff",
						status: "completed",
						tool_call_id: "handoff-001",
						tool_name: "knowledge_query",
					},
				],
				trace_id: "trace-001",
			},
		},
	};
}

describe("execution run eval projection", () => {
	it("parses runtime RAG fields and public/internal trajectories", () => {
		const projection = parseExecutionRunEvalProjection(runStepsPayload());

		expect(projection.resolvedTargets).toEqual(["student_rules", "institutional_rules"]);
		expect(projection.retrievedContextIds).toEqual([
			"doc:student-scholarship",
			"doc:institution-awards",
		]);
		expect(projection.toolTrajectory.tool_calls).toHaveLength(1);
		expect(projection.toolTrajectory.internal_tool_calls).toHaveLength(1);
	});

	it("materializes an official Ragas sample from run projection and dataset truth", () => {
		expect(
			buildRagasSampleFromExecutionRun({
				caseId: "cross-target-scholarship",
				datasetItemId: "dataset-item-001",
				question: "奖学金评审需要看哪些规定？",
				reference: "需要同时核对学生奖学金规则和学校奖励通用规定。",
				referenceContextIds: ["doc:student-scholarship", "doc:institution-awards"],
				runStepsPayload: runStepsPayload(),
			}),
		).toMatchObject({
			answer: "奖学金评审同时受学生规则和学校通用规定约束。",
			contexts: ["学生奖学金评审条件。", "学校奖励管理通用规定。"],
			retrieved_context_ids: ["doc:student-scholarship", "doc:institution-awards"],
			trace_id: "trace-001",
		});
	});

	it("rejects projection identity drift", () => {
		const payload = runStepsPayload();
		payload.agentRuntimeEvalProjection.tool_trajectory.trace_id = "trace-other";

		expect(() => parseExecutionRunEvalProjection(payload)).toThrow(/identity/i);
	});
});
