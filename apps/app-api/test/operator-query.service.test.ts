// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { buildOperatorQueryService } from "../src/modules/operator-query";

import { createOperatorPrincipal } from "./operator-query.route.test-support";

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

	it("rejects non-empty invalid overview windows before delegating to the store", async () => {
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
			service.getQualitySummary({
				filters: {
					window: "48h",
				},
				principal: createOperatorPrincipal(),
			}),
		).rejects.toMatchObject({
			code: "validation_failed",
			status: 400,
		});
		expect(store.getQualitySummary).not.toHaveBeenCalled();
	});

	it("rejects non-empty invalid timeseries granularities before delegating to the store", async () => {
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
					granularity: "10m",
					window: "24h",
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
				selectedTarget: " rag-agent ",
				status: " open ",
				surface: " public_chat_web ",
				window: " 24h ",
			},
			principal: createOperatorPrincipal(),
		});

		expect(store.listQualityBadcases).toHaveBeenCalledWith({
			causeClass: "citation_missing",
			cursor: "cursor_01HQ",
			detectedBy: "runtime_monitor",
			limit: 10,
			selectedTarget: "rag-agent",
			status: "open",
			surface: "public_chat_web",
			window: "24h",
		});
		expect(result.page.nextCursor).toBe("cursor_01HQ");
	});

	it("derives eval candidate intake from the operator badcase queue without mutating eval truth", async () => {
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
				badcases: [
					{
						badcaseId: "req_01HQ:unsupported_by_evidence",
						causeClass: "unsupported_by_evidence",
						detectedBy: "runtime_monitor",
						grade: {
							graderVersion: "grader@2026-04-03",
							result: "fail",
							score: 0.25,
						},
						links: {
							issueFingerprint: "unsupported-by-evidence",
							issueLink: "https://sentry.example/issues/456",
							traceLink: "https://sentry.example/traces/trace_01HQ",
						},
						openedAt: "2026-03-28T08:00:10.000Z",
						requestId: "req_01HQ",
						runId: "run_01HQ",
						selectedTarget: "rag-agent",
						status: "open",
						summary: "semanticOutcome=unsupported_by_evidence 或存在 unsupported claims",
						surface: "public_chat_web",
						traceId: "trace_01HQ",
					},
					{
						badcaseId: "req_01HR:intent_classifier_mismatch",
						causeClass: "intent_classifier_mismatch",
						detectedBy: "runtime_monitor",
						grade: {
							graderVersion: "grader@2026-04-03",
							result: "fail",
							score: 0.1,
						},
						links: {
							issueFingerprint: "intent-classifier-mismatch",
							issueLink: null,
							traceLink: "https://sentry.example/traces/trace_01HR",
						},
						openedAt: "2026-03-28T08:03:10.000Z",
						requestId: "req_01HR",
						runId: "run_01HR",
						selectedTarget: "navigation-agent",
						status: "open",
						summary: "intent classifier selected the wrong handoff target",
						surface: "public_chat_web",
						traceId: "trace_01HR",
					},
				],
				page: {
					nextCursor: null,
				},
			}),
			listAudit: vi.fn(),
			list: vi.fn(),
		};
		const service = buildOperatorQueryService({
			store: store as never,
		});

		const result = await service.listQualityEvalCandidates({
			filters: {
				causeClass: " unsupported_by_evidence ",
				cursor: null,
				detectedBy: " runtime_monitor ",
				limit: 10,
				selectedTarget: " rag-agent ",
				status: " open ",
				surface: " public_chat_web ",
				window: " 24h ",
			},
			principal: createOperatorPrincipal(),
		});

		expect(store.listQualityBadcases).toHaveBeenCalledWith({
			causeClass: "unsupported_by_evidence",
			cursor: null,
			detectedBy: "runtime_monitor",
			limit: 10,
			selectedTarget: "rag-agent",
			status: "open",
			surface: "public_chat_web",
			window: "24h",
		});
		expect(result).toEqual({
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
					runId: "run_01HQ",
					selectedTarget: "rag-agent",
					summary: "semanticOutcome=unsupported_by_evidence 或存在 unsupported claims",
					surface: "public_chat_web",
					traceId: "trace_01HQ",
				},
				{
					candidateId: "eval_candidate:req_01HR:intent_classifier_mismatch",
					causeClass: "intent_classifier_mismatch",
					grade: {
						graderVersion: "grader@2026-04-03",
						result: "fail",
						score: 0.1,
					},
					intake: {
						createdAt: "2026-03-28T08:03:10.000Z",
						source: "operator_badcase",
						status: "pending_review",
						suggestedEvalFamily: "intent",
					},
					links: {
						issueFingerprint: "intent-classifier-mismatch",
						issueLink: null,
						traceLink: "https://sentry.example/traces/trace_01HR",
					},
					requestId: "req_01HR",
					runId: "run_01HR",
					selectedTarget: "navigation-agent",
					summary: "intent classifier selected the wrong handoff target",
					surface: "public_chat_web",
					traceId: "trace_01HR",
				},
			],
			page: {
				nextCursor: null,
			},
		});
	});

	it("exports negative feedback candidates through the quality eval candidate seam", async () => {
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
			listQualityFeedbackEvalCandidates: vi.fn().mockResolvedValue({
				candidates: [
					{
						candidateId: "eval_candidate:negative_feedback:feedback_01",
						causeClass: "wrong_intent",
						feedback: {
							feedbackId: "feedback_01",
							reasonCodes: ["wrong_intent"],
							updatedAt: "2026-03-28T08:11:00.000Z",
							vote: "unhelpful",
						},
						grade: null,
						intake: {
							createdAt: "2026-03-28T08:11:00.000Z",
							source: "negative_feedback",
							status: "pending_review",
							suggestedEvalFamily: "intent",
						},
						links: {
							issueFingerprint: null,
							issueLink: null,
							traceLink: null,
						},
						requestId: "req_feedback_01",
						selectedTarget: "rag-agent",
						summary: "Negative answer feedback for answer: wrong_intent.",
						surface: "public_chat_web",
						traceId: "trace_feedback_01",
					},
				],
				page: {
					nextCursor: null,
				},
			}),
			listAudit: vi.fn(),
			list: vi.fn(),
		};
		const service = buildOperatorQueryService({
			store: store as never,
		});

		const result = await service.listQualityEvalCandidates({
			filters: {
				causeClass: " wrong_intent ",
				cursor: null,
				detectedBy: " negative_feedback ",
				limit: 10,
				selectedTarget: " rag-agent ",
				status: " pending_review ",
				surface: " public_chat_web ",
				window: " 24h ",
			},
			principal: createOperatorPrincipal(),
		});

		expect(store.listQualityBadcases).not.toHaveBeenCalled();
		expect(store.listQualityFeedbackEvalCandidates).toHaveBeenCalledWith({
			causeClass: "wrong_intent",
			cursor: null,
			detectedBy: "negative_feedback",
			limit: 10,
			selectedTarget: "rag-agent",
			status: "pending_review",
			surface: "public_chat_web",
			window: "24h",
		});
		expect(result.candidates).toHaveLength(1);
		expect(result.candidates[0]?.intake.source).toBe("negative_feedback");
	});
});
