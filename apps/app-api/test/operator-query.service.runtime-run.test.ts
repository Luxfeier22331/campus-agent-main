// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import type { ExecutionGatewayRuntimeClient } from "../src/modules/integration";
import { buildOperatorQueryService } from "../src/modules/operator-query";
import { createOperatorPrincipal } from "./operator-query.route.test-support";

describe("operator query service aggregate summaries", () => {
	it("attaches sanitized durable runtime run summaries to request observability", async () => {
		const store = {
			getById: vi.fn(),
			getAuditById: vi.fn(),
			getCostSummary: vi.fn(),
			getCostTimeseries: vi.fn(),
			getEvalCoverage: vi.fn(),
			getIntentSummary: vi.fn(),
			getIntentTimeseries: vi.fn(),
			getObservabilityById: vi.fn().mockResolvedValue({
				auditSummary: {
					auditEventCount: 0,
					latestTerminalCode: "completed",
				},
				links: {
					issueFingerprint: null,
					issueLink: null,
					traceLink: "https://sentry.example/traces/trace_01HQ",
				},
				observability: {
					aclAnomalyCode: null,
					aclDecision: "allowed",
					cachedInputTokens: null,
					candidateCount: null,
					claimSupportSummary: null,
					citationCount: 0,
					citationExpected: null,
					citationMissing: null,
					durationMs: 842,
					emptyRecall: null,
					estimatedCost: {
						currency: "USD",
						microusd: null,
					},
					failClosed: false,
					inputTokens: null,
					measuredAt: "2026-06-04T01:02:06.000Z",
					model: {
						name: null,
						provider: null,
					},
					outputTokens: null,
					prompt: {
						id: null,
						runtimeDetail: null,
						runtimeState: null,
						templateSha256: null,
						version: null,
					},
					projectionLagMs: null,
					refusalClass: null,
					retrievedSourceCount: null,
					retrievalAdequacyReason: null,
					retrievalAdequacyVerdict: null,
					retrievalAttempted: null,
					sourceTrace: {
						retrieved: [],
						supporting: [],
					},
					traceAvailable: true,
				},
				replay: {
					answerQuality: {
						citationCount: 0,
						citationExpected: null,
						citationMissing: null,
						claimSupportSummary: null,
						freshnessFailClosed: null,
						groundingDowngraded: null,
						groundingVerdict: null,
						policyReason: null,
					},
					context: {
						applicabilityScope: null,
						entitlementGroups: [],
						entitlementSnapshotId: null,
						policyProjectionVersion: null,
						principalType: "campus_member",
						visibilityScope: null,
					},
					execution: {
						errorCode: null,
						failClosed: false,
						refusalClass: null,
						scopeClass: null,
						semanticOutcome: null,
						status: "completed",
					},
					prompt: {
						id: null,
						runtimeDetail: null,
						runtimeState: null,
						templateSha256: null,
						version: null,
					},
					retrieval: {
						adequacyReason: null,
						adequacyVerdict: null,
						candidateCount: null,
						emptyRecall: null,
						retrievalAttempted: null,
						retrievedSourceCount: null,
						sourceTraceCounts: {
							retrieved: 0,
							supporting: 0,
						},
					},
					routing: {
						requestedCapability: "knowledge",
						requestedScope: null,
						resolvedScope: null,
						selectedTarget: "rag-agent",
					},
				},
				request: {
					completedAt: "2026-06-04T01:02:06.000Z",
					conversationId: "conv_01HQ",
					requestId: "req_01HQ",
					runId: "run_01HQ",
					requestedCapability: "knowledge",
					requestedScope: null,
					resolvedScope: null,
					selectedTarget: "rag-agent",
					startedAt: "2026-06-04T01:02:03.000Z",
					status: "completed",
					surface: "public_chat_web",
					traceId: "trace_01HQ",
				},
			}),
			getOverview: vi.fn(),
			getQualitySummary: vi.fn(),
			getQualityTimeseries: vi.fn(),
			getSafetySummary: vi.fn(),
			list: vi.fn(),
			listAudit: vi.fn(),
			listQualityBadcases: vi.fn(),
			listQualityEvalCandidates: vi.fn(),
			listSafetyAnomalies: vi.fn(),
		};
		const durableRuntime: ExecutionGatewayRuntimeClient = {
			cancelRun: vi.fn(),
			createRun: vi.fn(),
			getRun: vi.fn().mockResolvedValue({
				admittedAt: "2026-06-04T01:02:04.000Z",
				completedAt: "2026-06-04T01:02:06.000Z",
				conversationId: "conv_01HQ",
				createdAt: "2026-06-04T01:02:03.000Z",
				failCloseReason: "",
				finalResponseRef: "",
				lane: "rag",
				ownerUserId: "user_01HQ",
				requestId: "req_01HQ",
				requestedCapability: "knowledge",
				runId: "run_01HQ",
				selectedCapability: "knowledge",
				startedAt: "2026-06-04T01:02:04.000Z",
				status: "completed",
				streamingStartedAt: "2026-06-04T01:02:05.000Z",
				surface: "public_chat_web",
				terminalReason: "answer_completed",
				traceId: "trace_01HQ",
				turnId: "turn_01HQ",
				updatedAt: "2026-06-04T01:02:06.000Z",
				workflowPlanRef: "",
			}),
			listRunEvents: vi.fn().mockResolvedValue([
				{
					conversationId: "conv_01HQ",
					eventId: "event-1",
					eventType: "run.started",
					occurredAt: "2026-06-04T01:02:04.000Z",
					payload: { raw_prompt: "must not leak" },
					payloadSchemaVersion: "run-event-v1",
					runId: "run_01HQ",
					sequence: 1,
					visibility: "internal",
				},
				{
					conversationId: "conv_01HQ",
					eventId: "event-2",
					eventType: "finalization.completed",
					occurredAt: "2026-06-04T01:02:06.000Z",
					payload: { raw_answer: "must not leak" },
					payloadSchemaVersion: "run-event-v1",
					runId: "run_01HQ",
					sequence: 2,
					visibility: "browser",
				},
			]),
		};
		const service = buildOperatorQueryService({
			durableRuntime,
			store: store as never,
		} as never);

		const result = await service.getObservabilityById({
			principal: createOperatorPrincipal(),
			requestId: "req_01HQ",
		});

		expect(durableRuntime.getRun).toHaveBeenCalledWith({
			runId: "run_01HQ",
			traceId: "trace_01HQ",
		});
		expect(durableRuntime.listRunEvents).toHaveBeenCalledWith({
			runId: "run_01HQ",
			traceId: "trace_01HQ",
		});
		expect(result.runtimeRun).toEqual({
			eventSummary: {
				eventCount: 2,
				latestEvent: {
					eventType: "finalization.completed",
					occurredAt: "2026-06-04T01:02:06.000Z",
					sequence: 2,
					visibility: "browser",
				},
				terminalEvent: {
					eventType: "finalization.completed",
					occurredAt: "2026-06-04T01:02:06.000Z",
					sequence: 2,
					visibility: "browser",
				},
				visibilityCounts: {
					browser: 1,
					eval: 0,
					internal: 1,
					panel: 0,
				},
			},
			run: {
				conversationId: "conv_01HQ",
				phase: "completed",
				requestId: "req_01HQ",
				runId: "run_01HQ",
				status: "completed",
				terminalReason: "answer_completed",
				traceId: "trace_01HQ",
			},
		});
		expect(JSON.stringify(result.runtimeRun)).not.toContain("must not leak");
	});
});
