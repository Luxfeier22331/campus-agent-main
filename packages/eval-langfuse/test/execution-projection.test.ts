import { describe, expect, it } from "vitest";

import { parseExecutionRunEvalProjection } from "../src/execution-projection";

const firstResultRef = `result://${"a".repeat(64)}`;
const secondResultRef = `result://${"b".repeat(64)}`;

function runStepsPayload() {
	return {
		agentRuntimeEvalProjection: {
			answer: "奖学金评审同时受学生规则和学校通用规定约束。",
			cited_context_ids: [firstResultRef],
			cited_contexts: ["学生奖学金评审条件。"],
			request_id: "req-001",
			retrieved_context_ids: [firstResultRef, secondResultRef],
			retrieved_contexts: ["学生奖学金评审条件。", "学校奖励管理通用规定。"],
			schema_version: "agent_runtime_eval_projection.v5",
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

		expect(projection.retrievedContextIds).toEqual([firstResultRef, secondResultRef]);
		expect(projection.citedContextIds).toEqual([firstResultRef]);
		expect(projection.toolTrajectory.tool_calls).toHaveLength(0);
		expect(projection).not.toHaveProperty("resolvedTargets");
		expect(projection).not.toHaveProperty("campusDocsRetrieval");
	});

	it("does not accept the retired projection shape", () => {
		const payload = runStepsPayload();
		payload.agentRuntimeEvalProjection.schema_version = "agent_runtime_eval_projection.v3";

		expect(() => parseExecutionRunEvalProjection(payload)).toThrow(/v5/u);
	});

	it("rejects context identifiers that do not align with retrieved contexts", () => {
		const payload = runStepsPayload();
		payload.agentRuntimeEvalProjection.retrieved_context_ids = [firstResultRef];

		expect(() => parseExecutionRunEvalProjection(payload)).toThrow(/equal length/i);
	});

	it("rejects a v5 projection that omits cited contexts", () => {
		const payload = runStepsPayload();
		delete (payload.agentRuntimeEvalProjection as Record<string, unknown>).cited_contexts;

		expect(() => parseExecutionRunEvalProjection(payload)).toThrow(
			/cited_contexts must be a list/u,
		);
	});
});
