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

	it("accepts safe replay packet index metadata through the internal ingest seam", async () => {
		const replayCaptureService = {
			ingestReplayPacketIndex: vi.fn().mockResolvedValue({
				accepted: 1,
				packetId: "llm_replay_packet_rag_01",
			}),
		};
		const app = createApp(env as never, {
			replayCaptureService: replayCaptureService as never,
		});
		const payload = replayPacketIndexPayload();

		const response = await app.fetch(
			new Request("https://app-api.internal/api/internal/observability/replay-packet-index", {
				body: JSON.stringify(payload),
				headers: {
					"content-type": "application/json",
					"x-app-internal-auth": "trusted-secret",
				},
				method: "POST",
			}),
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			accepted: 1,
			packetId: "llm_replay_packet_rag_01",
		});
		expect(replayCaptureService.ingestReplayPacketIndex).toHaveBeenCalledWith({ payload });
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

function replayPacketIndexPayload() {
	return {
		schema_version: "llm_replay_packet_index.v1",
		packet_id: "llm_replay_packet_rag_01",
		run_id: "run_rag_01",
		request_id: "req_rag_01",
		trace_id: "trace_rag_01",
		object_ref: "s3://llm-replay/llm-replay-packets/2026/07/05/llm_replay_packet_rag_01.json",
		object_checksum_sha256:
			"sha256:4444444444444444444444444444444444444444444444444444444444444444",
		sensitivity_classification: "restricted_llm_io_with_evidence",
		capture_policy: {
			schema_version: "raw_capture_policy.v1",
			mode: "manual_run_capture",
			capture_reason: "operator_approved_badcase_replay",
			ttl_days: 7,
			allowed_sinks: ["s3_replay_packet"],
			allowed_raw_fields: ["rendered_messages", "selected_evidence_packet"],
			operator_principal: "operator:user_01",
			approval_ref: "approval_rag_01",
			request_id: "req_rag_01",
			run_id: "run_rag_01",
			trace_id: "trace_rag_01",
			audit_required: true,
			dsar_delete_linkage_required: true,
		},
		llm_io_fingerprint: {
			schema_version: "llm_io_fingerprint.v1",
			run_id: "run_rag_01",
			request_id: "req_rag_01",
			trace_id: "trace_rag_01",
			runtime_release: "execution-control@test",
			provider_profile_revision: "rag_synthesis:provider_profile_rag:4",
			provider: "openai",
			model: "gpt-5-mini",
			model_params_hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			prompt_id: "rag_synthesis_answer",
			prompt_template_sha256:
				"sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
			prompt_variables_schema_version: "rag_synthesis_packet.v1",
			rendered_prompt_sha256:
				"sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
			tool_catalog_sha256:
				"sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
			tool_schema_sha256: "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
			workflow_artifact_sha256:
				"sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
			context_envelope_sha256:
				"sha256:1111111111111111111111111111111111111111111111111111111111111111",
			memory_selection_sha256:
				"sha256:2222222222222222222222222222222222222222222222222222222222222222",
			evidence_packet_sha256:
				"sha256:3333333333333333333333333333333333333333333333333333333333333333",
			output_schema_id: "rag_answer_v2",
		},
		deletion_linkage: {
			subject_ref: "user_hash_01",
			conversation_id: "conv_rag_01",
			request_id: "req_rag_01",
			trace_id: "trace_rag_01",
			memory_ref_count: 0,
			evidence_ref_count: 1,
		},
		encryption_key_ref: "kms:local-dev-replay",
		approval_ref: "approval_rag_01",
		operator_principal: "operator:user_01",
		created_at: "2026-07-05T00:00:00Z",
		expires_at: "2026-07-12T00:00:00Z",
	};
}
