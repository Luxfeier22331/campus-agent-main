import { describe, expect, it } from "vitest";

import { parseExecutionRunEvalProjection } from "../src/execution-projection";

const firstEvidenceRef = `evidence://${"a".repeat(64)}`;
const secondEvidenceRef = `evidence://${"b".repeat(64)}`;

function runStepsPayload() {
	return {
		agentRuntimeEvalProjection: {
			rag: {
				answer: "奖学金评审同时受学生规则和学校通用规定约束。",
				retrieved_context_ids: [firstEvidenceRef, secondEvidenceRef],
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

		expect(projection.retrievedContextIds).toEqual([firstEvidenceRef, secondEvidenceRef]);
		expect(projection.toolTrajectory.tool_calls).toHaveLength(0);
		expect(projection).not.toHaveProperty("resolvedTargets");
		expect(projection).not.toHaveProperty("campusDocsRetrieval");
	});

	it("rejects projection identity drift", () => {
		const payload = runStepsPayload();
		payload.agentRuntimeEvalProjection.tool_trajectory.trace_id = "trace-other";

		expect(() => parseExecutionRunEvalProjection(payload)).toThrow(/identity/i);
	});

	it("rejects context identifiers that do not align with retrieved contexts", () => {
		const payload = runStepsPayload();
		payload.agentRuntimeEvalProjection.rag.retrieved_context_ids = [firstEvidenceRef];

		expect(() => parseExecutionRunEvalProjection(payload)).toThrow(/equal length/i);
	});
});
