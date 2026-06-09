import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";
import type { OperatorQueryService } from "../src/modules/operator-query";
import { createOperatorPrincipal, env } from "./operator-query.route.test-support";

export function registerOperatorQuerySafetyCostAuditSuite(): void {
	describe("GET /api/operator/safety/summary", () => {
		it("returns a safety summary snapshot for operator principals", async () => {
			const service = {
				getById: vi.fn(),
				getAuditById: vi.fn(),
				getObservabilityById: vi.fn(),
				getOverview: vi.fn(),
				getQualitySummary: vi.fn(),
				getQualityTimeseries: vi.fn(),
				getSafetySummary: vi.fn().mockResolvedValue({
					asOf: "2026-03-28T08:00:10.000Z",
					summary: {
						aclAnomalyRate: {
							count: 1,
							eligibleCount: 4,
							value: 0.25,
						},
						decisionDistribution: {
							allowed: 2,
							approvalRequired: 1,
							denied: 1,
							failClosed: 1,
						},
						failClosedRate: {
							count: 1,
							eligibleCount: 4,
							value: 0.25,
						},
						restrictedDenyRate: {
							count: 1,
							eligibleCount: 4,
							value: 0.25,
						},
					},
					window: {
						from: "2026-03-27T08:00:10.000Z",
						granularity: "1h",
						to: "2026-03-28T08:00:10.000Z",
					},
				}),
				listQualityBadcases: vi.fn(),
				getCostSummary: vi.fn(),
				listAudit: vi.fn(),
				list: vi.fn(),
			};
			const principal = createOperatorPrincipal();
			const app = createApp(env, {
				getPrincipal: vi.fn().mockResolvedValue(principal),
				operatorQueryService: service as unknown as OperatorQueryService,
			});

			const response = await app.fetch(
				new Request("https://app-api.internal/api/operator/safety/summary?window=7d"),
			);

			expect(response.status).toBe(200);
			await expect(response.json()).resolves.toEqual({
				asOf: "2026-03-28T08:00:10.000Z",
				summary: {
					aclAnomalyRate: {
						count: 1,
						eligibleCount: 4,
						value: 0.25,
					},
					decisionDistribution: {
						allowed: 2,
						approvalRequired: 1,
						denied: 1,
						failClosed: 1,
					},
					failClosedRate: {
						count: 1,
						eligibleCount: 4,
						value: 0.25,
					},
					restrictedDenyRate: {
						count: 1,
						eligibleCount: 4,
						value: 0.25,
					},
				},
				window: {
					from: "2026-03-27T08:00:10.000Z",
					granularity: "1h",
					to: "2026-03-28T08:00:10.000Z",
				},
			});
			expect(service.getSafetySummary).toHaveBeenCalledWith({
				filters: {
					collection: null,
					granularity: null,
					modelName: null,
					principalType: null,
					requestedCapability: null,
					selectedCapability: null,
					surface: null,
					window: "7d",
				},
				principal,
			});
		});
	});

	describe("GET /api/operator/safety/anomalies", () => {
		it("returns a safety anomaly queue for operator principals", async () => {
			const service = {
				getById: vi.fn(),
				getAuditById: vi.fn(),
				getObservabilityById: vi.fn(),
				getOverview: vi.fn(),
				getQualitySummary: vi.fn(),
				getQualityTimeseries: vi.fn(),
				getSafetySummary: vi.fn(),
				listSafetyAnomalies: vi.fn().mockResolvedValue({
					anomalies: [
						{
							anomalyCode: "projection_missing",
							anomalyId: "aclanom_01HQ",
							detectedAt: "2026-03-28T08:00:10.000Z",
							links: {
								issueFingerprint: "projection-missing",
								issueLink: "https://sentry.example/issues/789",
								traceLink: "https://sentry.example/traces/trace_01HQ",
							},
							principalType: "campus_member",
							requestId: "req_01HQ",
							selectedCapability: "knowledge",
							severity: "high",
							status: "open",
							summary:
								"knowledge request finalized without the required policy projection for knowledge.",
							surface: "public_chat_web",
							traceId: "trace_01HQ",
						},
					],
					page: {
						nextCursor: null,
					},
				}),
				getCostSummary: vi.fn(),
				getCostTimeseries: vi.fn(),
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
					"https://app-api.internal/api/operator/safety/anomalies?limit=10&window=24h&surface=public_chat_web&selectedCapability=knowledge&severity=high&anomalyCode=projection_missing",
				),
			);

			expect(response.status).toBe(200);
			await expect(response.json()).resolves.toEqual({
				anomalies: [
					{
						anomalyCode: "projection_missing",
						anomalyId: "aclanom_01HQ",
						detectedAt: "2026-03-28T08:00:10.000Z",
						links: {
							issueFingerprint: "projection-missing",
							issueLink: "https://sentry.example/issues/789",
							traceLink: "https://sentry.example/traces/trace_01HQ",
						},
						principalType: "campus_member",
						requestId: "req_01HQ",
						selectedCapability: "knowledge",
						severity: "high",
						status: "open",
						summary:
							"knowledge request finalized without the required policy projection for knowledge.",
						surface: "public_chat_web",
						traceId: "trace_01HQ",
					},
				],
				page: {
					nextCursor: null,
				},
			});
			expect(service.listSafetyAnomalies).toHaveBeenCalledWith({
				filters: {
					anomalyCode: "projection_missing",
					cursor: null,
					limit: 10,
					selectedCapability: "knowledge",
					severity: "high",
					status: null,
					surface: "public_chat_web",
					window: "24h",
				},
				principal,
			});
		});
	});

	describe("GET /api/operator/cost/summary", () => {
		it("returns a cost summary snapshot for operator principals", async () => {
			const service = {
				getById: vi.fn(),
				getAuditById: vi.fn(),
				getObservabilityById: vi.fn(),
				getOverview: vi.fn(),
				getQualitySummary: vi.fn(),
				getQualityTimeseries: vi.fn(),
				getSafetySummary: vi.fn(),
				getCostSummary: vi.fn().mockResolvedValue({
					asOf: "2026-03-28T08:00:10.000Z",
					summary: {
						byModel: [
							{
								estimatedCostMicrousd: 3810,
								modelName: "gpt-5.2-mini",
								requestCount: 1,
							},
						],
						bySurface: [
							{
								estimatedCostMicrousd: 3810,
								requestCount: 1,
								surface: "public_chat_web",
							},
						],
						estimatedCost: {
							currency: "USD",
							microusd: 3810,
						},
						tokens: {
							cachedInput: 0,
							input: 812,
							output: 229,
						},
					},
					window: {
						from: "2026-03-27T08:00:10.000Z",
						granularity: "15m",
						to: "2026-03-28T08:00:10.000Z",
					},
				}),
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
					"https://app-api.internal/api/operator/cost/summary?window=1h&modelName=gpt-5.2-mini",
				),
			);

			expect(response.status).toBe(200);
			await expect(response.json()).resolves.toEqual({
				asOf: "2026-03-28T08:00:10.000Z",
				summary: {
					byModel: [
						{
							estimatedCostMicrousd: 3810,
							modelName: "gpt-5.2-mini",
							requestCount: 1,
						},
					],
					bySurface: [
						{
							estimatedCostMicrousd: 3810,
							requestCount: 1,
							surface: "public_chat_web",
						},
					],
					estimatedCost: {
						currency: "USD",
						microusd: 3810,
					},
					tokens: {
						cachedInput: 0,
						input: 812,
						output: 229,
					},
				},
				window: {
					from: "2026-03-27T08:00:10.000Z",
					granularity: "15m",
					to: "2026-03-28T08:00:10.000Z",
				},
			});
			expect(service.getCostSummary).toHaveBeenCalledWith({
				filters: {
					collection: null,
					granularity: null,
					modelName: "gpt-5.2-mini",
					principalType: null,
					requestedCapability: null,
					selectedCapability: null,
					surface: null,
					window: "1h",
				},
				principal,
			});
		});
	});

	describe("GET /api/operator/cost/timeseries", () => {
		it("returns a cost timeseries snapshot for operator principals", async () => {
			const service = {
				getById: vi.fn(),
				getAuditById: vi.fn(),
				getObservabilityById: vi.fn(),
				getOverview: vi.fn(),
				getQualitySummary: vi.fn(),
				getQualityTimeseries: vi.fn(),
				getSafetySummary: vi.fn(),
				listSafetyAnomalies: vi.fn(),
				getCostSummary: vi.fn(),
				getCostTimeseries: vi.fn().mockResolvedValue({
					asOf: "2026-03-28T08:00:10.000Z",
					series: [
						{
							bucketEnd: "2026-03-28T08:00:00.000Z",
							bucketStart: "2026-03-28T07:00:00.000Z",
							cachedInputTokens: 0,
							estimatedCostMicrousd: 3810,
							inputTokens: 812,
							outputTokens: 229,
						},
					],
					window: {
						from: "2026-03-27T08:00:10.000Z",
						granularity: "1h",
						to: "2026-03-28T08:00:10.000Z",
					},
				}),
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
					"https://app-api.internal/api/operator/cost/timeseries?window=24h&granularity=1h&surface=public_chat_web",
				),
			);

			expect(response.status).toBe(200);
			await expect(response.json()).resolves.toEqual({
				asOf: "2026-03-28T08:00:10.000Z",
				series: [
					{
						bucketEnd: "2026-03-28T08:00:00.000Z",
						bucketStart: "2026-03-28T07:00:00.000Z",
						cachedInputTokens: 0,
						estimatedCostMicrousd: 3810,
						inputTokens: 812,
						outputTokens: 229,
					},
				],
				window: {
					from: "2026-03-27T08:00:10.000Z",
					granularity: "1h",
					to: "2026-03-28T08:00:10.000Z",
				},
			});
			expect(service.getCostTimeseries).toHaveBeenCalledWith({
				filters: {
					collection: null,
					granularity: "1h",
					modelName: null,
					principalType: null,
					requestedCapability: null,
					selectedCapability: null,
					surface: "public_chat_web",
					window: "24h",
				},
				principal,
			});
		});
	});

	describe("GET /api/operator/audit", () => {
		it("returns an audit event list for operator principals", async () => {
			const service = {
				getById: vi.fn(),
				getAuditById: vi.fn(),
				getObservabilityById: vi.fn(),
				getOverview: vi.fn(),
				getQualitySummary: vi.fn(),
				getSafetySummary: vi.fn(),
				getCostSummary: vi.fn(),
				listAudit: vi.fn().mockResolvedValue({
					events: [
						{
							auditEventId: "aevt_01HQ",
							eventType: "request.completed",
							occurredAt: "2026-03-28T08:00:01.000Z",
							principalType: "campus_member",
							requestId: "req_01HQ",
							selectedCapability: "knowledge",
							status: "completed",
							summary: "Knowledge request completed via knowledge.",
							surface: "public_chat_web",
							traceId: "trace_01HQ",
						},
					],
					page: {
						nextCursor: "cursor_01HQ",
					},
				}),
				list: vi.fn(),
			};
			const principal = createOperatorPrincipal();
			const app = createApp(env, {
				getPrincipal: vi.fn().mockResolvedValue(principal),
				operatorQueryService: service as unknown as OperatorQueryService,
			});

			const response = await app.fetch(
				new Request(
					"https://app-api.internal/api/operator/audit?limit=10&requestId=req_01HQ&eventType=request.completed",
				),
			);

			expect(response.status).toBe(200);
			await expect(response.json()).resolves.toEqual({
				events: [
					{
						auditEventId: "aevt_01HQ",
						eventType: "request.completed",
						occurredAt: "2026-03-28T08:00:01.000Z",
						principalType: "campus_member",
						requestId: "req_01HQ",
						selectedCapability: "knowledge",
						status: "completed",
						summary: "Knowledge request completed via knowledge.",
						surface: "public_chat_web",
						traceId: "trace_01HQ",
					},
				],
				page: {
					nextCursor: "cursor_01HQ",
				},
			});
			expect(service.listAudit).toHaveBeenCalledWith({
				filters: {
					cursor: null,
					eventType: "request.completed",
					limit: 10,
					principalType: null,
					requestId: "req_01HQ",
					selectedCapability: null,
					status: null,
					surface: null,
					traceId: null,
				},
				principal,
			});
		});
	});

	describe("GET /api/operator/audit/:auditEventId", () => {
		it("returns one audit event detail for operator principals", async () => {
			const service = {
				getById: vi.fn(),
				getAuditById: vi.fn().mockResolvedValue({
					event: {
						auditEventId: "aevt_01HQ",
						diagnostics: {
							aclAnomalyCode: null,
							failClosed: false,
							sourceDocIds: ["handbook:library-hours"],
						},
						entitlementSnapshotId: "entitlements-2026-03-29",
						eventType: "request.completed",
						occurredAt: "2026-03-28T08:00:01.000Z",
						policyProjectionVersion: "2026-03-29",
						principalType: "campus_member",
						requestId: "req_01HQ",
						requestedCapability: "knowledge",
						selectedCapability: "knowledge",
						status: "completed",
						summary: "Knowledge request completed via knowledge.",
						surface: "public_chat_web",
						terminalCode: "completed",
						traceId: "trace_01HQ",
					},
					links: {
						issueFingerprint: "timeout:execution-control",
						issueLink: "https://sentry.example/issues/123",
						traceLink: "https://sentry.example/traces/trace_01HQ",
					},
				}),
				getObservabilityById: vi.fn(),
				getOverview: vi.fn(),
				getQualitySummary: vi.fn(),
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
				new Request("https://app-api.internal/api/operator/audit/aevt_01HQ"),
			);

			expect(response.status).toBe(200);
			await expect(response.json()).resolves.toEqual({
				event: {
					auditEventId: "aevt_01HQ",
					diagnostics: {
						aclAnomalyCode: null,
						failClosed: false,
						sourceDocIds: ["handbook:library-hours"],
					},
					entitlementSnapshotId: "entitlements-2026-03-29",
					eventType: "request.completed",
					occurredAt: "2026-03-28T08:00:01.000Z",
					policyProjectionVersion: "2026-03-29",
					principalType: "campus_member",
					requestId: "req_01HQ",
					requestedCapability: "knowledge",
					selectedCapability: "knowledge",
					status: "completed",
					summary: "Knowledge request completed via knowledge.",
					surface: "public_chat_web",
					terminalCode: "completed",
					traceId: "trace_01HQ",
				},
				links: {
					issueFingerprint: "timeout:execution-control",
					issueLink: "https://sentry.example/issues/123",
					traceLink: "https://sentry.example/traces/trace_01HQ",
				},
			});
			expect(service.getAuditById).toHaveBeenCalledWith({
				auditEventId: "aevt_01HQ",
				principal,
			});
		});
	});
}
