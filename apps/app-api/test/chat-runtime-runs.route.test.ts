// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";
import { ExecutionControlTransportError } from "../src/modules/integration";
import { AppApiRouteError } from "../src/modules/runtime-command";

const env = {
	APP_API_NAME: "campus-agent-app-api",
	APP_API_ENVIRONMENT: "test" as const,
	BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
	AUTH_SHELL_ORIGIN: "https://campus.muc.wiki",
	EXECUTION_CONTROL_BASE_URL: "https://execution-control.internal",
	EXECUTION_CONTROL_SHARED_SECRET: "shared-secret",
	APP_API_DB: {
		connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
	},
};

function createCampusPrincipal() {
	return {
		actor: {
			departments: [],
			principalId: "user_01HQ",
			principalType: "campus_member",
			roles: ["campus_member"],
			userId: "user_01HQ",
		},
		permissions: {
			chat: true,
			operator: false,
		},
		principal: {
			displayName: "Jane Doe",
			email: "jane@example.edu",
			principalId: "user_01HQ",
			type: "campus_member" as const,
		},
		session: {
			expiresAt: "2026-03-29T07:00:00.000Z",
			sessionId: "sess_01HQ",
		},
	};
}

describe("chat durable run routes", () => {
	it("returns run events for the current principal owned run", async () => {
		const runtimeRunService = {
			cancel: vi.fn(),
			getStatus: vi.fn(),
			listEvents: vi.fn().mockResolvedValue({
				events: [
					{
						eventId: "event-final",
						eventType: "finalization.completed",
						occurredAt: "2026-06-04T01:02:06.000Z",
						payload: {
							request_id: "req_01HQ",
							trace_id: "trace_01HQ",
						},
						runId: "run_01HQ",
						sequence: 3,
						visibility: "browser",
					},
				],
				run: {
					conversationId: "conv_01HQ",
					phase: "completed",
					requestId: "req_01HQ",
					runId: "run_01HQ",
					status: "completed",
					traceId: "trace_01HQ",
				},
			}),
			listSteps: vi.fn(),
			subscribeEvents: vi.fn(),
		};
		const app = createApp(env, {
			getPrincipal: vi.fn().mockResolvedValue(createCampusPrincipal()),
			runtimeRunService,
		});

		const response = await app.fetch(
			new Request("https://app-api.internal/api/chat/runs/run_01HQ/events?after_sequence=2", {
				method: "GET",
			}),
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			events: [
				{
					eventId: "event-final",
					eventType: "finalization.completed",
					occurredAt: "2026-06-04T01:02:06.000Z",
					payload: {
						request_id: "req_01HQ",
						trace_id: "trace_01HQ",
					},
					runId: "run_01HQ",
					sequence: 3,
					visibility: "browser",
				},
			],
			run: {
				conversationId: "conv_01HQ",
				phase: "completed",
				requestId: "req_01HQ",
				runId: "run_01HQ",
				status: "completed",
				traceId: "trace_01HQ",
			},
		});
		expect(runtimeRunService.listEvents).toHaveBeenCalledWith({
			principal: expect.objectContaining({
				actor: expect.objectContaining({ userId: "user_01HQ" }),
			}),
			afterSequence: 2,
			runId: "run_01HQ",
		});
	});

	it("streams chat product events from a resume cursor without creating a new request", async () => {
		const chatCommandService = {
			reconcileDurableCloseouts: vi.fn().mockResolvedValue({
				failed: 0,
				finalized: 1,
				scanned: 1,
			}),
			submit: vi.fn(),
			submitStream: vi.fn(),
		};
		const runtimeRunService = {
			cancel: vi.fn(),
			getStatus: vi.fn().mockResolvedValue({
				run: {
					conversationId: "conv_01HQ",
					phase: "completed",
					requestId: "req_01HQ",
					runId: "run_01HQ",
					status: "completed",
					traceId: "trace_01HQ",
				},
			}),
			listEvents: vi.fn(),
			listSteps: vi.fn(),
			subscribeEvents: vi.fn().mockReturnValue(
				(async function* () {
					yield {
						eventId: "event-final",
						eventType: "finalization.completed",
						occurredAt: "2026-06-04T01:02:06.000Z",
						payload: {
							request_id: "req_01HQ",
							trace_id: "trace_01HQ",
						},
						runId: "run_01HQ",
						sequence: 3,
						visibility: "browser",
					};
				})(),
			),
		};
		const app = createApp(env, {
			chatCommandService,
			getPrincipal: vi.fn().mockResolvedValue(createCampusPrincipal()),
			runtimeRunService,
		});

		const response = await app.fetch(
			new Request(
				"https://app-api.internal/api/chat/runs/run_01HQ/events/stream?after_sequence=2",
				{
					method: "GET",
				},
			),
		);

		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain("text/event-stream");
		expect(response.headers.get("x-run-id")).toBe("run_01HQ");
		expect(response.headers.get("x-request-id")).toBe("req_01HQ");
		expect(response.headers.get("x-trace-id")).toBe("trace_01HQ");
		const streamBody = await response.text();
		expect(parseSingleSseBlock(streamBody)).toEqual({
			data: {
				occurredAt: "2026-06-04T01:02:06.000Z",
				requestId: "req_01HQ",
				runId: "run_01HQ",
				sequence: 3,
				status: "completed",
				traceId: "trace_01HQ",
			},
			event: "request.completed",
		});
		expect(runtimeRunService.getStatus).toHaveBeenCalledWith({
			principal: expect.objectContaining({
				actor: expect.objectContaining({ userId: "user_01HQ" }),
			}),
			runId: "run_01HQ",
		});
		expect(runtimeRunService.subscribeEvents).toHaveBeenCalledWith({
			principal: expect.objectContaining({
				actor: expect.objectContaining({ userId: "user_01HQ" }),
			}),
			afterSequence: 2,
			runId: "run_01HQ",
		});
		expect(runtimeRunService.listEvents).not.toHaveBeenCalled();
		expect(chatCommandService.reconcileDurableCloseouts).toHaveBeenCalledWith({
			limit: 1,
			runId: "run_01HQ",
			startedBefore: expect.any(String),
		});
		expect(chatCommandService.submit).not.toHaveBeenCalled();
		expect(chatCommandService.submitStream).not.toHaveBeenCalled();
	});

	it("writes a keepalive comment before waiting for the next durable run event", async () => {
		const runtimeRunService = {
			cancel: vi.fn(),
			getStatus: vi.fn().mockResolvedValue({
				run: {
					conversationId: "conv_01HQ",
					phase: "running",
					requestId: "req_01HQ",
					runId: "run_01HQ",
					status: "running",
					traceId: "trace_01HQ",
				},
			}),
			listEvents: vi.fn(),
			listSteps: vi.fn(),
			subscribeEvents: vi.fn().mockReturnValue(
				(async function* () {
					await new Promise((resolve) => setTimeout(resolve, 100));
					yield {
						eventId: "event-final",
						eventType: "finalization.completed",
						occurredAt: "2026-06-04T01:02:06.000Z",
						payload: {
							request_id: "req_01HQ",
							trace_id: "trace_01HQ",
						},
						runId: "run_01HQ",
						sequence: 3,
						visibility: "browser",
					};
				})(),
			),
		};
		const app = createApp(env, {
			getPrincipal: vi.fn().mockResolvedValue(createCampusPrincipal()),
			runtimeRunService,
		});

		const response = await app.fetch(
			new Request(
				"https://app-api.internal/api/chat/runs/run_01HQ/events/stream?after_sequence=2",
				{
					method: "GET",
				},
			),
		);

		expect(response.status).toBe(200);
		const firstChunk = await response.body?.getReader().read();
		expect(new TextDecoder().decode(firstChunk?.value)).toBe(": keepalive\n\n");
	});

	it("routes cancel through the product runtime run service", async () => {
		const runtimeRunService = {
			cancel: vi.fn().mockResolvedValue({
				run: {
					conversationId: "conv_01HQ",
					phase: "canceled",
					requestId: "req_01HQ",
					runId: "run_01HQ",
					status: "canceled",
					traceId: "trace_01HQ",
				},
			}),
			getStatus: vi.fn(),
			listEvents: vi.fn(),
			listSteps: vi.fn(),
			subscribeEvents: vi.fn(),
		};
		const app = createApp(env, {
			getPrincipal: vi.fn().mockResolvedValue(createCampusPrincipal()),
			runtimeRunService,
		});

		const response = await app.fetch(
			new Request("https://app-api.internal/api/chat/runs/run_01HQ/cancel", {
				body: JSON.stringify({ reason: "user_requested" }),
				headers: {
					"content-type": "application/json",
				},
				method: "POST",
			}),
		);

		expect(response.status).toBe(202);
		await expect(response.json()).resolves.toEqual({
			run: {
				conversationId: "conv_01HQ",
				phase: "canceled",
				requestId: "req_01HQ",
				runId: "run_01HQ",
				status: "canceled",
				traceId: "trace_01HQ",
			},
		});
		expect(runtimeRunService.cancel).toHaveBeenCalledWith({
			principal: expect.objectContaining({
				actor: expect.objectContaining({ userId: "user_01HQ" }),
			}),
			reason: "user_requested",
			runId: "run_01HQ",
		});
	});

	it("maps run ownership misses to the shared not-found envelope", async () => {
		const runtimeRunService = {
			cancel: vi.fn(),
			getStatus: vi.fn().mockRejectedValue(
				new AppApiRouteError({
					code: "run_not_found",
					message: "Run not found.",
					retryable: false,
					status: 404,
				}),
			),
			listEvents: vi.fn(),
			listSteps: vi.fn(),
			subscribeEvents: vi.fn(),
		};
		const app = createApp(env, {
			getPrincipal: vi.fn().mockResolvedValue(createCampusPrincipal()),
			runtimeRunService,
		});

		const response = await app.fetch(
			new Request("https://app-api.internal/api/chat/runs/run_other", {
				method: "GET",
			}),
		);

		expect(response.status).toBe(404);
		await expect(response.json()).resolves.toMatchObject({
			error: {
				code: "run_not_found",
				message: "Run not found.",
				retryable: false,
			},
		});
	});

	it("maps durable runtime transport failures to a typed route error envelope", async () => {
		const runtimeRunService = {
			cancel: vi.fn(),
			getStatus: vi.fn().mockRejectedValue(
				new ExecutionControlTransportError({
					code: "execution_control_invalid_response",
					message:
						"Execution durable runtime response violates the contract: status must be a string.",
					retryable: true,
					status: 502,
				}),
			),
			listEvents: vi.fn(),
			listSteps: vi.fn(),
			subscribeEvents: vi.fn(),
		};
		const app = createApp(env, {
			getPrincipal: vi.fn().mockResolvedValue(createCampusPrincipal()),
			runtimeRunService,
		});

		const response = await app.fetch(
			new Request(
				"https://app-api.internal/api/chat/runs/run_01HQ/events/stream?after_sequence=0",
				{
					method: "GET",
				},
			),
		);

		expect(response.status).toBe(502);
		await expect(response.json()).resolves.toMatchObject({
			error: {
				code: "execution_control_invalid_response",
				message:
					"Execution durable runtime response violates the contract: status must be a string.",
				retryable: true,
			},
		});
	});

	it("returns sanitized run step trajectory for the current principal owned run", async () => {
		const runtimeRunService = {
			cancel: vi.fn(),
			getStatus: vi.fn(),
			listEvents: vi.fn(),
			listSteps: vi.fn().mockResolvedValue({
				attempts: [],
				results: [
					{
						attemptId: "attempt-memory",
						createdAt: "2026-06-04T01:02:05.000Z",
						payloadSchemaVersion: "step-result-projection-v1",
						projectionRef: "projection://runs/run_01HQ/memory/recall",
						resultId: "result-memory",
						resultKind: "memory_recall_result",
						runId: "run_01HQ",
						sanitizedPayload: {
							memory_ref: "projection://runs/run_01HQ/memory/recall",
							selected_memory_count: 1,
						},
						status: "completed",
						stepId: "memory.recall",
					},
				],
				run: {
					conversationId: "conv_01HQ",
					phase: "completed",
					requestId: "req_01HQ",
					runId: "run_01HQ",
					status: "completed",
					traceId: "trace_01HQ",
				},
				steps: [
					{
						capability: "any",
						completedAt: "2026-06-04T01:02:05.000Z",
						conversationId: "conv_01HQ",
						parentStepId: "",
						payloadSchemaVersion: "run-step-projection-v1",
						runId: "run_01HQ",
						sanitizedPayload: {
							memory_ref: "projection://runs/run_01HQ/memory/recall",
							selected_memory_count: 1,
						},
						startedAt: "2026-06-04T01:02:04.000Z",
						status: "completed",
						stepId: "memory.recall",
						stepKind: "memory",
						taskQueue: "context",
						updatedAt: "2026-06-04T01:02:05.000Z",
						workerId: "test-worker",
					},
				],
			}),
			subscribeEvents: vi.fn(),
		};
		const app = createApp(env, {
			getPrincipal: vi.fn().mockResolvedValue(createCampusPrincipal()),
			runtimeRunService,
		});

		const response = await app.fetch(
			new Request("https://app-api.internal/api/chat/runs/run_01HQ/steps", {
				method: "GET",
			}),
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			attempts: [],
			results: [
				{
					attemptId: "attempt-memory",
					createdAt: "2026-06-04T01:02:05.000Z",
					payloadSchemaVersion: "step-result-projection-v1",
					projectionRef: "projection://runs/run_01HQ/memory/recall",
					resultId: "result-memory",
					resultKind: "memory_recall_result",
					runId: "run_01HQ",
					sanitizedPayload: {
						memory_ref: "projection://runs/run_01HQ/memory/recall",
						selected_memory_count: 1,
					},
					status: "completed",
					stepId: "memory.recall",
				},
			],
			run: {
				conversationId: "conv_01HQ",
				phase: "completed",
				requestId: "req_01HQ",
				runId: "run_01HQ",
				status: "completed",
				traceId: "trace_01HQ",
			},
			steps: [
				{
					capability: "any",
					completedAt: "2026-06-04T01:02:05.000Z",
					conversationId: "conv_01HQ",
					parentStepId: "",
					payloadSchemaVersion: "run-step-projection-v1",
					runId: "run_01HQ",
					sanitizedPayload: {
						memory_ref: "projection://runs/run_01HQ/memory/recall",
						selected_memory_count: 1,
					},
					startedAt: "2026-06-04T01:02:04.000Z",
					status: "completed",
					stepId: "memory.recall",
					stepKind: "memory",
					taskQueue: "context",
					updatedAt: "2026-06-04T01:02:05.000Z",
					workerId: "test-worker",
				},
			],
		});
		expect(runtimeRunService.listSteps).toHaveBeenCalledWith({
			principal: expect.objectContaining({
				actor: expect.objectContaining({ userId: "user_01HQ" }),
			}),
			runId: "run_01HQ",
		});
	});
});

function parseSingleSseBlock(body: string): { data: unknown; event: string } {
	const lines = body.trim().split(/\r?\n/);
	const eventLine = lines.find((line) => line.startsWith("event: "));
	const dataLine = lines.find((line) => line.startsWith("data: "));
	if (!(eventLine && dataLine)) {
		throw new Error(`Invalid SSE block: ${body}`);
	}
	return {
		data: JSON.parse(dataLine.slice("data: ".length)),
		event: eventLine.slice("event: ".length),
	};
}
