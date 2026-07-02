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
	it("accepts execution audit events through the internal ingest seam", async () => {
		const service = {
			ingestExecutionAuditEvents: vi.fn().mockResolvedValue({ accepted: 1 }),
			ingestTemporalTaskQueueSnapshots: vi.fn(),
		};
		const scheduleRequestProjectionDrain = vi.fn();
		const app = createApp(env as never, {
			operatorObservabilityCommandService: service as never,
			scheduleRequestProjectionDrain,
		});

		const payload = {
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
		};

		const response = await app.fetch(
			new Request("https://app-api.internal/api/internal/execution/audit-events", {
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
		expect(service.ingestExecutionAuditEvents).toHaveBeenCalledWith({ payload });
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
						backlog: { state: "unsupported_by_source" },
						pollerCount: 0,
					},
					reason: "required poller floor is not met",
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
						kedaScaledObject: "activity-worker-knowledge",
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
					taskQueue: "campus-agent.activity.knowledge",
					taskQueueKind: "activity",
					targetService: "activity-worker-knowledge",
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
					taskQueue: "campus-agent.activity.knowledge",
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
				acceptedPostures: 0,
				acceptedSnapshots: 1,
			}),
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
					taskQueue: "campus-agent.activity.knowledge",
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

	it("keeps retired internal quality grades and trace backlink ingest routes closed", async () => {
		const service = {
			ingestExecutionAuditEvents: vi.fn(),
			ingestTemporalTaskQueueSnapshots: vi.fn(),
		};
		const app = createApp(env as never, {
			operatorObservabilityCommandService: service as never,
		});

		for (const path of [
			"/api/internal/operator/quality/grades",
			"/api/internal/operator/trace-backlinks",
		]) {
			const response = await app.fetch(
				new Request(`https://app-api.internal${path}`, {
					body: JSON.stringify({}),
					headers: {
						"content-type": "application/json",
						"x-app-internal-auth": "trusted-secret",
					},
					method: "POST",
				}),
			);
			expect(response.status, path).toBe(404);
		}
	});

	it("fails closed when the internal shared secret is missing", async () => {
		const service = {
			ingestExecutionAuditEvents: vi.fn(),
			ingestTemporalTaskQueueSnapshots: vi.fn(),
		};
		const app = createApp(env as never, {
			operatorObservabilityCommandService: service as never,
		});

		const response = await app.fetch(
			new Request("https://app-api.internal/api/internal/execution/audit-events", {
				body: JSON.stringify({ events: [] }),
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
		expect(service.ingestExecutionAuditEvents).not.toHaveBeenCalled();
	});
});
