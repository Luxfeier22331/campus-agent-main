import { describe, expect, it, vi } from "vitest";

import { publishCandidates, verifyPublishedCandidates } from "../src/publish";
import type { LearningLoopCandidatePublisher } from "../src/types";

describe("candidate publishing", () => {
	it("does not call the publisher in dry-run mode", async () => {
		const publisher: LearningLoopCandidatePublisher = {
			publish: vi.fn(),
		};

		const result = await publishCandidates({
			candidates: [
				{
					category: "retrieval_source_fix",
						evidence: {
							cachedInputTokens: 0,
							errorCode: null,
							failClosed: false,
							inputTokens: 10,
							modelName: "gpt-test",
							modelProvider: "openai",
							outputTokens: 5,
							projectionLagMs: 10,
							reasonCodes: ["missing_context"],
							status: "completed",
							totalTokens: 15,
							traceAvailable: true,
					},
					feedbackId: "feedback_01",
					feedbackUpdatedAt: "2026-06-20T08:00:00.000Z",
					reason: "missing_context",
					requestId: "req_01",
					source: "message_feedback",
				},
			],
			dryRun: true,
			publisher,
		});

		expect(result).toEqual({
			dryRun: true,
			publishedCount: 0,
			selectedCount: 1,
		});
		expect(publisher.publish).not.toHaveBeenCalled();
	});

	it("verifies published candidates through the publisher verification path", async () => {
		const publisher: LearningLoopCandidatePublisher = {
			publish: vi.fn(),
			verify: vi.fn().mockResolvedValue({
				expectedCount: 1,
				matchedCount: 1,
				missingIds: [],
			}),
		};
		const candidates = [
			{
				category: "model_provider_or_latency_budget_fix",
				evidence: {
					budgetState: "critical",
					budgetVersion: "latency-budget-v1",
					cachedInputTokens: 0,
					durationMs: 5500,
					errorCode: null,
					failClosed: false,
					inputTokens: 10,
					modelName: "gpt-test",
					modelProvider: "openai",
					outputTokens: 5,
					projectionLagMs: 10,
					reasonCodes: ["stream_app_api_ttft_too_slow"],
					stageField: "stream.app_api_ttft_ms",
					status: "completed",
					totalTokens: 15,
					traceAvailable: true,
				},
				feedbackId: null,
				feedbackUpdatedAt: null,
				reason: "stream_app_api_ttft_too_slow",
				requestId: "req_latency_01",
				source: "runtime_observation",
			},
		] as const;

		const result = await verifyPublishedCandidates({
			candidates: [...candidates],
			publisher,
		});

		expect(result).toEqual({
			expectedCount: 1,
			matchedCount: 1,
			missingIds: [],
			selectedCount: 1,
		});
		expect(publisher.verify).toHaveBeenCalledWith(candidates);
	});

	it("fails closed when the publisher cannot verify candidates", async () => {
		const publisher: LearningLoopCandidatePublisher = {
			publish: vi.fn(),
		};

		await expect(
			verifyPublishedCandidates({
				candidates: [],
				publisher,
			}),
		).rejects.toThrow("does not support verification");
	});
});
