import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";
import type { OperatorQueryService } from "../src/modules/operator-query";
import {
	createOperatorPrincipal,
	createOperatorQueryServiceMock,
	env,
} from "./operator-query.route.test-support";

export function registerOperatorQueryQualitySuite(): void {
	describe("GET /api/operator/overview", () => {
		it("returns an operator overview snapshot for operator principals", async () => {
			const service = {
				getById: vi.fn(),
				getAuditById: vi.fn(),
				getObservabilityById: vi.fn(),
				getOverview: vi.fn().mockResolvedValue({
					alerts: [
						{
							alertId: "opalert_safety_remote_01HQ",
							code: "safety.remote_content_suspicion_spike",
							domain: "safety",
							incidentBackfill: {
								mode: "incident_backfill",
								required: true,
							},
							requestCount: 3,
							severity: "high",
							startedAt: "2026-03-28T07:55:00.000Z",
							status: "open",
						},
					],
					asOf: "2026-03-28T08:00:10.000Z",
					overview: {
						aclAnomalyRate: {
							count: 0,
							eligibleCount: 4,
							value: 0,
						},
						citationMissRate: {
							count: 1,
							eligibleCount: 3,
							value: 0.3333,
						},
						emptyRecallRate: {
							count: 1,
							eligibleCount: 4,
							value: 0.25,
						},
						estimatedCost: {
							currency: "USD",
							microusd: 7620,
						},
						failureRate: {
							count: 1,
							eligibleCount: 4,
							value: 0.25,
						},
						latency: {
							p50Ms: 842,
							p95Ms: 1600,
							p99Ms: 1600,
						},
						refusalRate: {
							count: 1,
							eligibleCount: 4,
							value: 0.25,
						},
						requestVolume: {
							accepted: 4,
							completed: 3,
							errored: 1,
						},
						sinkHealth: {
							missingTraceRate: {
								count: 0,
								eligibleCount: 4,
								value: 0,
							},
							projectionFailureCount: 0,
						},
					},
					window: {
						from: "2026-03-27T08:00:10.000Z",
						granularity: "1h",
						to: "2026-03-28T08:00:10.000Z",
					},
				}),
				listAudit: vi.fn(),
				list: vi.fn(),
			} as unknown as OperatorQueryService;
			const principal = createOperatorPrincipal();
			const app = createApp(env, {
				getPrincipal: vi.fn().mockResolvedValue(principal),
				operatorQueryService: service,
			});

			const response = await app.fetch(
				new Request("https://app-api.internal/api/operator/overview?window=24h"),
			);

			expect(response.status).toBe(200);
			await expect(response.json()).resolves.toEqual({
				alerts: [
					{
						alertId: "opalert_safety_remote_01HQ",
						code: "safety.remote_content_suspicion_spike",
						domain: "safety",
						incidentBackfill: {
							mode: "incident_backfill",
							required: true,
						},
						requestCount: 3,
						severity: "high",
						startedAt: "2026-03-28T07:55:00.000Z",
						status: "open",
					},
				],
				asOf: "2026-03-28T08:00:10.000Z",
				overview: {
					aclAnomalyRate: {
						count: 0,
						eligibleCount: 4,
						value: 0,
					},
					citationMissRate: {
						count: 1,
						eligibleCount: 3,
						value: 0.3333,
					},
					emptyRecallRate: {
						count: 1,
						eligibleCount: 4,
						value: 0.25,
					},
					estimatedCost: {
						currency: "USD",
						microusd: 7620,
					},
					failureRate: {
						count: 1,
						eligibleCount: 4,
						value: 0.25,
					},
					latency: {
						p50Ms: 842,
						p95Ms: 1600,
						p99Ms: 1600,
					},
					refusalRate: {
						count: 1,
						eligibleCount: 4,
						value: 0.25,
					},
					requestVolume: {
						accepted: 4,
						completed: 3,
						errored: 1,
					},
					sinkHealth: {
						missingTraceRate: {
							count: 0,
							eligibleCount: 4,
							value: 0,
						},
						projectionFailureCount: 0,
					},
				},
				window: {
					from: "2026-03-27T08:00:10.000Z",
					granularity: "1h",
					to: "2026-03-28T08:00:10.000Z",
				},
			});
			expect(service.getOverview).toHaveBeenCalledWith({
				filters: {
					collection: null,
					granularity: null,
					modelName: null,
					principalType: null,
					requestedCapability: null,
					selectedTarget: null,
					surface: null,
					window: "24h",
				},
				principal,
			});
		});
	});

	describe("GET /api/operator/quality/summary", () => {
		it("returns a quality summary snapshot for operator principals", async () => {
			const service = {
				getById: vi.fn(),
				getAuditById: vi.fn(),
				getObservabilityById: vi.fn(),
				getOverview: vi.fn(),
				getQualitySummary: vi.fn().mockResolvedValue({
					asOf: "2026-03-28T08:00:10.000Z",
					runtime: {
						citationMissRate: {
							count: 1,
							eligibleCount: 2,
							value: 0.5,
						},
						emptyRecallRate: {
							count: 1,
							eligibleCount: 3,
							value: 0.3333,
						},
						refusalDistribution: {
							approvalRequired: 1,
							needsClarification: 1,
							noAnswer: 1,
							rejected: 0,
						},
						requestCount: 4,
					},
					sampledGrades: {
						badcaseOpenCount: 1,
						citationPassRate: {
							count: 1,
							eligibleCount: 2,
							value: 0.5,
						},
						coverageRate: {
							count: 2,
							eligibleCount: 4,
							value: 0.5,
						},
						groundingPassRate: {
							count: 1,
							eligibleCount: 2,
							value: 0.5,
						},
						intentPassRate: null,
						policyPassRate: {
							count: 2,
							eligibleCount: 2,
							value: 1,
						},
					},
					window: {
						from: "2026-03-27T08:00:10.000Z",
						granularity: "1h",
						to: "2026-03-28T08:00:10.000Z",
					},
				}),
				getQualityTimeseries: vi.fn(),
				getSafetySummary: vi.fn(),
				getCostSummary: vi.fn(),
				listQualityBadcases: vi.fn(),
				listAudit: vi.fn(),
				list: vi.fn(),
			};
			const principal = createOperatorPrincipal();
			const app = createApp(env, {
				getPrincipal: vi.fn().mockResolvedValue(principal),
				operatorQueryService: service as unknown as OperatorQueryService,
			});

			const response = await app.fetch(
				new Request(
					"https://app-api.internal/api/operator/quality/summary?window=24h&surface=public_chat_web",
				),
			);

			expect(response.status).toBe(200);
			await expect(response.json()).resolves.toEqual({
				asOf: "2026-03-28T08:00:10.000Z",
				runtime: {
					citationMissRate: {
						count: 1,
						eligibleCount: 2,
						value: 0.5,
					},
					emptyRecallRate: {
						count: 1,
						eligibleCount: 3,
						value: 0.3333,
					},
					refusalDistribution: {
						approvalRequired: 1,
						needsClarification: 1,
						noAnswer: 1,
						rejected: 0,
					},
					requestCount: 4,
				},
				sampledGrades: {
					badcaseOpenCount: 1,
					citationPassRate: {
						count: 1,
						eligibleCount: 2,
						value: 0.5,
					},
					coverageRate: {
						count: 2,
						eligibleCount: 4,
						value: 0.5,
					},
					groundingPassRate: {
						count: 1,
						eligibleCount: 2,
						value: 0.5,
					},
					intentPassRate: null,
					policyPassRate: {
						count: 2,
						eligibleCount: 2,
						value: 1,
					},
				},
				window: {
					from: "2026-03-27T08:00:10.000Z",
					granularity: "1h",
					to: "2026-03-28T08:00:10.000Z",
				},
			});
			expect(service.getQualitySummary).toHaveBeenCalledWith({
				filters: {
					collection: null,
					granularity: null,
					modelName: null,
					principalType: null,
					requestedCapability: null,
					selectedTarget: null,
					surface: "public_chat_web",
					window: "24h",
				},
				principal,
			});
		});
	});

	describe("GET /api/operator/intent/summary", () => {
		it("returns an intent governance summary for operator principals", async () => {
			const principal = createOperatorPrincipal();
			const service = createOperatorQueryServiceMock({
				getIntentSummary: vi.fn().mockResolvedValue({
					asOf: "2026-03-28T08:00:10.000Z",
					runtime: {
						ambiguityRate: { count: 2, eligibleCount: 10, value: 0.2 },
						contextUnresolvedRate: { count: 1, eligibleCount: 10, value: 0.1 },
						distributions: {
							capability: [{ count: 6, value: "knowledge" }],
							classifierVersion: [{ count: 10, value: "intent-classifier@2026-04-20" }],
							launchState: [{ count: 8, value: "open" }],
							nextAction: [{ count: 7, value: "delegate" }],
							schemaVersion: [{ count: 10, value: "intent-schema-1.0.0" }],
							scopeClass: [{ count: 9, value: "in_scope" }],
							taskKind: [{ count: 6, value: "knowledge_lookup" }],
						},
						lowConfidenceRate: { count: 1, eligibleCount: 10, value: 0.1 },
						requestCount: 10,
					},
					sampledGrades: {
						coverageRate: { count: 4, eligibleCount: 10, value: 0.4 },
						intentPassRate: { count: 3, eligibleCount: 4, value: 0.75 },
					},
					window: {
						from: "2026-03-27T08:00:10.000Z",
						granularity: "1h",
						to: "2026-03-28T08:00:10.000Z",
					},
				}),
			});
			const app = createApp(env, {
				getPrincipal: vi.fn().mockResolvedValue(principal),
				operatorQueryService: service,
			});

			const response = await app.fetch(
				new Request(
					"https://app-api.internal/api/operator/intent/summary?window=24h&surface=public_chat_web&selectedTarget=navigation-agent",
				),
			);

			expect(response.status).toBe(200);
			await expect(response.json()).resolves.toMatchObject({
				runtime: {
					lowConfidenceRate: { count: 1, eligibleCount: 10, value: 0.1 },
					requestCount: 10,
				},
				sampledGrades: {
					intentPassRate: { count: 3, eligibleCount: 4, value: 0.75 },
				},
			});
			expect(service.getIntentSummary).toHaveBeenCalledWith({
				filters: {
					collection: null,
					granularity: null,
					modelName: null,
					principalType: null,
					requestedCapability: null,
					selectedTarget: "navigation-agent",
					surface: "public_chat_web",
					window: "24h",
				},
				principal,
			});
		});
	});

	describe("GET /api/operator/quality/timeseries", () => {
		it("returns a quality timeseries snapshot for operator principals", async () => {
			const service = {
				getById: vi.fn(),
				getAuditById: vi.fn(),
				getObservabilityById: vi.fn(),
				getOverview: vi.fn(),
				getQualitySummary: vi.fn(),
				getQualityTimeseries: vi.fn().mockResolvedValue({
					asOf: "2026-03-28T08:00:10.000Z",
					series: [
						{
							bucketEnd: "2026-03-28T08:00:00.000Z",
							bucketStart: "2026-03-28T07:00:00.000Z",
							citationMissRate: 0.5,
							emptyRecallRate: 0.25,
							needsClarificationRate: 0.25,
							noAnswerRate: 0.25,
							requestCount: 4,
							sampledGroundingPassRate: 0.5,
						},
					],
					window: {
						from: "2026-03-27T08:00:10.000Z",
						granularity: "1h",
						to: "2026-03-28T08:00:10.000Z",
					},
				}),
				getSafetySummary: vi.fn(),
				getCostSummary: vi.fn(),
				listQualityBadcases: vi.fn(),
				listAudit: vi.fn(),
				list: vi.fn(),
			};
			const principal = createOperatorPrincipal();
			const app = createApp(env, {
				getPrincipal: vi.fn().mockResolvedValue(principal),
				operatorQueryService: service as unknown as OperatorQueryService,
			});

			const response = await app.fetch(
				new Request(
					"https://app-api.internal/api/operator/quality/timeseries?window=24h&granularity=1h&surface=public_chat_web",
				),
			);

			expect(response.status).toBe(200);
			await expect(response.json()).resolves.toEqual({
				asOf: "2026-03-28T08:00:10.000Z",
				series: [
					{
						bucketEnd: "2026-03-28T08:00:00.000Z",
						bucketStart: "2026-03-28T07:00:00.000Z",
						citationMissRate: 0.5,
						emptyRecallRate: 0.25,
						needsClarificationRate: 0.25,
						noAnswerRate: 0.25,
						requestCount: 4,
						sampledGroundingPassRate: 0.5,
					},
				],
				window: {
					from: "2026-03-27T08:00:10.000Z",
					granularity: "1h",
					to: "2026-03-28T08:00:10.000Z",
				},
			});
			expect(service.getQualityTimeseries).toHaveBeenCalledWith({
				filters: {
					collection: null,
					granularity: "1h",
					modelName: null,
					principalType: null,
					requestedCapability: null,
					selectedTarget: null,
					surface: "public_chat_web",
					window: "24h",
				},
				principal,
			});
		});
	});

	describe("GET /api/operator/quality/badcases", () => {
		it("returns a quality badcase queue for operator principals", async () => {
			const service = {
				getById: vi.fn(),
				getAuditById: vi.fn(),
				getObservabilityById: vi.fn(),
				getOverview: vi.fn(),
				getQualitySummary: vi.fn(),
				getQualityTimeseries: vi.fn(),
				getSafetySummary: vi.fn(),
				getCostSummary: vi.fn(),
				listQualityBadcases: vi.fn().mockResolvedValue({
					badcases: [
						{
							badcaseId: "qbad_01HQ",
							causeClass: "citation_missing",
							detectedBy: "runtime_monitor",
							grade: {
								graderVersion: "grader@2026-04-03",
								result: "fail",
								score: 0.42,
							},
							links: {
								issueFingerprint: "citation-missing",
								issueLink: "https://sentry.example/issues/456",
								traceLink: "https://sentry.example/traces/trace_01HQ",
							},
							openedAt: "2026-03-28T08:00:10.000Z",
							requestId: "req_01HQ",
							selectedTarget: "rag-agent",
							status: "open",
							summary: "citationExpected=true 但 citationCount=0",
							surface: "public_chat_web",
							traceId: "trace_01HQ",
						},
					],
					page: {
						nextCursor: null,
					},
				}),
				listAudit: vi.fn(),
				list: vi.fn(),
			};
			const principal = createOperatorPrincipal();
			const app = createApp(env, {
				getPrincipal: vi.fn().mockResolvedValue(principal),
				operatorQueryService: service as unknown as OperatorQueryService,
			});

			const response = await app.fetch(
				new Request(
					"https://app-api.internal/api/operator/quality/badcases?status=open&causeClass=citation_missing&detectedBy=runtime_monitor",
				),
			);

			expect(response.status).toBe(200);
			await expect(response.json()).resolves.toEqual({
				badcases: [
					{
						badcaseId: "qbad_01HQ",
						causeClass: "citation_missing",
						detectedBy: "runtime_monitor",
						grade: {
							graderVersion: "grader@2026-04-03",
							result: "fail",
							score: 0.42,
						},
						links: {
							issueFingerprint: "citation-missing",
							issueLink: "https://sentry.example/issues/456",
							traceLink: "https://sentry.example/traces/trace_01HQ",
						},
						openedAt: "2026-03-28T08:00:10.000Z",
						requestId: "req_01HQ",
						selectedTarget: "rag-agent",
						status: "open",
						summary: "citationExpected=true 但 citationCount=0",
						surface: "public_chat_web",
						traceId: "trace_01HQ",
					},
				],
				page: {
					nextCursor: null,
				},
			});
			expect(service.listQualityBadcases).toHaveBeenCalledWith({
				filters: {
					causeClass: "citation_missing",
					cursor: null,
					detectedBy: "runtime_monitor",
					limit: null,
					status: "open",
				},
				principal,
			});
		});
	});

	describe("GET /api/operator/quality/eval-candidates", () => {
		it("returns app-safe eval candidate intake derived from quality badcases", async () => {
			const service = {
				getById: vi.fn(),
				getAuditById: vi.fn(),
				getObservabilityById: vi.fn(),
				getOverview: vi.fn(),
				getQualitySummary: vi.fn(),
				getQualityTimeseries: vi.fn(),
				getSafetySummary: vi.fn(),
				getCostSummary: vi.fn(),
				listQualityBadcases: vi.fn(),
				listQualityEvalCandidates: vi.fn().mockResolvedValue({
					candidates: [
						{
							candidateId: "eval_candidate:req_01HQ:unsupported_by_evidence",
							causeClass: "unsupported_by_evidence",
							grade: {
								graderVersion: "grader@2026-04-03",
								result: "fail",
								score: 0.25,
							},
							intake: {
								createdAt: "2026-03-28T08:00:10.000Z",
								source: "operator_badcase",
								status: "pending_review",
								suggestedEvalFamily: "grounding",
							},
							links: {
								issueFingerprint: "unsupported-by-evidence",
								issueLink: "https://sentry.example/issues/456",
								traceLink: "https://sentry.example/traces/trace_01HQ",
							},
							requestId: "req_01HQ",
							selectedTarget: "rag-agent",
							summary: "semanticOutcome=unsupported_by_evidence 或存在 unsupported claims",
							surface: "public_chat_web",
							traceId: "trace_01HQ",
						},
					],
					page: {
						nextCursor: null,
					},
				}),
				listAudit: vi.fn(),
				list: vi.fn(),
			};
			const principal = createOperatorPrincipal();
			const app = createApp(env, {
				getPrincipal: vi.fn().mockResolvedValue(principal),
				operatorQueryService: service as unknown as OperatorQueryService,
			});

			const response = await app.fetch(
				new Request(
					"https://app-api.internal/api/operator/quality/eval-candidates?status=open&causeClass=unsupported_by_evidence&detectedBy=runtime_monitor",
				),
			);

			expect(response.status).toBe(200);
			await expect(response.json()).resolves.toEqual({
				candidates: [
					{
						candidateId: "eval_candidate:req_01HQ:unsupported_by_evidence",
						causeClass: "unsupported_by_evidence",
						grade: {
							graderVersion: "grader@2026-04-03",
							result: "fail",
							score: 0.25,
						},
						intake: {
							createdAt: "2026-03-28T08:00:10.000Z",
							source: "operator_badcase",
							status: "pending_review",
							suggestedEvalFamily: "grounding",
						},
						links: {
							issueFingerprint: "unsupported-by-evidence",
							issueLink: "https://sentry.example/issues/456",
							traceLink: "https://sentry.example/traces/trace_01HQ",
						},
						requestId: "req_01HQ",
						selectedTarget: "rag-agent",
						summary: "semanticOutcome=unsupported_by_evidence 或存在 unsupported claims",
						surface: "public_chat_web",
						traceId: "trace_01HQ",
					},
				],
				page: {
					nextCursor: null,
				},
			});
			expect(service.listQualityEvalCandidates).toHaveBeenCalledWith({
				filters: {
					causeClass: "unsupported_by_evidence",
					cursor: null,
					detectedBy: "runtime_monitor",
					limit: null,
					status: "open",
				},
				principal,
			});
		});
	});
}
