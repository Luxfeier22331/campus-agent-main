import { describe, expect, it } from "vitest";

import {
	IMPROVEMENT_CATEGORIES,
	buildLearningLoopCandidates,
} from "../src/selector";
import type { CandidateSourceRow } from "../src/types";

const baseRow: CandidateSourceRow = {
	feedbackId: "feedback_01",
	requestId: "req_01",
	vote: "unhelpful",
	reasonCodes: ["missing_context"],
	feedbackUpdatedAt: "2026-06-20T08:00:00.000Z",
	status: "completed",
	errorCode: null,
	selectedTool: "knowledge_query",
	requestedTool: "knowledge_query",
	toolFailCloseReason: null,
	toolBusinessOutcome: "answered",
	failClosed: false,
	retrievalAttempted: true,
	retrievedSourceCount: 2,
	retrievalAdequacyVerdict: "adequate",
	retrievalAdequacyReason: "enough_evidence",
	modelProvider: "openai",
	modelName: "gpt-test",
	modelExecutionState: "completed",
	modelExecutionDetail: "completed",
	durationMs: 1200,
	traceAvailable: true,
	projectionLagMs: 100,
};

describe("learning loop candidate selector", () => {
	it("selects unhelpful feedback without carrying raw prompt or answer text", () => {
		const [candidate] = buildLearningLoopCandidates([baseRow]);

		expect(candidate).toMatchObject({
			category: "retrieval_source_fix",
			reason: "missing_context",
			requestId: "req_01",
			source: "message_feedback",
		});
		expect(JSON.stringify(candidate)).not.toMatch(
			/rawPrompt|rawAnswer|transcript|providerPayload|traceBody/i,
		);
	});

	it("does not select helpful feedback unless the runtime fail-closed", () => {
		expect(
			buildLearningLoopCandidates([
				{
					...baseRow,
					vote: "helpful",
				},
			]),
		).toEqual([]);

		const [candidate] = buildLearningLoopCandidates([
			{
				...baseRow,
				failClosed: true,
				toolFailCloseReason: "tool_schema_validation_failed",
				vote: "helpful",
			},
		]);

		expect(candidate).toMatchObject({
			category: "tool_schema_or_description_fix",
			reason: "tool_schema_validation_failed",
		});
	});

	it("selects runtime-only candidates when critical latency budget is breached", () => {
		const candidates = buildLearningLoopCandidates([
			{
				...baseRow,
				feedbackId: null,
				feedbackUpdatedAt: null,
				reasonCodes: [],
				stageTiming: {
					"agent.runtime_ms": 13_000,
					"request.total_ms": 14_000,
				},
				vote: null,
			},
		]);
		const candidate = candidates.find(
			(item) => item.evidence.stageField === "agent.runtime_ms",
		);

		expect(candidate).toMatchObject({
			category: "model_provider_or_latency_budget_fix",
			reason: "agent_runtime_too_slow",
			requestId: "req_01",
			source: "runtime_observation",
		});
		expect(candidate?.evidence.budgetVersion).toBe("latency-budget-v1");
		expect(candidate?.evidence.budgetState).toBe("critical");
		expect(candidate?.evidence.stageField).toBe("agent.runtime_ms");
		expect(candidate?.evidence.durationMs).toBe(13_000);
		expect(candidates.map((item) => item.evidence.stageField)).not.toContain("request.total_ms");
	});

	it("emits one runtime latency candidate per critical stage", () => {
		const candidates = buildLearningLoopCandidates([
			{
				...baseRow,
				feedbackId: null,
				feedbackUpdatedAt: null,
				reasonCodes: [],
				stageTiming: {
					"agent.runtime_ms": 13_000,
					"stream.browser_ttft_ms": 5_500,
				},
				vote: null,
			},
		]);

		expect(candidates).toHaveLength(2);
		expect(candidates.map((item) => item.evidence.stageField).sort()).toEqual([
			"agent.runtime_ms",
			"stream.browser_ttft_ms",
		]);
	});

	it("keeps candidate categories inside the fixed learning taxonomy", () => {
		const candidates = buildLearningLoopCandidates([
			{ ...baseRow, reasonCodes: ["bad_tone"] },
			{
				...baseRow,
				feedbackId: "feedback_02",
				requestId: "req_02",
				modelExecutionState: "timeout",
				reasonCodes: ["too_slow"],
			},
			{
				...baseRow,
				feedbackId: "feedback_03",
				requestId: "req_03",
				reasonCodes: ["wrong_tool"],
				selectedTool: "campus_notice_discover",
			},
		]);

		expect(candidates.map((candidate) => candidate.category)).toEqual([
			"prompt_instruction_fix",
			"model_provider_or_latency_budget_fix",
			"tool_admission_or_routing_fix",
		]);
		expect(candidates.every((candidate) => IMPROVEMENT_CATEGORIES.includes(candidate.category))).toBe(
			true,
		);
	});
});
