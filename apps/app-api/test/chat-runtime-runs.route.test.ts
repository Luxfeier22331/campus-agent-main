// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";
import { ExecutionControlTransportError } from "../src/modules/integration";
import { AppApiRouteError } from "../src/modules/runtime-command";

const env = {
	DEPLOYMENT_ENVIRONMENT: "test" as const,
	BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
	AUTH_SHELL_ORIGIN: "https://campus.muc.wiki",
	EXECUTION_CONTROL_BASE_URL: "https://execution-control.internal",
	APP_API_EXECUTION_SHARED_SECRET: "shared-secret",
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
						eventType: "request.completed",
						occurredAt: "2026-06-04T01:02:06.000Z",
						payload: {},
						requestId: "req_01HQ",
						sequence: 3,
					},
				],
				run: {
					conversationId: "conv_01HQ",
					phase: "completed",
					requestId: "req_01HQ",
					status: "completed",
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
			new Request("https://app-api.internal/api/chat/requests/req_01HQ/events?after_sequence=2", {
				method: "GET",
			}),
		);

		expect(response.status).toBe(200);
		const responseBody = await response.json();
		expect(responseBody).toEqual({
			events: [
				{
					eventType: "request.completed",
					occurredAt: "2026-06-04T01:02:06.000Z",
					payload: {},
					requestId: "req_01HQ",
					sequence: 3,
				},
			],
			run: {
				conversationId: "conv_01HQ",
				phase: "completed",
				requestId: "req_01HQ",
				status: "completed",
			},
		});
		expect(runtimeRunService.listEvents).toHaveBeenCalledWith({
			principal: expect.objectContaining({
				actor: expect.objectContaining({ userId: "user_01HQ" }),
			}),
			afterSequence: 2,
			requestId: "req_01HQ",
			signal: expect.any(AbortSignal),
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
					status: "completed",
				},
			}),
			listEvents: vi.fn(),
			listSteps: vi.fn(),
			subscribeEvents: vi.fn().mockReturnValue(
				(async function* () {
					yield {
						eventType: "request.completed",
						occurredAt: "2026-06-04T01:02:06.000Z",
						payload: {},
						requestId: "req_01HQ",
						sequence: 3,
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
				"https://app-api.internal/api/chat/requests/req_01HQ/events/stream?after_sequence=2",
				{
					method: "GET",
				},
			),
		);

		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain("text/event-stream");
		expect(response.headers.get("x-request-id")).toBe("req_01HQ");
		expect(response.headers.get("x-trace-id")).toBeNull();
		const streamBody = await response.text();
		expect(parseSingleSseBlock(streamBody)).toEqual({
			data: {
				occurredAt: "2026-06-04T01:02:06.000Z",
				requestId: "req_01HQ",
				sequence: 3,
				status: "completed",
			},
			event: "request.completed",
		});
		expect(runtimeRunService.getStatus).toHaveBeenCalledWith({
			principal: expect.objectContaining({
				actor: expect.objectContaining({ userId: "user_01HQ" }),
			}),
			requestId: "req_01HQ",
		});
		expect(runtimeRunService.subscribeEvents).toHaveBeenCalledWith({
			principal: expect.objectContaining({
				actor: expect.objectContaining({ userId: "user_01HQ" }),
			}),
			afterSequence: 2,
			requestId: "req_01HQ",
			signal: expect.any(AbortSignal),
		});
		expect(runtimeRunService.listEvents).not.toHaveBeenCalled();
		expect(chatCommandService.reconcileDurableCloseouts).not.toHaveBeenCalled();
		expect(chatCommandService.submit).not.toHaveBeenCalled();
		expect(chatCommandService.submitStream).not.toHaveBeenCalled();
	});

	it("aborts durable event polling when the SSE reader is cancelled", async () => {
		let subscriptionSignal: AbortSignal | undefined;
		const returnIterator = vi.fn().mockResolvedValue({ done: true, value: undefined });
		const events: AsyncIterable<never> = {
			[Symbol.asyncIterator]() {
				return {
					next: () => new Promise<IteratorResult<never>>(() => undefined),
					return: returnIterator,
				};
			},
		};
		const runtimeRunService = {
			cancel: vi.fn(),
			getStatus: vi.fn().mockResolvedValue({
				run: {
					conversationId: "conv_01HQ",
					phase: "running",
					requestId: "req_01HQ",
					status: "running",
				},
			}),
			listEvents: vi.fn(),
			listSteps: vi.fn(),
			subscribeEvents: vi.fn((input: { signal?: AbortSignal }) => {
				subscriptionSignal = input.signal;
				return events;
			}),
		};
		const app = createApp(env, {
			getPrincipal: vi.fn().mockResolvedValue(createCampusPrincipal()),
			runtimeRunService,
		});

		const response = await app.fetch(
			new Request("https://app-api.internal/api/chat/requests/req_01HQ/events/stream", {
				method: "GET",
			}),
		);
		const reader = response.body?.getReader();
		await reader?.read();
		await reader?.cancel();

		expect(subscriptionSignal?.aborted).toBe(true);
		expect(returnIterator).toHaveBeenCalledOnce();
	});

	it("writes a keepalive comment before waiting for the next durable run event", async () => {
		const runtimeRunService = {
			cancel: vi.fn(),
			getStatus: vi.fn().mockResolvedValue({
				run: {
					conversationId: "conv_01HQ",
					phase: "running",
					requestId: "req_01HQ",
					status: "running",
				},
			}),
			listEvents: vi.fn(),
			listSteps: vi.fn(),
			subscribeEvents: vi.fn().mockReturnValue(
				(async function* () {
					await new Promise((resolve) => setTimeout(resolve, 100));
					yield {
						eventType: "request.completed",
						occurredAt: "2026-06-04T01:02:06.000Z",
						payload: {},
						requestId: "req_01HQ",
						sequence: 3,
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
				"https://app-api.internal/api/chat/requests/req_01HQ/events/stream?after_sequence=2",
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
					status: "canceled",
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
			new Request("https://app-api.internal/api/chat/requests/req_01HQ/cancel", {
				body: JSON.stringify({ reason: "user_requested" }),
				headers: {
					"content-type": "application/json",
				},
				method: "POST",
			}),
		);

		expect(response.status).toBe(202);
		const responseBody = await response.json();
		expect(responseBody).toEqual({
			run: {
				conversationId: "conv_01HQ",
				phase: "canceled",
				requestId: "req_01HQ",
				status: "canceled",
			},
		});
		expect(runtimeRunService.cancel).toHaveBeenCalledWith({
			principal: expect.objectContaining({
				actor: expect.objectContaining({ userId: "user_01HQ" }),
			}),
			reason: "user_requested",
			requestId: "req_01HQ",
		});
	});

	it("returns a typed conflict when cancellation loses to a terminal product run", async () => {
		const runtimeRunService = {
			cancel: vi.fn().mockRejectedValue(
				new AppApiRouteError({
					code: "request_already_terminal",
					message: "Request is already terminal.",
					retryable: false,
					status: 409,
				}),
			),
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
			new Request("https://app-api.internal/api/chat/requests/req_01HQ/cancel", {
				body: JSON.stringify({ reason: "user_requested" }),
				headers: { "content-type": "application/json" },
				method: "POST",
			}),
		);

		expect(response.status).toBe(409);
		await expect(response.json()).resolves.toMatchObject({
			error: {
				code: "request_already_terminal",
				message: "Request is already terminal.",
				retryable: false,
			},
		});
	});

	it("rejects unsupported run cancel reason codes", async () => {
		const runtimeRunService = {
			cancel: vi.fn(),
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
			new Request("https://app-api.internal/api/chat/requests/req_01HQ/cancel", {
				body: JSON.stringify({ reason: "stop because this text must not enter audit" }),
				headers: {
					"content-type": "application/json",
				},
				method: "POST",
			}),
		);

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toMatchObject({
			error: {
				code: "invalid_request",
				message: "reason must be user_requested.",
				retryable: false,
			},
		});
		expect(runtimeRunService.cancel).not.toHaveBeenCalled();
	});

	it("maps run ownership misses to the shared not-found envelope", async () => {
		const runtimeRunService = {
			cancel: vi.fn(),
			getStatus: vi.fn().mockRejectedValue(
				new AppApiRouteError({
					code: "request_not_found",
					message: "Request not found.",
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
			new Request("https://app-api.internal/api/chat/requests/req_other", {
				method: "GET",
			}),
		);

		expect(response.status).toBe(404);
		await expect(response.json()).resolves.toMatchObject({
			error: {
				code: "request_not_found",
				message: "Request not found.",
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
				"https://app-api.internal/api/chat/requests/req_01HQ/events/stream?after_sequence=0",
				{
					method: "GET",
				},
			),
		);

		expect(response.status).toBe(502);
		await expect(response.json()).resolves.toMatchObject({
			error: {
				code: "execution_control_invalid_response",
				message: "The request could not be completed.",
				retryable: true,
			},
		});
	});

	it("returns the fixed browser-safe run step projection for the current principal owned run", async () => {
		const runtimeRunService = {
			cancel: vi.fn(),
			getStatus: vi.fn(),
			listEvents: vi.fn(),
			listSteps: vi.fn().mockResolvedValue({
				run: {
					acceptedAt: "2026-06-04T01:02:03.000Z",
					completedAt: "2026-06-04T01:02:06.000Z",
					conversationId: "conv_01HQ",
					durationMs: 3_000,
					phase: "completed",
					requestId: "req_01HQ",
					startedAt: "2026-06-04T01:02:04.000Z",
					status: "completed",
				},
				steps: [
					{
						completedAt: "2026-06-04T01:02:03.000Z",
						durationMs: 0,
						phase: "queued",
						startedAt: "2026-06-04T01:02:03.000Z",
						status: "completed",
					},
					{
						completedAt: "2026-06-04T01:02:04.000Z",
						durationMs: 1_000,
						phase: "preparing",
						startedAt: "2026-06-04T01:02:03.000Z",
						status: "completed",
					},
					{
						completedAt: "2026-06-04T01:02:05.000Z",
						durationMs: 1_000,
						phase: "generating",
						startedAt: "2026-06-04T01:02:04.000Z",
						status: "completed",
					},
					{
						completedAt: "2026-06-04T01:02:06.000Z",
						durationMs: 1_000,
						phase: "finalizing",
						startedAt: "2026-06-04T01:02:05.000Z",
						status: "completed",
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
			new Request("https://app-api.internal/api/chat/requests/req_01HQ/steps", {
				method: "GET",
			}),
		);

		expect(response.status).toBe(200);
		const responseBody = await response.json();
		expect(responseBody).toEqual({
			run: {
				acceptedAt: "2026-06-04T01:02:03.000Z",
				completedAt: "2026-06-04T01:02:06.000Z",
				conversationId: "conv_01HQ",
				durationMs: 3_000,
				phase: "completed",
				requestId: "req_01HQ",
				startedAt: "2026-06-04T01:02:04.000Z",
				status: "completed",
			},
			steps: [
				expect.objectContaining({ phase: "queued" }),
				expect.objectContaining({ phase: "preparing" }),
				expect.objectContaining({ phase: "generating" }),
				expect.objectContaining({ phase: "finalizing" }),
			],
		});
		expect(responseBody).not.toHaveProperty("attempts");
		expect(responseBody).not.toHaveProperty("results");
		expect(runtimeRunService.listSteps).toHaveBeenCalledWith({
			principal: expect.objectContaining({
				actor: expect.objectContaining({ userId: "user_01HQ" }),
			}),
			requestId: "req_01HQ",
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
