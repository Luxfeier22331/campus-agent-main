// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { buildOperatorObservabilityCommandService } from "../src/modules/operator-observability-command/service";

function createStoreMock() {
	return {
		enqueueExecutionAuditEvents: vi.fn().mockResolvedValue(undefined),
		getRequestObservabilitySeed: vi.fn(),
		upsertTemporalTaskQueueRuntime: vi.fn().mockResolvedValue(undefined),
	};
}

describe("operator observability command service", () => {
	it("enqueues safe execution audit events and emits sanitized telemetry", async () => {
		const store = createStoreMock();
		store.getRequestObservabilitySeed.mockResolvedValue({
			collection: "student_rules",
			modelName: "gpt-5.2-mini",
			principalType: "student",
			requestId: "req_01HQ",
			requestedScopeSummary: "regulations/student_rules",
			requestStartedAt: "2026-04-24T09:59:00.000Z",
			requestedTool: "knowledge_query",
			selectedTool: "knowledge_query",
			surface: "campus_web",
			traceId: "trace_01HQ",
		});
		const telemetry = {
			recordExecutionAuditEvent: vi.fn().mockResolvedValue(undefined),
		};
		const service = buildOperatorObservabilityCommandService({
			now: () => new Date("2026-04-24T10:00:01.000Z"),
			store,
			telemetry,
		});

		await expect(
			service.ingestExecutionAuditEvents({
				payload: {
					events: [
						{
							activity_duration_ms: 35000,
							decision: null,
							duration_ms: 35012,
							event_id: "execution-control:req_01HQ:execution.activity_failed",
							event_type: "execution.activity_failed",
							failure_kind: "timeout",
							http_status: 504,
							task_queue: "campus-agent.workflow",
							occurred_at: "2026-04-24T10:00:00.000Z",
							queue_wait_ms: 12,
							request_id: "req_01HQ",
							requested_tool: "knowledge_query",
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
					eventId: "execution-control:req_01HQ:execution.activity_failed",
					eventType: "execution.activity_failed",
					occurredAt: "2026-04-24T10:00:00.000Z",
					payload: {
						activityDurationMs: 35000,
						decision: null,
						durationMs: 35012,
						failureKind: "timeout",
						httpStatus: 504,
						queueWaitMs: 12,
						requestedTool: "knowledge_query",
						retryable: true,
						taskQueue: "campus-agent.workflow",
						traceId: "trace_01HQ",
					},
					requestId: "req_01HQ",
				},
			],
		});
		expect(telemetry.recordExecutionAuditEvent).toHaveBeenCalledWith({
			activityDurationMs: 35000,
			decision: null,
			durationMs: 35012,
			eventType: "execution.activity_failed",
			failureKind: "timeout",
			httpStatus: 504,
			queueWaitMs: 12,
			requestId: "req_01HQ",
			requestedTool: "knowledge_query",
			retryable: true,
			status: "error",
			surface: "campus_web",
			taskQueue: "campus-agent.workflow",
			traceId: "trace_01HQ",
		});
	});

	it("rejects execution audit events that carry forbidden raw fields", async () => {
		const store = createStoreMock();
		const service = buildOperatorObservabilityCommandService({
			store,
		});

		await expect(
			service.ingestExecutionAuditEvents({
				payload: {
					events: [
						{
							event_id: "execution-control:req_01HQ:execution.activity_failed",
							event_type: "execution.activity_failed",
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

	it("rejects execution audit events with unknown fields", async () => {
		const store = createStoreMock();
		const service = buildOperatorObservabilityCommandService({
			store,
		});

		await expect(
			service.ingestExecutionAuditEvents({
				payload: {
					events: [
						{
							event_id: "execution-control:req_01HQ:execution.activity_failed",
							event_type: "execution.activity_failed",
							occurred_at: "2026-04-24T10:00:00.000Z",
							request_id: "req_01HQ",
							trace_id: "trace_01HQ",
							unknown_debug_field: "must fail closed",
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

	it("rejects execution audit events with mismatched event ids", async () => {
		const store = createStoreMock();
		const service = buildOperatorObservabilityCommandService({
			store,
		});

		await expect(
			service.ingestExecutionAuditEvents({
				payload: {
					events: [
						{
							event_id: "execution-control:req_other:execution.activity_failed",
							event_type: "execution.activity_failed",
							occurred_at: "2026-04-24T10:00:00.000Z",
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

	it("rejects malformed execution audit event items", async () => {
		const store = createStoreMock();
		const service = buildOperatorObservabilityCommandService({
			store,
		});

		await expect(
			service.ingestExecutionAuditEvents({
				payload: {
					events: ["execution.activity_failed"],
				},
			}),
		).rejects.toMatchObject({
			code: "validation_failed",
			status: 422,
		});
		expect(store.enqueueExecutionAuditEvents).not.toHaveBeenCalled();
	});

	it("rejects execution audit batches over the bounded ingest size", async () => {
		const store = createStoreMock();
		const service = buildOperatorObservabilityCommandService({
			store,
		});

		await expect(
			service.ingestExecutionAuditEvents({
				payload: {
					events: Array.from({ length: 101 }, (_, index) => ({
						event_id: `execution-control:req_${index}:execution.activity_failed`,
						event_type: "execution.activity_failed",
						occurred_at: "2026-04-24T10:00:00.000Z",
						request_id: `req_${index}`,
						trace_id: `trace_${index}`,
					})),
				},
			}),
		).rejects.toMatchObject({
			code: "validation_failed",
			status: 422,
		});
		expect(store.enqueueExecutionAuditEvents).not.toHaveBeenCalled();
	});

	it("rejects execution audit optional strings with invalid types or excessive length", async () => {
		const store = createStoreMock();
		const service = buildOperatorObservabilityCommandService({
			store,
		});

		await expect(
			service.ingestExecutionAuditEvents({
				payload: {
					events: [
						{
							decision: { raw: "must fail closed" },
							event_id: "execution-control:req_01HQ:execution.cancelled",
							event_type: "execution.cancelled",
							occurred_at: "2026-04-24T10:00:00.000Z",
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

		await expect(
			service.ingestExecutionAuditEvents({
				payload: {
					events: [
						{
							decision: "x".repeat(201),
							event_id: "execution-control:req_01HQ:execution.cancelled",
							event_type: "execution.cancelled",
							occurred_at: "2026-04-24T10:00:00.000Z",
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

	it("rejects execution audit HTTP status outside the HTTP status range", async () => {
		const store = createStoreMock();
		const service = buildOperatorObservabilityCommandService({
			store,
		});

		await expect(
			service.ingestExecutionAuditEvents({
				payload: {
					events: [
						{
							event_id: "execution-control:req_01HQ:execution.activity_failed",
							event_type: "execution.activity_failed",
							http_status: 42,
							occurred_at: "2026-04-24T10:00:00.000Z",
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

	it("keeps cancellation audit telemetry out of error status", async () => {
		const store = createStoreMock();
		store.getRequestObservabilitySeed.mockResolvedValue({
			collection: null,
			modelName: null,
			principalType: "student",
			requestId: "req_cancel",
			requestedScopeSummary: null,
			requestedTool: "knowledge_query",
			selectedTool: "knowledge_query",
			surface: "campus_web",
			traceId: "trace_cancel",
		});
		const telemetry = {
			recordExecutionAuditEvent: vi.fn().mockResolvedValue(undefined),
		};
		const service = buildOperatorObservabilityCommandService({
			store,
			telemetry,
		});

		await expect(
			service.ingestExecutionAuditEvents({
				payload: {
					events: [
						{
							event_id: "execution-control:req_cancel:execution.cancel_requested",
							event_type: "execution.cancel_requested",
							occurred_at: "2026-04-24T10:00:00.000Z",
							request_id: "req_cancel",
							retryable: false,
							trace_id: "trace_cancel",
						},
						{
							event_id: "execution-control:req_cancel:execution.cancelled",
							event_type: "execution.cancelled",
							occurred_at: "2026-04-24T10:00:01.000Z",
							request_id: "req_cancel",
							retryable: false,
							trace_id: "trace_cancel",
						},
					],
				},
			}),
		).resolves.toEqual({ accepted: 2 });

		expect(telemetry.recordExecutionAuditEvent).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				eventType: "execution.cancel_requested",
				status: "accepted",
			}),
		);
		expect(telemetry.recordExecutionAuditEvent).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				eventType: "execution.cancelled",
				status: "cancelled",
			}),
		);
	});

	it("persists Temporal task queue snapshots and autoscaler projections", async () => {
		const store = createStoreMock();
		const service = buildOperatorObservabilityCommandService({
			now: () => new Date("2026-06-15T10:00:02.000Z"),
			store,
		});

		await expect(
			service.ingestTemporalTaskQueueSnapshots({
				payload: {
					actuations: [
						{
							actedAt: "2026-06-15T10:00:06.000Z",
							actuationId: "actuation_01",
							action: "scale",
							actuatorKind: "docker_compose",
							decisionId: "decision_01",
							errorCode: "docker_compose_scale_failed",
							fromReplicas: 1,
							status: "failed",
							targetService: "activity-worker-knowledge",
							toReplicas: 2,
						},
					],
					decisions: [
						{
							budgetState: "within_budget",
							currentReplicas: 1,
							decidedAt: "2026-06-15T10:00:05.000Z",
							decision: "scale_up",
							decisionId: "decision_01",
							desiredReplicas: 2,
							evidence: {
								backlog: { count: 12, state: "observed" },
								oldestTaskAge: { ms: 4500, state: "observed" },
								pollerCount: 1,
							},
							reason: "backlog_threshold_exceeded",
							sourceSnapshotId: "temporal-snapshot-20260615T100000Z",
							targetService: "activity-worker-knowledge",
							taskQueue: "campus-agent.activity.knowledge",
							taskQueueKind: "activity",
						},
					],
					postures: [
						{
							currentReplicas: 1,
							desiredReplicas: 2,
							evidence: {
								hpaName: "keda-hpa-activity-worker-knowledge",
								scaledObjectName: "activity-worker-knowledge",
							},
							lastScaleEventAt: "2026-06-15T10:00:06.000Z",
							lastScaleEventId: "actuation_01",
							maxReplicas: 5,
							metricFreshness: { ms: 15000, state: "observed" },
							minReplicas: 1,
							observedAt: "2026-06-15T10:00:08.000Z",
							reason: "hpa_desired_replicas_above_current",
							scalerKind: "keda_temporal",
							scalerStatus: "healthy",
							targetService: "activity-worker-knowledge",
							taskQueue: "campus-agent.activity.knowledge",
							taskQueueKind: "activity",
						},
					],
					schemaVersion: "temporal_task_queue_metrics_snapshot.v1",
					snapshots: [
						{
							backlog: { count: 12, state: "observed" },
							namespace: "default",
							oldestTaskAge: { ms: 4500, state: "observed" },
							pollerCount: 1,
							pollerIdentities: ["knowledge-worker-1"],
							sampledAt: "2026-06-15T10:00:00.000Z",
							scheduleToStartLatency: { state: "unsupported_by_source" },
							snapshotId: "temporal-snapshot-20260615T100000Z",
							source: "execution-control.temporal-task-queue-sampler",
							taskQueue: "campus-agent.activity.knowledge",
							taskQueueKind: "activity",
						},
					],
				},
			}),
		).resolves.toEqual({
			acceptedActuations: 1,
			acceptedDecisions: 1,
			acceptedPostures: 1,
			acceptedSnapshots: 1,
		});

		expect(store.upsertTemporalTaskQueueRuntime).toHaveBeenCalledWith({
			actuations: [
				expect.objectContaining({
					actuationId: "actuation_01",
					projectedAt: "2026-06-15T10:00:02.000Z",
					status: "failed",
				}),
			],
			decisions: [
				expect.objectContaining({
					decision: "scale_up",
					decisionId: "decision_01",
					projectedAt: "2026-06-15T10:00:02.000Z",
				}),
			],
			persistHistory: false,
			postures: [
				expect.objectContaining({
					projectedAt: "2026-06-15T10:00:02.000Z",
					scalerStatus: "healthy",
					targetService: "activity-worker-knowledge",
				}),
			],
			snapshots: [
				expect.objectContaining({
					projectedAt: "2026-06-15T10:00:02.000Z",
					snapshotId: "temporal-snapshot-20260615T100000Z",
				}),
			],
		});
	});

	it("marks Temporal runtime projections as history only for explicit proof ingestion", async () => {
		const store = createStoreMock();
		const service = buildOperatorObservabilityCommandService({
			now: () => new Date("2026-06-15T10:00:02.000Z"),
			store,
		});

		await service.ingestTemporalTaskQueueSnapshots({
			payload: {
				schemaVersion: "temporal_task_queue_metrics_snapshot.v1",
				snapshots: [
					{
						backlog: { state: "unsupported_by_source" },
						namespace: "default",
						oldestTaskAge: { state: "unsupported_by_source" },
						pollerCount: 0,
						pollerIdentities: [],
						sampledAt: "2026-06-15T10:00:00.000Z",
						scheduleToStartLatency: { state: "unsupported_by_source" },
						snapshotId: "temporal-snapshot-proof",
						source: "execution-control.temporal-task-queue-sampler",
						taskQueue: "campus-agent.activity.knowledge",
						taskQueueKind: "activity",
					},
				],
			},
			persistHistory: true,
		});

		expect(store.upsertTemporalTaskQueueRuntime).toHaveBeenCalledWith(
			expect.objectContaining({
				persistHistory: true,
			}),
		);
	});

	it("rejects autoscaler actuations with unknown statuses", async () => {
		const store = createStoreMock();
		const service = buildOperatorObservabilityCommandService({ store });

		await expect(
			service.ingestTemporalTaskQueueSnapshots({
				payload: {
					actuations: [
						{
							actedAt: "2026-06-15T10:00:06.000Z",
							actuationId: "actuation_01",
							action: "scale",
							actuatorKind: "docker_compose",
							decisionId: "decision_01",
							fromReplicas: 1,
							status: "unknown",
							targetService: "activity-worker-knowledge",
							toReplicas: 2,
						},
					],
					schemaVersion: "temporal_task_queue_metrics_snapshot.v1",
				},
			}),
		).rejects.toMatchObject({
			code: "validation_failed",
			status: 422,
		});
		expect(store.upsertTemporalTaskQueueRuntime).not.toHaveBeenCalled();
	});

	it("rejects Temporal task queue snapshots that include raw Temporal responses", async () => {
		const store = createStoreMock();
		const service = buildOperatorObservabilityCommandService({ store });

		await expect(
			service.ingestTemporalTaskQueueSnapshots({
				payload: {
					schemaVersion: "temporal_task_queue_metrics_snapshot.v1",
					snapshots: [
						{
							backlog: { state: "unsupported_by_source" },
							namespace: "default",
							oldestTaskAge: { state: "unsupported_by_source" },
							pollerCount: 0,
							pollerIdentities: [],
							rawTemporalResponse: { pollers: [] },
							sampledAt: "2026-06-15T10:00:00.000Z",
							scheduleToStartLatency: { state: "unsupported_by_source" },
							snapshotId: "temporal-snapshot-20260615T100000Z",
							source: "execution-control.temporal-task-queue-sampler",
							taskQueue: "campus-agent.activity.knowledge",
							taskQueueKind: "activity",
						},
					],
				},
			}),
		).rejects.toMatchObject({
			code: "validation_failed",
			status: 422,
		});
		expect(store.upsertTemporalTaskQueueRuntime).not.toHaveBeenCalled();
	});
});
