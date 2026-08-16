import { describe, expect, it } from "vitest";

import {
	buildRagasSampleFromExecutionRun,
	parseExecutionRunEvalProjection,
} from "../src/execution-projection";

function runStepsPayload() {
	return {
		agentRuntimeEvalProjection: {
			rag: {
				answer: "奖学金评审同时受学生规则和学校通用规定约束。",
				retrieved_context_ids: ["doc:student-scholarship", "doc:institution-awards"],
				retrieved_contexts: ["学生奖学金评审条件。", "学校奖励管理通用规定。"],
			},
			run: {
				run_id: "run-001",
				trace_id: "trace-001",
			},
			schema_version: "agent_runtime_eval_projection.v3",
			tool_trajectory: {
				available_tools: [],
				conversation_id: "conv-001",
				decision_kind: "direct_answer",
				request_id: "req-001",
				run_id: "run-001",
				schema_version: "tool_trajectory.v3",
				tool_calls: [],
				trace_id: "trace-001",
			},
		},
	};
}

describe("execution run eval projection", () => {
	it("parses runtime RAG fields and the ordered public trajectory", () => {
		const projection = parseExecutionRunEvalProjection(runStepsPayload());

		expect(projection.retrievedContextIds).toEqual([
			"doc:student-scholarship",
			"doc:institution-awards",
		]);
		expect(projection.toolTrajectory.tool_calls).toHaveLength(0);
		expect(projection).not.toHaveProperty("resolvedTargets");
		expect(projection).not.toHaveProperty("campusDocsRetrieval");
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
