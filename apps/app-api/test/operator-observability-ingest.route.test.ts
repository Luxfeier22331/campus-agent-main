// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";

const env = {
	APP_API_NAME: "campus-agent-app-api",
	APP_API_ENVIRONMENT: "test" as const,
	APP_API_INTERNAL_SHARED_SECRET: "trusted-secret",
	BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
	AUTH_SHELL_ORIGIN: "https://campus.muc.wiki",
	PUBLIC_CHAT_WEB_ORIGIN: "https://chat.example.com",
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

	it("accepts execution audit events through the internal ingest seam", async () => {
		const service = {
			ingestExecutionAuditEvents: vi.fn().mockResolvedValue({ accepted: 1 }),
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
		});
		expect(scheduleRequestProjectionDrain).toHaveBeenCalledWith({
			requestId: "req_01HQ",
			waitUntil: undefined,
		});
	});

	it("fails closed when the internal shared secret is missing", async () => {
		const service = {
			ingestExecutionAuditEvents: vi.fn(),
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
