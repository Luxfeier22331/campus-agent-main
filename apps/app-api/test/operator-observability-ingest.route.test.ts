// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";

const env = {
	APP_API_NAME: "campus-agent-app-api",
	APP_API_ENVIRONMENT: "test" as const,
	APP_API_INTERNAL_SHARED_SECRET: "trusted-secret",
	BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
	AUTH_SHELL_ORIGIN: "https://campus.muc.wiki",
	EXECUTION_CONTROL_BASE_URL: "https://execution-control.internal",
	EXECUTION_CONTROL_SHARED_SECRET: "shared-secret",
	APP_API_DB: {
		connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
	},
};

describe("operator observability internal ingest routes", () => {
	it("accepts sampled grades through the internal ingest seam", async () => {
		const service = {
			ingestExecutionAuditEvents: vi.fn(),
			ingestGrades: vi.fn().mockResolvedValue({ accepted: 1 }),
			ingestTraceBacklinks: vi.fn(),
		};
		const app = createApp(env as never, {
			operatorObservabilityCommandService: service as never,
		});

		const response = await app.fetch(
			new Request("https://app-api.internal/api/internal/operator/quality/grades", {
				body: JSON.stringify({
					grades: [
						{
							gradeDomain: "grounding",
							gradeSource: "openai_trace_grader",
							graderVersion: "grader@2026-04-03",
							rationaleSummary: "grounded to cited handbook passages",
							requestId: "req_01HQ",
							sampledAt: "2026-04-03T00:10:00.000Z",
							score: 0.913,
							traceId: "trace_01HQ",
							verdict: "pass",
						},
					],
				}),
				headers: {
					"content-type": "application/json",
					"x-app-internal-auth": "trusted-secret",
				},
				method: "POST",
			}),
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ accepted: 1 });
		expect(service.ingestGrades).toHaveBeenCalledWith({
			payload: {
				grades: [
					{
						gradeDomain: "grounding",
						gradeSource: "openai_trace_grader",
						graderVersion: "grader@2026-04-03",
						rationaleSummary: "grounded to cited handbook passages",
						requestId: "req_01HQ",
						sampledAt: "2026-04-03T00:10:00.000Z",
						score: 0.913,
						traceId: "trace_01HQ",
						verdict: "pass",
					},
				],
			},
		});
	});

	it("accepts trace backlinks through the internal ingest seam", async () => {
		const service = {
			ingestExecutionAuditEvents: vi.fn(),
			ingestGrades: vi.fn(),
			ingestLangfuseEvalBacklinks: vi.fn(),
			ingestTraceBacklinks: vi.fn().mockResolvedValue({ accepted: 1 }),
		};
		const app = createApp(env as never, {
			operatorObservabilityCommandService: service as never,
		});

		const response = await app.fetch(
			new Request("https://app-api.internal/api/internal/operator/trace-backlinks", {
				body: JSON.stringify({
					backlinks: [
						{
							issueFingerprint: "timeout:execution-control",
							issueLink: "https://sentry.example/issues/123",
							requestId: "req_01HQ",
							traceId: "trace_01HQ",
							traceLink: "https://sentry.example/traces/trace_01HQ",
						},
					],
				}),
				headers: {
					"content-type": "application/json",
					"x-app-internal-auth": "trusted-secret",
				},
				method: "POST",
			}),
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ accepted: 1 });
		expect(service.ingestTraceBacklinks).toHaveBeenCalledWith({
			payload: {
				backlinks: [
					{
						issueFingerprint: "timeout:execution-control",
						issueLink: "https://sentry.example/issues/123",
						requestId: "req_01HQ",
						traceId: "trace_01HQ",
						traceLink: "https://sentry.example/traces/trace_01HQ",
					},
				],
			},
		});
	});

	it("accepts sanitized Langfuse eval backlinks through the internal ingest seam", async () => {
		const service = {
			ingestExecutionAuditEvents: vi.fn(),
			ingestGrades: vi.fn(),
			ingestLangfuseEvalBacklinks: vi.fn().mockResolvedValue({ accepted: 1 }),
			ingestTraceBacklinks: vi.fn(),
		};
		const app = createApp(env as never, {
			operatorObservabilityCommandService: service as never,
		});

		const payload = {
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
		};
		const response = await app.fetch(
			new Request("https://app-api.internal/api/internal/operator/langfuse/eval-backlinks", {
				body: JSON.stringify(payload),
				headers: {
					"content-type": "application/json",
					"x-app-internal-auth": "trusted-secret",
				},
				method: "POST",
			}),
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ accepted: 1 });
		expect(service.ingestLangfuseEvalBacklinks).toHaveBeenCalledWith({ payload });
	});

	it("accepts execution audit events through the internal ingest seam", async () => {
		const service = {
			ingestExecutionAuditEvents: vi.fn().mockResolvedValue({ accepted: 1 }),
			ingestTemporalTaskQueueSnapshots: vi.fn(),
			ingestGrades: vi.fn(),
			ingestTraceBacklinks: vi.fn(),
		};
		const scheduleRequestProjectionDrain = vi.fn();
		const app = createApp(env as never, {
			operatorObservabilityCommandService: service as never,
			scheduleRequestProjectionDrain,
		});

		const response = await app.fetch(
			new Request("https://app-api.internal/api/internal/execution/audit-events", {
				body: JSON.stringify({
					events: [
						{
														decision: null,
							duration_ms: 35012,
							event_id: "execution-control:req_01HQ:execution.runtime_failed",
							event_type: "execution.runtime_failed",
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
				}),
				headers: {
					"content-type": "application/json",
					"x-app-internal-auth": "trusted-secret",
				},
				method: "POST",
			}),
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ accepted: 1 });
		expect(service.ingestExecutionAuditEvents).toHaveBeenCalledWith({
			payload: {
				events: [
					{
												decision: null,
						duration_ms: 35012,
						event_id: "execution-control:req_01HQ:execution.runtime_failed",
						event_type: "execution.runtime_failed",
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
		});
		expect(scheduleRequestProjectionDrain).toHaveBeenCalledWith({
			requestId: "req_01HQ",
			waitUntil: undefined,
		});
	});

	it("accepts Temporal task queue snapshots through the internal runtime ingest seam", async () => {
		const service = {
			ingestExecutionAuditEvents: vi.fn(),
			ingestTemporalTaskQueueSnapshots: vi.fn().mockResolvedValue({
				acceptedActuations: 1,
				acceptedDecisions: 1,
				acceptedPostures: 1,
				acceptedSnapshots: 1,
			}),
			ingestGrades: vi.fn(),
			ingestTraceBacklinks: vi.fn(),
		};
		const app = createApp(env as never, {
			operatorObservabilityCommandService: service as never,
		});
		const payload = {
			actuations: [
				{
					actedAt: "2026-06-15T10:00:06.000Z",
					actuationId: "actuation_01",
					action: "scale",
					actuatorKind: "docker_compose",
					decisionId: "decision_01",
					fromReplicas: 1,
					status: "applied",
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
						backlog: { state: "unsupported_by_source" },
						pollerCount: 0,
					},
					reason: "required poller floor is not met",
					sourceSnapshotId: "temporal-snapshot-20260615T100000Z",
					targetService: "activity-worker-knowledge-retrieval",
					taskQueue: "campus-agent.activity.knowledge.retrieval",
					taskQueueKind: "activity",
				},
			],
			postures: [
				{
					currentReplicas: 1,
					desiredReplicas: 2,
					evidence: {
						hpaName: "keda-hpa-activity-worker-knowledge-retrieval",
						kedaScaledObject: "activity-worker-knowledge-retrieval",
					},
					lastScaleEventAt: "2026-06-15T10:00:06.000Z",
					lastScaleEventId: "actuation_01",
					maxReplicas: 5,
					metricFreshness: { ms: 15000, state: "observed" },
					minReplicas: 1,
					observedAt: "2026-06-15T10:00:08.000Z",
					reason: "hpa desired replicas above current replicas",
					scalerKind: "keda_temporal",
					scalerStatus: "healthy",
					taskQueue: "campus-agent.activity.knowledge.retrieval",
					taskQueueKind: "activity",
					targetService: "activity-worker-knowledge-retrieval",
				},
			],
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
					snapshotId: "temporal-snapshot-20260615T100000Z",
					source: "execution-control.temporal-task-queue-sampler",
					taskQueue: "campus-agent.activity.knowledge.retrieval",
					taskQueueKind: "activity",
				},
			],
		};

		const response = await app.fetch(
			new Request(
				"https://app-api.internal/api/internal/operator/runtime/temporal-task-queue-snapshots",
				{
					body: JSON.stringify(payload),
					headers: {
						"content-type": "application/json",
						"x-app-internal-auth": "trusted-secret",
					},
					method: "POST",
				},
			),
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			acceptedActuations: 1,
			acceptedDecisions: 1,
			acceptedPostures: 1,
			acceptedSnapshots: 1,
		});
		expect(service.ingestTemporalTaskQueueSnapshots).toHaveBeenCalledWith({
			payload,
			persistHistory: false,
		});
	});

	it("marks Temporal runtime ingest as history only for explicit proof requests", async () => {
		const service = {
			ingestExecutionAuditEvents: vi.fn(),
			ingestTemporalTaskQueueSnapshots: vi.fn().mockResolvedValue({
				acceptedActuations: 0,
				acceptedDecisions: 0,
				acceptedSnapshots: 1,
			}),
			ingestGrades: vi.fn(),
			ingestTraceBacklinks: vi.fn(),
		};
		const app = createApp(env as never, {
			operatorObservabilityCommandService: service as never,
		});
		const payload = {
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
					taskQueue: "campus-agent.activity.knowledge.retrieval",
					taskQueueKind: "activity",
				},
			],
		};

		const response = await app.fetch(
			new Request(
				"https://app-api.internal/api/internal/operator/runtime/temporal-task-queue-snapshots?history=1",
				{
					body: JSON.stringify(payload),
					headers: {
						"content-type": "application/json",
						"x-app-internal-auth": "trusted-secret",
					},
					method: "POST",
				},
			),
		);

		expect(response.status).toBe(200);
		expect(service.ingestTemporalTaskQueueSnapshots).toHaveBeenCalledWith({
			payload,
			persistHistory: true,
		});
	});

	it("exposes latest Temporal task queue projections through the internal runtime query seam", async () => {
		const service = {
			listTemporalTaskQueues: vi.fn().mockResolvedValue({
				page: { nextCursor: null },
				snapshots: [
					{
						backlog: { count: null, state: "unsupported_by_source" },
						namespace: "campus-agent-staging",
						oldestTaskAge: { ms: null, state: "unsupported_by_source" },
						pollerCount: 0,
						pollerIdentities: [],
						projectedAt: "2026-06-15T10:00:01.000Z",
						sampledAt: "2026-06-15T10:00:00.000Z",
						scheduleToStartLatency: { ms: null, state: "unsupported_by_source" },
						snapshotId: "temporal-snapshot-knowledge",
						source: "execution-control.temporal-task-queue-sampler",
						taskQueue: "campus-agent.activity.knowledge.retrieval",
						taskQueueKind: "activity",
					},
				],
			}),
		};
		const app = createApp(env as never, {
			operatorQueryService: service as never,
		});

		const response = await app.fetch(
			new Request(
				"https://app-api.internal/api/internal/operator/runtime/temporal-task-queues?limit=8",
				{
					headers: {
						"x-app-internal-auth": "trusted-secret",
					},
				},
			),
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			page: { nextCursor: null },
			snapshots: [
				{
					backlog: { count: null, state: "unsupported_by_source" },
					namespace: "campus-agent-staging",
					oldestTaskAge: { ms: null, state: "unsupported_by_source" },
					pollerCount: 0,
					pollerIdentities: [],
					projectedAt: "2026-06-15T10:00:01.000Z",
					sampledAt: "2026-06-15T10:00:00.000Z",
					scheduleToStartLatency: { ms: null, state: "unsupported_by_source" },
					snapshotId: "temporal-snapshot-knowledge",
					source: "execution-control.temporal-task-queue-sampler",
					taskQueue: "campus-agent.activity.knowledge.retrieval",
					taskQueueKind: "activity",
				},
			],
		});
		expect(service.listTemporalTaskQueues).toHaveBeenCalledWith({
			filters: {
				cursor: null,
				limit: 8,
				taskQueue: null,
				taskQueueKind: null,
			},
			principal: expect.objectContaining({
				permissions: { chat: false, operator: true },
				principal: expect.objectContaining({
					principalId: "execution-control-runtime",
					type: "operator",
				}),
			}),
		});
	});

	it("exposes autoscaler actuation projections through the internal runtime query seam", async () => {
		const service = {
			listAutoscalerActuations: vi.fn().mockResolvedValue({
				actuations: [
					{
						actedAt: "2026-06-15T10:00:06.000Z",
						action: "scale",
						actuationId: "actuation_01",
						actuatorKind: "docker_compose",
						decisionId: "decision_01",
						errorCode: "docker_compose_scale_failed",
						fromReplicas: 1,
						projectedAt: "2026-06-15T10:00:07.000Z",
						status: "failed",
						targetService: "activity-worker-knowledge-retrieval",
						toReplicas: 2,
					},
				],
				page: { nextCursor: null },
			}),
		};
		const app = createApp(env as never, {
			operatorQueryService: service as never,
		});

		const response = await app.fetch(
			new Request(
				"https://app-api.internal/api/internal/operator/runtime/autoscaler/actuations?limit=8&targetService=activity-worker-knowledge-retrieval&status=failed",
				{
					headers: {
						"x-app-internal-auth": "trusted-secret",
					},
				},
			),
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			actuations: [
				{
					actedAt: "2026-06-15T10:00:06.000Z",
					action: "scale",
					actuationId: "actuation_01",
					actuatorKind: "docker_compose",
					decisionId: "decision_01",
					errorCode: "docker_compose_scale_failed",
					fromReplicas: 1,
					projectedAt: "2026-06-15T10:00:07.000Z",
					status: "failed",
					targetService: "activity-worker-knowledge-retrieval",
					toReplicas: 2,
				},
			],
			page: { nextCursor: null },
		});
		expect(service.listAutoscalerActuations).toHaveBeenCalledWith({
			filters: {
				cursor: null,
				decisionId: null,
				limit: 8,
				status: "failed",
				targetService: "activity-worker-knowledge-retrieval",
			},
			principal: expect.objectContaining({
				permissions: { chat: false, operator: true },
				principal: expect.objectContaining({
					principalId: "execution-control-runtime",
					type: "operator",
				}),
			}),
		});
	});

	it("fails closed when the internal shared secret is missing", async () => {
		const service = {
			ingestExecutionAuditEvents: vi.fn(),
			ingestTemporalTaskQueueSnapshots: vi.fn(),
			ingestGrades: vi.fn(),
			ingestTraceBacklinks: vi.fn(),
		};
		const app = createApp(env as never, {
			operatorObservabilityCommandService: service as never,
		});

		const response = await app.fetch(
			new Request("https://app-api.internal/api/internal/operator/quality/grades", {
				body: JSON.stringify({ grades: [] }),
				headers: {
					"content-type": "application/json",
				},
				method: "POST",
			}),
		);

		expect(response.status).toBe(401);
		await expect(response.json()).resolves.toEqual({
			error: {
				code: "service_credential_required",
				details: null,
				message: "Collector service credential required.",
				requestId: null,
				retryable: false,
				traceId: null,
			},
		});
		expect(service.ingestGrades).not.toHaveBeenCalled();
	});
});
