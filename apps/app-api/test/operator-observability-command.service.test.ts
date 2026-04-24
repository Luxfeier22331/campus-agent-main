// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { buildOperatorObservabilityCommandService } from "../src/modules/operator-observability-command/service";

describe("operator observability command service", () => {
	it("upserts sampled grades before emitting the stable sink event", async () => {
		const store = {
			enqueueExecutionAuditEvents: vi.fn().mockResolvedValue(undefined),
			getRequestObservabilitySeed: vi.fn().mockResolvedValue({
				collection: "student_rules",
				modelName: "gpt-5.2-mini",
				principalType: "student",
				requestId: "req_01HQ",
				requestStartedAt: "2026-04-20T00:00:00.000Z",
				requestedCapability: "knowledge",
				requestedScopeSummary: "regulations/student_rules",
				selectedTarget: "rag-agent",
				surface: "public_chat_web",
				traceId: "trace_01HQ",
			}),
			upsertQualityGrades: vi.fn().mockResolvedValue(undefined),
			upsertTraceBacklinks: vi.fn().mockResolvedValue(undefined),
		};
		const telemetry = {
			recordQualitySampledGrade: vi.fn().mockResolvedValue(undefined),
		};
		const service = buildOperatorObservabilityCommandService({
			now: () => new Date("2026-04-20T00:20:00.000Z"),
			store,
			telemetry,
		});

		await expect(
			service.ingestGrades({
				payload: {
					grades: [
						{
							gradeDomain: "grounding",
							gradeSource: "openai_trace_grader",
							graderVersion: "grader@2026-04-20",
							rationaleSummary: "grounded to cited handbook passages",
							requestId: "req_01HQ",
							sampledAt: "2026-04-20T00:10:00.000Z",
							score: 0.913,
							traceId: "trace_01HQ",
							verdict: "pass",
						},
					],
				},
			}),
		).resolves.toEqual({ accepted: 1 });

		expect(store.upsertQualityGrades).toHaveBeenCalledWith({
			grades: [
				expect.objectContaining({
					collection: "student_rules",
					gradeDomain: "grounding",
					gradeId: "req_01HQ:openai_trace_grader:grounding",
					gradeSource: "openai_trace_grader",
					graderVersion: "grader@2026-04-20",
					modelName: "gpt-5.2-mini",
					principalType: "student",
					projectedAt: "2026-04-20T00:20:00.000Z",
					rationaleSummary: "grounded to cited handbook passages",
					requestId: "req_01HQ",
					requestStartedAt: "2026-04-20T00:00:00.000Z",
					requestedCapability: "knowledge",
					sampledAt: "2026-04-20T00:10:00.000Z",
					scoreMilli: 913,
					selectedTarget: "rag-agent",
					surface: "public_chat_web",
					traceId: "trace_01HQ",
					verdict: "pass",
				}),
			],
		});
		expect(telemetry.recordQualitySampledGrade).toHaveBeenCalledWith({
			collection: "student_rules",
			gradeDomain: "grounding",
			gradeId: "req_01HQ:openai_trace_grader:grounding",
			gradeSource: "openai_trace_grader",
			graderVersion: "grader@2026-04-20",
			modelName: "gpt-5.2-mini",
			principalType: "student",
			rationaleSummary: "grounded to cited handbook passages",
			requestId: "req_01HQ",
			requestStartedAt: "2026-04-20T00:00:00.000Z",
			requestedCapability: "knowledge",
			requestedScopeSummary: "regulations/student_rules",
			sampledAt: "2026-04-20T00:10:00.000Z",
			scoreMilli: 913,
			selectedTarget: "rag-agent",
			surface: "public_chat_web",
			traceId: "trace_01HQ",
			verdict: "pass",
		});
		expect(store.upsertQualityGrades.mock.invocationCallOrder[0]).toBeLessThan(
			telemetry.recordQualitySampledGrade.mock.invocationCallOrder[0],
		);
	});

	it("enqueues safe execution audit events after validating request identity", async () => {
		const store = {
			enqueueExecutionAuditEvents: vi.fn().mockResolvedValue(undefined),
			getRequestObservabilitySeed: vi.fn().mockResolvedValue({
				collection: "student_rules",
				modelName: "gpt-5.2-mini",
				principalType: "student",
				requestId: "req_01HQ",
				requestStartedAt: "2026-04-24T09:59:00.000Z",
				requestedCapability: "knowledge",
				requestedScopeSummary: "regulations/student_rules",
				selectedTarget: "rag-agent",
				surface: "public_chat_web",
				traceId: "trace_01HQ",
			}),
			upsertQualityGrades: vi.fn().mockResolvedValue(undefined),
			upsertTraceBacklinks: vi.fn().mockResolvedValue(undefined),
		};
		const service = buildOperatorObservabilityCommandService({
			now: () => new Date("2026-04-24T10:00:01.000Z"),
			store,
		});

		await expect(
			service.ingestExecutionAuditEvents({
				payload: {
					events: [
						{
							bridge_duration_ms: 35000,
							decision: null,
							duration_ms: 35012,
							event_id: "supervisor-api:req_01HQ:execution.bridge_failed",
							event_type: "execution.bridge_failed",
							failure_kind: "timeout",
							http_status: 504,
							lane: "rag",
							occurred_at: "2026-04-24T10:00:00.000Z",
							queue_wait_ms: 12,
							request_id: "req_01HQ",
							requested_capability: "knowledge",
							retryable: true,
							trace_id: "trace_01HQ",
						},
					],
				},
			}),
		).resolves.toEqual({ accepted: 1 });

		expect(store.enqueueExecutionAuditEvents).toHaveBeenCalledWith({
			events: [
				{
					availableAt: "2026-04-24T10:00:00.000Z",
					eventId: "supervisor-api:req_01HQ:execution.bridge_failed",
					eventType: "execution.bridge_failed",
					occurredAt: "2026-04-24T10:00:00.000Z",
					payload: {
						bridgeDurationMs: 35000,
						decision: null,
						durationMs: 35012,
						failureKind: "timeout",
						httpStatus: 504,
						lane: "rag",
						queueWaitMs: 12,
						requestedCapability: "knowledge",
						retryable: true,
						traceId: "trace_01HQ",
					},
					requestId: "req_01HQ",
				},
			],
		});
	});

	it("rejects execution audit events that carry forbidden raw fields", async () => {
		const store = {
			enqueueExecutionAuditEvents: vi.fn().mockResolvedValue(undefined),
			getRequestObservabilitySeed: vi.fn().mockResolvedValue({
				collection: "student_rules",
				modelName: "gpt-5.2-mini",
				principalType: "student",
				requestId: "req_01HQ",
				requestStartedAt: "2026-04-24T09:59:00.000Z",
				requestedCapability: "knowledge",
				requestedScopeSummary: "regulations/student_rules",
				selectedTarget: "rag-agent",
				surface: "public_chat_web",
				traceId: "trace_01HQ",
			}),
			upsertQualityGrades: vi.fn().mockResolvedValue(undefined),
			upsertTraceBacklinks: vi.fn().mockResolvedValue(undefined),
		};
		const service = buildOperatorObservabilityCommandService({
			store,
		});

		await expect(
			service.ingestExecutionAuditEvents({
				payload: {
					events: [
						{
							event_id: "supervisor-api:req_01HQ:execution.bridge_failed",
							event_type: "execution.bridge_failed",
							occurred_at: "2026-04-24T10:00:00.000Z",
							prompt: "图书馆开放到几点？",
							request_id: "req_01HQ",
							trace_id: "trace_01HQ",
						},
					],
				},
			}),
		).rejects.toMatchObject({
			code: "validation_failed",
			status: 422,
		});
		expect(store.enqueueExecutionAuditEvents).not.toHaveBeenCalled();
	});
});
