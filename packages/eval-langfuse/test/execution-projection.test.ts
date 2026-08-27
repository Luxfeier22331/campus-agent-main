import { describe, expect, it } from "vitest";

import { parseExecutionRunEvalProjection } from "../src/execution-projection";

const firstEvidenceRef = `evidence://${"a".repeat(64)}`;
const secondEvidenceRef = `evidence://${"b".repeat(64)}`;

function runStepsPayload() {
	return {
		agentRuntimeEvalProjection: {
			answer: "奖学金评审同时受学生规则和学校通用规定约束。",
			request_id: "req-001",
			retrieved_context_ids: [firstEvidenceRef, secondEvidenceRef],
			retrieved_contexts: ["学生奖学金评审条件。", "学校奖励管理通用规定。"],
			schema_version: "agent_runtime_eval_projection.v4",
			tool_trajectory: {
				decision_kind: "direct_answer",
				schema_version: "tool_trajectory.v4",
				tool_calls: [],
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

	it("does not accept the retired projection shape", () => {
		const payload = runStepsPayload();
		payload.agentRuntimeEvalProjection.schema_version = "agent_runtime_eval_projection.v3";

		expect(() => parseExecutionRunEvalProjection(payload)).toThrow(/v4/u);
	});

	it("rejects context identifiers that do not align with retrieved contexts", () => {
		const payload = runStepsPayload();
		payload.agentRuntimeEvalProjection.retrieved_context_ids = [firstEvidenceRef];

		expect(() => parseExecutionRunEvalProjection(payload)).toThrow(/equal length/i);
	});
});
