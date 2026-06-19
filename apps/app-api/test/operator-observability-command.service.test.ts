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
				selectedCapability: "knowledge",
				surface: "campus_web",
				traceId: "trace_01HQ",
			}),
			upsertEvalCoverageSnapshot: vi.fn().mockResolvedValue(undefined),
			upsertEvalDiagnosticBadcases: vi.fn().mockResolvedValue(undefined),
			upsertQualityGrades: vi.fn().mockResolvedValue(undefined),
			upsertTemporalTaskQueueRuntime: vi.fn().mockResolvedValue(undefined),
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
					selectedCapability: "knowledge",
					surface: "campus_web",
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
			selectedCapability: "knowledge",
			surface: "campus_web",
			traceId: "trace_01HQ",
			verdict: "pass",
		});
		expect(store.upsertQualityGrades.mock.invocationCallOrder[0]).toBeLessThan(
			telemetry.recordQualitySampledGrade.mock.invocationCallOrder[0],
		);
	});

	it("accepts intent sampled grades for observability-driven routing governance", async () => {
		const store = {
			enqueueExecutionAuditEvents: vi.fn().mockResolvedValue(undefined),
			getRequestObservabilitySeed: vi.fn().mockResolvedValue({
				collection: "student_rules",
				modelName: "deterministic-intent",
				principalType: "student",
				requestId: "req_intent_01",
				requestStartedAt: "2026-04-20T00:00:00.000Z",
				requestedCapability: "knowledge",
				requestedScopeSummary: null,
				selectedCapability: "knowledge",
				surface: "campus_web",
				traceId: "trace_intent_01",
			}),
			upsertEvalCoverageSnapshot: vi.fn().mockResolvedValue(undefined),
			upsertEvalDiagnosticBadcases: vi.fn().mockResolvedValue(undefined),
			upsertQualityGrades: vi.fn().mockResolvedValue(undefined),
			upsertTemporalTaskQueueRuntime: vi.fn().mockResolvedValue(undefined),
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
							gradeDomain: "intent",
							gradeSource: "operator_review",
							graderVersion: "intent-review@2026-04-20",
							rationaleSummary: "follow-up should ask for the selected notice context",
							requestId: "req_intent_01",
							sampledAt: "2026-04-20T00:10:00.000Z",
							score: null,
							traceId: "trace_intent_01",
							verdict: "needs_review",
						},
					],
				},
			}),
		).resolves.toEqual({ accepted: 1 });

		expect(store.upsertQualityGrades).toHaveBeenCalledWith({
			grades: [
				expect.objectContaining({
					gradeDomain: "intent",
					gradeId: "req_intent_01:operator_review:intent",
					gradeSource: "operator_review",
					graderVersion: "intent-review@2026-04-20",
					rationaleSummary: "follow-up should ask for the selected notice context",
					requestId: "req_intent_01",
					scoreMilli: null,
					verdict: "needs_review",
				}),
			],
		});
		expect(telemetry.recordQualitySampledGrade).toHaveBeenCalledWith(
			expect.objectContaining({
				gradeDomain: "intent",
				gradeId: "req_intent_01:operator_review:intent",
			}),
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
				selectedCapability: "knowledge",
				surface: "campus_web",
				traceId: "trace_01HQ",
			}),
			upsertEvalCoverageSnapshot: vi.fn().mockResolvedValue(undefined),
			upsertEvalDiagnosticBadcases: vi.fn().mockResolvedValue(undefined),
			upsertQualityGrades: vi.fn().mockResolvedValue(undefined),
			upsertTemporalTaskQueueRuntime: vi.fn().mockResolvedValue(undefined),
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
							event_id: "execution-control:req_01HQ:execution.bridge_failed",
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
					eventId: "execution-control:req_01HQ:execution.bridge_failed",
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
				selectedCapability: "knowledge",
				surface: "campus_web",
				traceId: "trace_01HQ",
			}),
			upsertEvalCoverageSnapshot: vi.fn().mockResolvedValue(undefined),
			upsertEvalDiagnosticBadcases: vi.fn().mockResolvedValue(undefined),
			upsertQualityGrades: vi.fn().mockResolvedValue(undefined),
			upsertTemporalTaskQueueRuntime: vi.fn().mockResolvedValue(undefined),
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
							event_id: "execution-control:req_01HQ:execution.bridge_failed",
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

	it("rejects unsafe trace backlink URL schemes before writing panel-visible links", async () => {
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
				selectedCapability: "knowledge",
				surface: "campus_web",
				traceId: "trace_01HQ",
			}),
			upsertEvalCoverageSnapshot: vi.fn().mockResolvedValue(undefined),
			upsertEvalDiagnosticBadcases: vi.fn().mockResolvedValue(undefined),
			upsertQualityGrades: vi.fn().mockResolvedValue(undefined),
			upsertTemporalTaskQueueRuntime: vi.fn().mockResolvedValue(undefined),
			upsertTraceBacklinks: vi.fn().mockResolvedValue(undefined),
		};
		const service = buildOperatorObservabilityCommandService({
			store,
		});

		await expect(
			service.ingestTraceBacklinks({
				payload: {
					backlinks: [
						{
							issueLink: "https://sentry.example/issues/123",
							requestId: "req_01HQ",
							traceId: "trace_01HQ",
							traceLink: "javascript:alert(1)",
						},
					],
				},
			}),
		).rejects.toMatchObject({
			code: "validation_failed",
			status: 422,
		});
		expect(store.upsertTraceBacklinks).not.toHaveBeenCalled();
	});

	it("ingests sanitized Langfuse eval backlinks without exposing raw payload fields", async () => {
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
				selectedCapability: "knowledge",
				surface: "campus_web",
				traceId: "trace_01HQ",
			}),
			upsertEvalCoverageSnapshot: vi.fn().mockResolvedValue(undefined),
			upsertEvalDiagnosticBadcases: vi.fn().mockResolvedValue(undefined),
			upsertLangfuseEvalBacklinks: vi.fn().mockResolvedValue(undefined),
			upsertQualityGrades: vi.fn().mockResolvedValue(undefined),
			upsertTemporalTaskQueueRuntime: vi.fn().mockResolvedValue(undefined),
			upsertTraceBacklinks: vi.fn().mockResolvedValue(undefined),
		};
		const service = buildOperatorObservabilityCommandService({
			now: () => new Date("2026-06-19T08:00:00.000Z"),
			store,
		});

		await expect(
			service.ingestLangfuseEvalBacklinks({
				payload: {
					backlinks: [
						{
							environment: "staging",
							evalRunId: "rag-first-stage:release-2026-06-19",
							langfuseUrl: "https://langfuse.example/project/traces/trace_01HQ",
							release: "release-2026-06-19",
							requestId: "req_01HQ",
							scoreName: "retrieval.pass",
							scoreValue: 1,
							traceId: "trace_01HQ",
						},
					],
				},
			}),
		).resolves.toEqual({ accepted: 1 });

		expect(store.upsertLangfuseEvalBacklinks).toHaveBeenCalledWith({
			backlinks: [
				{
					environment: "staging",
					evalBacklinkId:
						"trace_01HQ:rag-first-stage:release-2026-06-19:retrieval.pass:release-2026-06-19:staging",
					evalRunId: "rag-first-stage:release-2026-06-19",
					langfuseUrl: "https://langfuse.example/project/traces/trace_01HQ",
					projectedAt: "2026-06-19T08:00:00.000Z",
					release: "release-2026-06-19",
					scoreName: "retrieval.pass",
					scoreValue: 1,
					traceId: "trace_01HQ",
				},
			],
		});
	});

	it("rejects Langfuse eval backlinks with raw payload fields before writing summaries", async () => {
		const store = {
			enqueueExecutionAuditEvents: vi.fn().mockResolvedValue(undefined),
			getRequestObservabilitySeed: vi.fn().mockResolvedValue({
				requestId: "req_01HQ",
				traceId: "trace_01HQ",
			}),
			upsertEvalCoverageSnapshot: vi.fn().mockResolvedValue(undefined),
			upsertEvalDiagnosticBadcases: vi.fn().mockResolvedValue(undefined),
			upsertLangfuseEvalBacklinks: vi.fn().mockResolvedValue(undefined),
			upsertQualityGrades: vi.fn().mockResolvedValue(undefined),
			upsertTemporalTaskQueueRuntime: vi.fn().mockResolvedValue(undefined),
			upsertTraceBacklinks: vi.fn().mockResolvedValue(undefined),
		};
		const service = buildOperatorObservabilityCommandService({ store });

		await expect(
			service.ingestLangfuseEvalBacklinks({
				payload: {
					backlinks: [
						{
							environment: "staging",
							evalRunId: "eval-run-001",
							langfuseUrl: "https://langfuse.example/scores/score-001",
							rawAnswer: "原始答案不能进入 operator backlink",
							release: "release-2026-06-19",
							requestId: "req_01HQ",
							scoreName: "quality.groundedness",
							scoreValue: 0.2,
							traceId: "trace_01HQ",
						},
					],
				},
			}),
		).rejects.toMatchObject({
			code: "validation_failed",
			status: 422,
		});
		expect(store.upsertLangfuseEvalBacklinks).not.toHaveBeenCalled();
	});

	it("persists Temporal task queue snapshots and autoscaler projections with observed load and failed actuation evidence", async () => {
		const store = {
			enqueueExecutionAuditEvents: vi.fn().mockResolvedValue(undefined),
			getRequestObservabilitySeed: vi.fn(),
			upsertEvalCoverageSnapshot: vi.fn().mockResolvedValue(undefined),
			upsertEvalDiagnosticBadcases: vi.fn().mockResolvedValue(undefined),
			upsertQualityGrades: vi.fn().mockResolvedValue(undefined),
			upsertTemporalTaskQueueRuntime: vi.fn().mockResolvedValue(undefined),
			upsertTraceBacklinks: vi.fn().mockResolvedValue(undefined),
		};
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
							targetService: "activity-worker-knowledge-retrieval",
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
							targetService: "activity-worker-knowledge-retrieval",
							taskQueue: "campus-agent.activity.knowledge.retrieval",
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
							taskQueue: "campus-agent.activity.knowledge.retrieval",
							taskQueueKind: "activity",
						},
					],
				},
			}),
		).resolves.toEqual({
			acceptedActuations: 1,
			acceptedDecisions: 1,
			acceptedSnapshots: 1,
		});

		expect(store.upsertTemporalTaskQueueRuntime).toHaveBeenCalledWith({
			actuations: [
				{
					actedAt: "2026-06-15T10:00:06.000Z",
					action: "scale",
					actuationId: "actuation_01",
					actuatorKind: "docker_compose",
					decisionId: "decision_01",
					errorCode: "docker_compose_scale_failed",
					fromReplicas: 1,
					projectedAt: "2026-06-15T10:00:02.000Z",
					status: "failed",
					targetService: "activity-worker-knowledge-retrieval",
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
					projectedAt: "2026-06-15T10:00:02.000Z",
					reason: "backlog_threshold_exceeded",
					sourceSnapshotId: "temporal-snapshot-20260615T100000Z",
					targetService: "activity-worker-knowledge-retrieval",
					taskQueue: "campus-agent.activity.knowledge.retrieval",
					taskQueueKind: "activity",
				},
			],
			snapshots: [
				{
					backlog: { count: 12, state: "observed" },
					namespace: "default",
					oldestTaskAge: { ms: 4500, state: "observed" },
					pollerCount: 1,
					pollerIdentities: ["knowledge-worker-1"],
					projectedAt: "2026-06-15T10:00:02.000Z",
					sampledAt: "2026-06-15T10:00:00.000Z",
					scheduleToStartLatency: { ms: null, state: "unsupported_by_source" },
					snapshotId: "temporal-snapshot-20260615T100000Z",
					source: "execution-control.temporal-task-queue-sampler",
					taskQueue: "campus-agent.activity.knowledge.retrieval",
					taskQueueKind: "activity",
				},
			],
		});
	});

	it("rejects autoscaler actuations with unknown statuses", async () => {
		const store = {
			enqueueExecutionAuditEvents: vi.fn().mockResolvedValue(undefined),
			getRequestObservabilitySeed: vi.fn(),
			upsertEvalCoverageSnapshot: vi.fn().mockResolvedValue(undefined),
			upsertEvalDiagnosticBadcases: vi.fn().mockResolvedValue(undefined),
			upsertQualityGrades: vi.fn().mockResolvedValue(undefined),
			upsertTemporalTaskQueueRuntime: vi.fn().mockResolvedValue(undefined),
			upsertTraceBacklinks: vi.fn().mockResolvedValue(undefined),
		};
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
							targetService: "activity-worker-knowledge-retrieval",
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
		const store = {
			enqueueExecutionAuditEvents: vi.fn().mockResolvedValue(undefined),
			getRequestObservabilitySeed: vi.fn(),
			upsertEvalCoverageSnapshot: vi.fn().mockResolvedValue(undefined),
			upsertEvalDiagnosticBadcases: vi.fn().mockResolvedValue(undefined),
			upsertQualityGrades: vi.fn().mockResolvedValue(undefined),
			upsertTemporalTaskQueueRuntime: vi.fn().mockResolvedValue(undefined),
			upsertTraceBacklinks: vi.fn().mockResolvedValue(undefined),
		};
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
							taskQueue: "campus-agent.activity.knowledge.retrieval",
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
