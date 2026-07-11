import { describe, expect, it, vi } from "vitest";

import {
	buildLearningLoopCandidateDatasetItem,
	publishLearningLoopCandidateDatasetItems,
	verifyLearningLoopCandidateDatasetItems,
} from "../src/index";

const candidate = {
	category: "retrieval_source_fix",
	evidence: {
		failClosed: false,
		reasonCodes: ["missing_context"],
		selectedTool: "knowledge_query",
		status: "completed",
		traceAvailable: true,
	},
	feedbackId: "feedback_01",
	feedbackUpdatedAt: "2026-06-20T08:00:00.000Z",
	reason: "missing_context",
	requestId: "req_01",
	source: "message_feedback",
} as const;

describe("learning loop candidate dataset items", () => {
	it("builds safe Langfuse dataset item payloads without raw prompt, answer, or provider data", () => {
		const item = buildLearningLoopCandidateDatasetItem(candidate);

		expect(item).toMatchObject({
			datasetName: "online-answer/candidates",
			expectedOutput: null,
			input: {
				category: "retrieval_source_fix",
				requestId: "req_01",
			},
			metadata: {
				feedback_id: "feedback_01",
				source: "message_feedback",
			},
		});
		expect(JSON.stringify(item)).not.toMatch(
			/rawPrompt|rawAnswer|transcript|providerPayload|traceBody/i,
		);
	});

	it("fails closed when candidate identifiers are missing", () => {
		expect(() =>
			buildLearningLoopCandidateDatasetItem({
				...candidate,
				requestId: "",
			}),
		).toThrow("requestId is required");
		expect(() =>
			buildLearningLoopCandidateDatasetItem({
				...candidate,
				feedbackId: "",
			}),
		).toThrow("feedbackId is required");
	});

	it("builds runtime-only latency candidates without requiring feedback ids", () => {
		const item = buildLearningLoopCandidateDatasetItem({
			...candidate,
			evidence: {
				...candidate.evidence,
				budgetState: "warn",
				budgetVersion: "latency-budget-v1",
				debugTraceRefCount: 1,
				durationMs: 2700,
				stageField: "stream.browser_ttft_ms",
			},
			feedbackId: null,
			feedbackUpdatedAt: null,
			reason: "stream_ttft_too_slow",
			source: "runtime_observation",
		});

		expect(item).toMatchObject({
			input: {
				reason: "stream_ttft_too_slow",
				requestId: "req_01",
			},
			metadata: {
				budgetState: "warn",
				budgetVersion: "latency-budget-v1",
				debugTraceRefCount: 1,
				durationMs: 2700,
				feedback_id: null,
				feedback_updated_at: null,
				stageField: "stream.browser_ttft_ms",
				source: "runtime_observation",
			},
		});
	});

	it("deduplicates runtime candidates by request, stage field, and budget version", () => {
		const base = {
			...candidate,
			feedbackId: null,
			feedbackUpdatedAt: null,
			reason: "runtime_latency_outlier",
			source: "runtime_observation",
		} as const;
		const first = buildLearningLoopCandidateDatasetItem({
			...base,
			evidence: {
				...base.evidence,
				budgetState: "warn",
				budgetVersion: "latency-budget-v1",
				debugTraceRefCount: 1,
				durationMs: 2700,
				stageField: "stream.browser_ttft_ms",
			},
		});
		const second = buildLearningLoopCandidateDatasetItem({
			...base,
			evidence: {
				...base.evidence,
				budgetState: "critical",
				budgetVersion: "latency-budget-v1",
				debugTraceRefCount: 1,
				durationMs: 15_200,
				stageField: "agent.primary_ms",
			},
		});

		expect(first.id).not.toBe(second.id);
	});

	it("does not call Langfuse in dry-run mode", async () => {
		const client = {
			createDataset: vi.fn(),
			createDatasetItem: vi.fn(),
		};

		const result = await publishLearningLoopCandidateDatasetItems({
			candidates: [candidate],
			client,
			dryRun: true,
		});

		expect(result).toEqual({
			dryRun: true,
			publishedCount: 0,
			selectedCount: 1,
		});
		expect(client.createDatasetItem).not.toHaveBeenCalled();
	});

	it("verifies published dataset items by stable id", async () => {
		const item = buildLearningLoopCandidateDatasetItem(candidate);
		const client = {
			getDataset: vi.fn().mockResolvedValue({ items: [{ id: item.id }] }),
		};

		await expect(
			verifyLearningLoopCandidateDatasetItems({ candidates: [candidate], client }),
		).resolves.toEqual({
			expectedCount: 1,
			matchedCount: 1,
			missingIds: [],
		});
	});

	it("fails closed when published dataset items are missing", async () => {
		const client = {
			getDataset: vi.fn().mockResolvedValue({ items: [] }),
		};

		await expect(
			verifyLearningLoopCandidateDatasetItems({ candidates: [candidate], client }),
		).rejects.toThrow("missing learning-loop candidate dataset items");
	});
});
