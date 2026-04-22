// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
	buildRequestProjectionProjector,
	type ProjectionOutboxEvent,
	type RequestExecutionProjectionSource,
	type RequestProjectionProjectorStore,
} from "../src/modules/projection";

function createExecutionSource(
	overrides: Partial<RequestExecutionProjectionSource> = {},
): RequestExecutionProjectionSource {
	return {
		answerPreview: "图书馆开放到 22:00。",
		aclAnomalyCode: null,
		aclDecision: "allowed",
		applicabilityScope: "undergraduate",
		completedAt: "2026-03-28T08:00:01.000Z",
		conversationId: "conv_01HQ",
		diagnostics: null,
		durationMs: 842,
		errorCode: null,
		entitlementGroups: ["students"],
		entitlementSnapshotId: "entitlements-2026-03-29",
		citationExpected: false,
		citationMissing: false,
		emptyRecall: false,
		failClosed: false,
		modelName: null,
		policyProjectionVersion: "2026-03-29",
		principalId: "user_01HQ",
		principalLabel: "Jane Doe",
		principalType: "student",
		projectedAtHint: "2026-03-28T08:00:02.000Z",
		questionPreview: "图书馆开放到几点？",
		requestId: "req_01HQ",
		retrievalAttempted: false,
		requestedCapability: "knowledge",
		requestedScope: {
			collection: "student_rules",
			corpus: "regulations",
		},
		versionQuery: null,
		resolvedScope: {
			collection: "student_rules",
			corpus: "regulations",
		},
		selectedTarget: "rag-agent",
		sourceDocIds: ["handbook:library-hours"],
		startedAt: "2026-03-28T08:00:00.000Z",
		status: "completed",
		surface: "public_chat_web",
		traceId: "trace_01HQ",
		visibilityScope: "main",
		...overrides,
	};
}

function createPendingEvent(overrides: Partial<ProjectionOutboxEvent> = {}): ProjectionOutboxEvent {
	return {
		attemptCount: 0,
		availableAt: "2026-03-28T08:00:02.000Z",
		eventId: "evt_accepted",
		eventType: "request.completed",
		occurredAt: "2026-03-28T08:00:02.000Z",
		processedAt: null,
		requestId: "req_01HQ",
		...overrides,
	};
}

