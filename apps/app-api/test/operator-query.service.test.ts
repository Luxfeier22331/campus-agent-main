// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import type { ResolvedAppPrincipal } from "../src/modules/auth";
import { buildOperatorQueryService } from "../src/modules/operator-query";

function createOperatorPrincipal(): ResolvedAppPrincipal {
	return {
		actor: {
			departments: ["ops"],
			principalId: "ops@example.com",
			principalType: "operator",
			roles: ["operator"],
			userId: "ops@example.com",
		},
		permissions: {
			chat: false,
			operator: true,
		},
		principal: {
			displayName: "Ops Team",
			email: "ops@example.com",
			principalId: "ops@example.com",
			type: "operator",
		},
		session: null,
	};
}

describe("operator query service aggregate summaries", () => {
	it("normalizes quality summary filters before delegating to the store", async () => {
		const store = {
			getById: vi.fn(),
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
			getAuditById: vi.fn(),
			getSafetySummary: vi.fn(),
			getCostSummary: vi.fn(),
			listQualityBadcases: vi.fn(),
			listAudit: vi.fn(),
			list: vi.fn(),
		};
		const service = buildOperatorQueryService({
			store: store as never,
		});

		const result = await service.getQualitySummary({
			filters: {
				collection: " student_rules ",
				modelName: " gpt-5.2-mini ",
				principalType: " campus_member ",
				requestedCapability: " knowledge ",
				selectedTarget: " rag-agent ",
				surface: " public_chat_web ",
				window: "24h",
			},
			principal: createOperatorPrincipal(),
		});

		expect(store.getQualitySummary).toHaveBeenCalledWith({
			collection: "student_rules",
			granularity: null,
			modelName: "gpt-5.2-mini",
			principalType: "campus_member",
			requestedCapability: "knowledge",
			selectedTarget: "rag-agent",
			surface: "public_chat_web",
			window: "24h",
		});
		expect(result.runtime.requestCount).toBe(4);
		expect(result.sampledGrades?.coverageRate?.value).toBe(0.5);
	});

	it("normalizes safety summary filters before delegating to the store", async () => {
		const store = {
			getById: vi.fn(),
			getObservabilityById: vi.fn(),
			getOverview: vi.fn(),
			getQualitySummary: vi.fn(),
			getQualityTimeseries: vi.fn(),
			getAuditById: vi.fn(),
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
			getCostSummary: vi.fn(),
			listQualityBadcases: vi.fn(),
			listAudit: vi.fn(),
			list: vi.fn(),
		};
		const service = buildOperatorQueryService({
			store: store as never,
		});

		const result = await service.getSafetySummary({
			filters: {
				surface: " public_chat_web ",
				window: "7d",
			},
			principal: createOperatorPrincipal(),
		});

		expect(store.getSafetySummary).toHaveBeenCalledWith({
			collection: null,
			granularity: null,
			modelName: null,
			principalType: null,
			requestedCapability: null,
			selectedTarget: null,
			surface: "public_chat_web",
			window: "7d",
		});
		expect(result.summary.decisionDistribution.failClosed).toBe(1);
	});

	it("normalizes cost summary filters before delegating to the store", async () => {
		const store = {
			getById: vi.fn(),
			getObservabilityById: vi.fn(),
			getOverview: vi.fn(),
			getQualitySummary: vi.fn(),
			getQualityTimeseries: vi.fn(),
			getAuditById: vi.fn(),
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
					granularity: "1h",
					to: "2026-03-28T08:00:10.000Z",
				},
			}),
			listQualityBadcases: vi.fn(),
			listAudit: vi.fn(),
			list: vi.fn(),
		};
		const service = buildOperatorQueryService({
			store: store as never,
		});

		const result = await service.getCostSummary({
			filters: {
				modelName: " gpt-5.2-mini ",
				surface: " public_chat_web ",
				window: "1h",
			},
			principal: createOperatorPrincipal(),
		});

		expect(store.getCostSummary).toHaveBeenCalledWith({
			collection: null,
			granularity: null,
			modelName: "gpt-5.2-mini",
			principalType: null,
			requestedCapability: null,
			selectedTarget: null,
			surface: "public_chat_web",
			window: "1h",
		});
		expect(result.summary.tokens.input).toBe(812);
	});

	it("normalizes audit list filters before delegating to the store", async () => {
		const store = {
			getById: vi.fn(),
			getObservabilityById: vi.fn(),
			getOverview: vi.fn(),
			getQualitySummary: vi.fn(),
			getQualityTimeseries: vi.fn(),
			getAuditById: vi.fn(),
			getSafetySummary: vi.fn(),
			getCostSummary: vi.fn(),
			listQualityBadcases: vi.fn(),
			listAudit: vi.fn().mockResolvedValue({
				events: [],
				page: {
					nextCursor: "cursor_01HQ",
				},
			}),
			list: vi.fn(),
		};
		const service = buildOperatorQueryService({
			store: store as never,
		});

		const result = await service.listAudit({
			filters: {
				cursor: " cursor_01HQ ",
				eventType: " request.completed ",
				limit: 10,
				principalType: " campus_member ",
				requestId: " req_01HQ ",
				selectedTarget: " rag-agent ",
				status: " completed ",
				surface: " public_chat_web ",
				traceId: " trace_01HQ ",
			},
			principal: createOperatorPrincipal(),
		});

		expect(store.listAudit).toHaveBeenCalledWith({
			cursor: "cursor_01HQ",
			eventType: "request.completed",
			limit: 10,
			principalType: "campus_member",
			requestId: "req_01HQ",
			selectedTarget: "rag-agent",
			status: "completed",
			surface: "public_chat_web",
			traceId: "trace_01HQ",
		});
		expect(result.page.nextCursor).toBe("cursor_01HQ");
	});

	it("normalizes quality timeseries filters before delegating to the store", async () => {
		const store = {
			getById: vi.fn(),
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
						needsClarificationRate: 0.25,
						noAnswerRate: 0.25,
						requestCount: 4,
						emptyRecallRate: 0.25,
						sampledGroundingPassRate: null,
					},
				],
				window: {
					from: "2026-03-27T08:00:00.000Z",
					granularity: "1h",
					to: "2026-03-28T08:00:00.000Z",
				},
			}),
			getAuditById: vi.fn(),
			getSafetySummary: vi.fn(),
			getCostSummary: vi.fn(),
			listQualityBadcases: vi.fn(),
			listAudit: vi.fn(),
			list: vi.fn(),
		};
		const service = buildOperatorQueryService({
			store: store as never,
		});

		const result = await service.getQualityTimeseries({
			filters: {
				collection: " student_rules ",
				granularity: " 1h ",
				modelName: " gpt-5.2-mini ",
				principalType: " campus_member ",
				requestedCapability: " knowledge ",
				selectedTarget: " rag-agent ",
				surface: " public_chat_web ",
				window: "24h",
			},
			principal: createOperatorPrincipal(),
		});

		expect(store.getQualityTimeseries).toHaveBeenCalledWith({
			collection: "student_rules",
			granularity: "1h",
			modelName: "gpt-5.2-mini",
			principalType: "campus_member",
			requestedCapability: "knowledge",
			selectedTarget: "rag-agent",
			surface: "public_chat_web",
			window: "24h",
		});
		expect(result.series).toHaveLength(1);
	});

	it("rejects invalid quality timeseries window and granularity combinations", async () => {
		const store = {
			getById: vi.fn(),
			getObservabilityById: vi.fn(),
			getOverview: vi.fn(),
			getQualitySummary: vi.fn(),
			getQualityTimeseries: vi.fn(),
			getAuditById: vi.fn(),
			getSafetySummary: vi.fn(),
			getCostSummary: vi.fn(),
			listQualityBadcases: vi.fn(),
			listAudit: vi.fn(),
			list: vi.fn(),
		};
		const service = buildOperatorQueryService({
			store: store as never,
		});

		await expect(
			service.getQualityTimeseries({
				filters: {
					granularity: "5m",
					window: "7d",
				},
				principal: createOperatorPrincipal(),
			}),
		).rejects.toMatchObject({
			code: "validation_failed",
			status: 400,
		});
		expect(store.getQualityTimeseries).not.toHaveBeenCalled();
	});

	it("normalizes quality badcase list filters before delegating to the store", async () => {
		const store = {
			getById: vi.fn(),
			getObservabilityById: vi.fn(),
			getOverview: vi.fn(),
			getQualitySummary: vi.fn(),
			getQualityTimeseries: vi.fn(),
			getAuditById: vi.fn(),
			getSafetySummary: vi.fn(),
			getCostSummary: vi.fn(),
			listQualityBadcases: vi.fn().mockResolvedValue({
				badcases: [],
				page: {
					nextCursor: "cursor_01HQ",
				},
			}),
			listAudit: vi.fn(),
			list: vi.fn(),
		};
		const service = buildOperatorQueryService({
			store: store as never,
		});

		const result = await service.listQualityBadcases({
			filters: {
				causeClass: " citation_missing ",
				cursor: " cursor_01HQ ",
				detectedBy: " runtime_monitor ",
				limit: 10,
				status: " open ",
			},
			principal: createOperatorPrincipal(),
		});

		expect(store.listQualityBadcases).toHaveBeenCalledWith({
			causeClass: "citation_missing",
			cursor: "cursor_01HQ",
			detectedBy: "runtime_monitor",
			limit: 10,
			status: "open",
		});
		expect(result.page.nextCursor).toBe("cursor_01HQ");
	});
});