describe("request projection projector", () => {
	it("materializes request_execution truth into operator.request_projection and marks events processed", async () => {
		const store: RequestProjectionProjectorStore = {
			getRequestExecution: vi.fn().mockResolvedValue(
				createExecutionSource({
					versionQuery: {
						compareToVersionId: "v2025-student-rules",
						mode: "compare",
						versionId: "v2024-student-rules",
					},
				}),
			),
			listPendingEvents: vi.fn().mockResolvedValue([createPendingEvent()]),
			listPendingEventsForRequest: vi.fn(),
			markEventFailed: vi.fn(),
			markEventProcessed: vi.fn(),
			markObservabilityProjected: vi.fn(),
			replaceQualityBadcases: vi.fn(),
			replaceQualityRollups: vi.fn(),
			upsertAuditProjection: vi.fn(),
			upsertProjection: vi.fn(),
		};
		const projector = buildRequestProjectionProjector({
			now: () => new Date("2026-03-28T08:00:03.000Z"),
			store,
		});

		const result = await projector.drain();

		expect(result).toEqual({
			failed: 0,
			processed: 1,
		});
		expect(store.upsertProjection).toHaveBeenCalledWith({
			answerPreview: "图书馆开放到 22:00。",
			applicabilityScope: "undergraduate",
			completedAt: "2026-03-28T08:00:01.000Z",
			conversationId: "conv_01HQ",
			diagnostics: null,
			durationMs: 842,
			errorCode: null,
			entitlementGroups: ["students"],
			entitlementSnapshotId: "entitlements-2026-03-29",
			principalId: "user_01HQ",
			principalLabel: "Jane Doe",
			principalType: "student",
			projectedAt: "2026-03-28T08:00:03.000Z",
			questionPreview: "图书馆开放到几点？",
			requestId: "req_01HQ",
			requestedCapability: "knowledge",
			requestedScope: {
				collection: "student_rules",
				corpus: "regulations",
			},
			versionQuery: {
				compareToVersionId: "v2025-student-rules",
				mode: "compare",
				versionId: "v2024-student-rules",
			},
			resolvedScope: {
				collection: "student_rules",
				corpus: "regulations",
			},
			selectedTarget: "rag-agent",
			sourceDocIds: ["handbook:library-hours"],
			startedAt: "2026-03-28T08:00:00.000Z",
			status: "completed",
			surface: "public_chat_web",
			traceId: "trace_01HQ",
			visibilityScope: "main",
		});
		expect(store.upsertAuditProjection).toHaveBeenCalledWith({
			auditEventId: "evt_accepted",
			diagnostics: {
				aclAnomalyCode: null,
				failClosed: false,
				sourceDocIds: ["handbook:library-hours"],
			},
			entitlementSnapshotId: "entitlements-2026-03-29",
			eventType: "request.completed",
			occurredAt: "2026-03-28T08:00:02.000Z",
			policyProjectionVersion: "2026-03-29",
			principalType: "student",
			projectedAt: "2026-03-28T08:00:03.000Z",
			requestId: "req_01HQ",
			requestedCapability: "knowledge",
			selectedTarget: "rag-agent",
			status: "completed",
			summary: "Knowledge request completed via rag agent.",
			surface: "public_chat_web",
			terminalCode: "completed",
			traceId: "trace_01HQ",
		});
		expect(store.replaceQualityRollups).toHaveBeenCalledWith({
			requestId: "req_01HQ",
			rollups: [
				{
					bucketEnd: "2026-03-28T08:05:00.000Z",
					bucketStart: "2026-03-28T08:00:00.000Z",
					collection: "student_rules",
					domain: "quality",
					granularity: "5m",
					metrics: {
						approvalRequiredCount: 0,
						citationEligibleCount: 0,
						citationMissCount: 0,
						emptyRecallCount: 0,
						needsClarificationCount: 0,
						noAnswerCount: 0,
						rejectedCount: 0,
						requestCount: 1,
						retrievalEligibleCount: 0,
					},
					modelName: null,
					principalType: "student",
					projectedAt: "2026-03-28T08:00:03.000Z",
					requestId: "req_01HQ",
					requestedCapability: "knowledge",
					rollupId:
						"quality|5m|2026-03-28T08:00:00.000Z|public_chat_web|rag-agent|knowledge|student|student_rules|_|req_01HQ",
					selectedTarget: "rag-agent",
					surface: "public_chat_web",
				},
				{
					bucketEnd: "2026-03-28T08:15:00.000Z",
					bucketStart: "2026-03-28T08:00:00.000Z",
					collection: "student_rules",
					domain: "quality",
					granularity: "15m",
					metrics: {
						approvalRequiredCount: 0,
						citationEligibleCount: 0,
						citationMissCount: 0,
						emptyRecallCount: 0,
						needsClarificationCount: 0,
						noAnswerCount: 0,
						rejectedCount: 0,
						requestCount: 1,
						retrievalEligibleCount: 0,
					},
					modelName: null,
					principalType: "student",
					projectedAt: "2026-03-28T08:00:03.000Z",
					requestId: "req_01HQ",
					requestedCapability: "knowledge",
					rollupId:
						"quality|15m|2026-03-28T08:00:00.000Z|public_chat_web|rag-agent|knowledge|student|student_rules|_|req_01HQ",
					selectedTarget: "rag-agent",
					surface: "public_chat_web",
				},
				{
					bucketEnd: "2026-03-28T09:00:00.000Z",
					bucketStart: "2026-03-28T08:00:00.000Z",
					collection: "student_rules",
					domain: "quality",
					granularity: "1h",
					metrics: {
						approvalRequiredCount: 0,
						citationEligibleCount: 0,
						citationMissCount: 0,
						emptyRecallCount: 0,
						needsClarificationCount: 0,
						noAnswerCount: 0,
						rejectedCount: 0,
						requestCount: 1,
						retrievalEligibleCount: 0,
					},
					modelName: null,
					principalType: "student",
					projectedAt: "2026-03-28T08:00:03.000Z",
					requestId: "req_01HQ",
					requestedCapability: "knowledge",
					rollupId:
						"quality|1h|2026-03-28T08:00:00.000Z|public_chat_web|rag-agent|knowledge|student|student_rules|_|req_01HQ",
					selectedTarget: "rag-agent",
					surface: "public_chat_web",
				},
				{
					bucketEnd: "2026-03-29T00:00:00.000Z",
					bucketStart: "2026-03-28T00:00:00.000Z",
					collection: "student_rules",
					domain: "quality",
					granularity: "1d",
					metrics: {
						approvalRequiredCount: 0,
						citationEligibleCount: 0,
						citationMissCount: 0,
						emptyRecallCount: 0,
						needsClarificationCount: 0,
						noAnswerCount: 0,
						rejectedCount: 0,
						requestCount: 1,
						retrievalEligibleCount: 0,
					},
					modelName: null,
					principalType: "student",
					projectedAt: "2026-03-28T08:00:03.000Z",
					requestId: "req_01HQ",
					requestedCapability: "knowledge",
					rollupId:
						"quality|1d|2026-03-28T00:00:00.000Z|public_chat_web|rag-agent|knowledge|student|student_rules|_|req_01HQ",
					selectedTarget: "rag-agent",
					surface: "public_chat_web",
				},
			],
		});
		expect(store.replaceQualityBadcases).toHaveBeenCalledWith({
			badcases: [],
			requestId: "req_01HQ",
		});
		expect(store.markObservabilityProjected).toHaveBeenCalledWith({
			measuredAt: "2026-03-28T08:00:03.000Z",
			projectionLagMs: 3000,
			requestId: "req_01HQ",
		});
		expect(store.markEventProcessed).toHaveBeenCalledWith({
			eventId: "evt_accepted",
			processedAt: "2026-03-28T08:00:03.000Z",
		});
		expect(store.markEventFailed).not.toHaveBeenCalled();
	});

	it("drains pending events for a single request without scanning the global backlog", async () => {
		const store: RequestProjectionProjectorStore = {
			getRequestExecution: vi.fn().mockResolvedValue(createExecutionSource()),
			listPendingEvents: vi
				.fn()
				.mockResolvedValue([createPendingEvent({ requestId: "req_other" })]),
			listPendingEventsForRequest: vi
				.fn()
				.mockResolvedValue([
					createPendingEvent({ eventId: "evt_target", requestId: "req_target" }),
				]),
			markEventFailed: vi.fn(),
			markEventProcessed: vi.fn(),
			markObservabilityProjected: vi.fn(),
			replaceQualityBadcases: vi.fn(),
			replaceQualityRollups: vi.fn(),
			upsertAuditProjection: vi.fn(),
			upsertProjection: vi.fn(),
		};
		const projector = buildRequestProjectionProjector({
			now: () => new Date("2026-03-28T08:00:03.000Z"),
			store,
		});

		const result = await projector.drainRequest("req_target");

		expect(result).toEqual({
			failed: 0,
			processed: 1,
		});
		expect(store.listPendingEventsForRequest).toHaveBeenCalledWith(
			"req_target",
			new Date("2026-03-28T08:00:03.000Z"),
		);
		expect(store.listPendingEvents).not.toHaveBeenCalled();
		expect(store.markEventProcessed).toHaveBeenCalledWith({
			eventId: "evt_target",
			processedAt: "2026-03-28T08:00:03.000Z",
		});
	});

	it("uses resolved serving scope for operator projection and quality rollups when request scope was unresolved at accept time", async () => {
		const store: RequestProjectionProjectorStore = {
			getRequestExecution: vi.fn().mockResolvedValue(
				createExecutionSource({
					requestedScope: null,
					resolvedScope: {
						collection: "curriculum_plan",
						corpus: "curriculum",
					},
				}),
			),
			listPendingEvents: vi.fn().mockResolvedValue([createPendingEvent()]),
			markEventFailed: vi.fn(),
			markEventProcessed: vi.fn(),
			markObservabilityProjected: vi.fn(),
			replaceQualityBadcases: vi.fn(),
			replaceQualityRollups: vi.fn(),
			upsertAuditProjection: vi.fn(),
			upsertProjection: vi.fn(),
		};
		const projector = buildRequestProjectionProjector({
			now: () => new Date("2026-03-28T08:00:03.000Z"),
			store,
		});

		await projector.drain();

		expect(store.upsertProjection).toHaveBeenCalledWith(
			expect.objectContaining({
				requestedScope: null,
				resolvedScope: {
					collection: "curriculum_plan",
					corpus: "curriculum",
				},
			}),
		);
		expect(store.replaceQualityRollups).toHaveBeenCalledWith({
			requestId: "req_01HQ",
			rollups: expect.arrayContaining([
				expect.objectContaining({
					collection: "curriculum_plan",
				}),
			]),
		});
	});

	it("records a retryable projector failure when request_execution is missing", async () => {
		const store: RequestProjectionProjectorStore = {
			getRequestExecution: vi.fn().mockResolvedValue(null),
			listPendingEvents: vi.fn().mockResolvedValue([createPendingEvent()]),
			markEventFailed: vi.fn(),
			markEventProcessed: vi.fn(),
			markObservabilityProjected: vi.fn(),
			replaceQualityBadcases: vi.fn(),
			replaceQualityRollups: vi.fn(),
			upsertAuditProjection: vi.fn(),
			upsertProjection: vi.fn(),
		};
		const projector = buildRequestProjectionProjector({
			now: () => new Date("2026-03-28T08:00:03.000Z"),
			store,
		});

		const result = await projector.drain();

		expect(result).toEqual({
			failed: 1,
			processed: 0,
		});
		expect(store.markEventFailed).toHaveBeenCalledWith({
			attemptCount: 1,
			availableAt: "2026-03-28T08:00:08.000Z",
			eventId: "evt_accepted",
			lastError: "Missing request_execution for req_01HQ.",
			processedAt: null,
		});
		expect(store.upsertProjection).not.toHaveBeenCalled();
		expect(store.upsertAuditProjection).not.toHaveBeenCalled();
		expect(store.markObservabilityProjected).not.toHaveBeenCalled();
		expect(store.markEventProcessed).not.toHaveBeenCalled();
	});

	it("carries summary diagnostics from request_execution into operator.request_projection", async () => {
		const store: RequestProjectionProjectorStore = {
			getRequestExecution: vi.fn().mockResolvedValue(
				createExecutionSource({
					diagnostics: {
						claimSupportSummary: null,
						clarificationReason: "policy_object_conflict",
						freshnessFailClosed: null,
						groundingDowngraded: null,
						groundingVerdict: null,
						noAnswerReason: null,
						policyReason: null,
						retrievalAdequacyReason: null,
						retrievalAdequacyVerdict: null,
						resolvedPolicyDocumentId: "handbook:55f7a1b27590bdc59c099f37d84cfa097356ce15",
						resolvedPolicyTitle: "中央民族大学本科学生国家奖学金评审办法",
						resolvedEntityType: null,
						resolvedProgramFamilyTitle: null,
						retrievedTitleSummary: [
							"中央民族大学本科学生国家奖学金评审办法",
							"中央民族大学本科学生综合素质测评办法",
						],
						scopeClass: null,
						semanticOutcome: null,
						sessionProgramFamily: null,
						sessionProgram: null,
						sessionSemester: null,
						unsupportedFields: [],
						rewrittenQuery:
							"中央民族大学本科学生国家奖学金评审办法 国奖第九条里对论文和著作怎么要求的？",
					},
				}),
			),
			listPendingEvents: vi.fn().mockResolvedValue([createPendingEvent()]),
			markEventFailed: vi.fn(),
			markEventProcessed: vi.fn(),
			markObservabilityProjected: vi.fn(),
			replaceQualityBadcases: vi.fn(),
			replaceQualityRollups: vi.fn(),
			upsertAuditProjection: vi.fn(),
			upsertProjection: vi.fn(),
		};
		const projector = buildRequestProjectionProjector({
			now: () => new Date("2026-03-28T08:00:03.000Z"),
			store,
		});

		await projector.drain();

		expect(store.upsertProjection).toHaveBeenCalledWith(
			expect.objectContaining({
				diagnostics: expect.objectContaining({
					claimSupportSummary: null,
					clarificationReason: "policy_object_conflict",
					freshnessFailClosed: null,
					groundingDowngraded: null,
					groundingVerdict: null,
					noAnswerReason: null,
					policyReason: null,
					retrievalAdequacyReason: null,
					retrievalAdequacyVerdict: null,
					resolvedPolicyDocumentId: "handbook:55f7a1b27590bdc59c099f37d84cfa097356ce15",
					resolvedPolicyTitle: "中央民族大学本科学生国家奖学金评审办法",
					resolvedEntityType: null,
					resolvedProgramFamilyTitle: null,
					retrievedTitleSummary: [
						"中央民族大学本科学生国家奖学金评审办法",
						"中央民族大学本科学生综合素质测评办法",
					],
					scopeClass: null,
					semanticOutcome: null,
					sessionProgram: null,
					sessionProgramFamily: null,
					sessionSemester: null,
					unsupportedFields: [],
					rewrittenQuery:
						"中央民族大学本科学生国家奖学金评审办法 国奖第九条里对论文和著作怎么要求的？",
				}),
			}),
		);
	});

	it("keeps audit event status aligned with the outbox event type instead of the latest request row", async () => {
		const store: RequestProjectionProjectorStore = {
			getRequestExecution: vi.fn().mockResolvedValue(
				createExecutionSource({
					status: "completed",
				}),
			),
			listPendingEvents: vi.fn().mockResolvedValue([
				createPendingEvent({
					eventId: "evt_accept",
					eventType: "request.accepted",
				}),
			]),
			markEventFailed: vi.fn(),
			markEventProcessed: vi.fn(),
			markObservabilityProjected: vi.fn(),
			replaceQualityBadcases: vi.fn(),
			replaceQualityRollups: vi.fn(),
			upsertAuditProjection: vi.fn(),
			upsertProjection: vi.fn(),
		};
		const projector = buildRequestProjectionProjector({
			now: () => new Date("2026-03-28T08:00:03.000Z"),
			store,
		});

		await projector.drain();

		expect(store.upsertAuditProjection).toHaveBeenCalledWith(
			expect.objectContaining({
				auditEventId: "evt_accept",
				eventType: "request.accepted",
				status: "accepted",
				terminalCode: "completed",
			}),
		);
	});

	it("marks terminal projector failures as processed after the retry budget is exhausted", async () => {
		const store: RequestProjectionProjectorStore = {
			getRequestExecution: vi.fn().mockResolvedValue(null),
			listPendingEvents: vi.fn().mockResolvedValue([
				createPendingEvent({
					attemptCount: 4,
					eventId: "evt_terminal",
				}),
			]),
			markEventFailed: vi.fn(),
			markEventProcessed: vi.fn(),
			markObservabilityProjected: vi.fn(),
			replaceQualityBadcases: vi.fn(),
			replaceQualityRollups: vi.fn(),
			upsertAuditProjection: vi.fn(),
			upsertProjection: vi.fn(),
		};
		const projector = buildRequestProjectionProjector({
			now: () => new Date("2026-03-28T08:00:03.000Z"),
			store,
		});

		const result = await projector.drain();

		expect(result).toEqual({
			failed: 1,
			processed: 0,
		});
		expect(store.markEventFailed).toHaveBeenCalledWith({
			attemptCount: 5,
			availableAt: "2026-03-28T08:00:03.000Z",
			eventId: "evt_terminal",
			lastError: "Missing request_execution for req_01HQ.",
			processedAt: "2026-03-28T08:00:03.000Z",
		});
		expect(store.markEventProcessed).not.toHaveBeenCalled();
	});
});
