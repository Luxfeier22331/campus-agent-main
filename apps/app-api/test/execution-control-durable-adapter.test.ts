// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
	createExecutionControlPersonalMemoryClient,
	createExecutionControlRuntimeClient,
	isExecutionControlRuntimeConfigured,
} from "../src/modules/integration/execution-control";

const EXECUTION_RUN_METADATA = {
	execution_contract_version: "tool_execution_v7",
	execution_input_ref: "app-api://execution-inputs/req_durable_001",
	execution_input_sha256: "a".repeat(64),
} as const;

function readMockRequestBody(fetchImplementation: ReturnType<typeof vi.fn>, index: number): string {
	const body = fetchImplementation.mock.calls[index]?.[1]?.body;
	if (typeof body !== "string") {
		throw new Error(`Missing request body for call ${index}`);
	}
	return body;
}

function durableRunPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		admitted_at: "",
		completed_at: "",
		conversation_id: "conv_durable_001",
		created_at: "2026-06-04T01:02:03Z",
		fail_close_reason: "",
		final_response_ref: "",
		owner_user_id: "user_001",
		queued_at: "2026-06-04T01:02:03Z",
		request_id: "req_durable_001",
		started_at: "",
		status: "queued",
		streaming_started_at: "",
		surface: "campus-web",
		task_queue: "campus-agent.workflow",
		terminal_reason: "",
		updated_at: "2026-06-04T01:02:04Z",
		...overrides,
	};
}

describe("execution control runtime adapter", () => {
	it("reports execution control configured only with an environment, base URL, and shared secret", () => {
		expect(
			isExecutionControlRuntimeConfigured({
				DEPLOYMENT_ENVIRONMENT: "test",
				EXECUTION_CONTROL_BASE_URL: "https://execution-control.internal",
				APP_API_EXECUTION_SHARED_SECRET: "shared-secret",
			}),
		).toBe(true);
		expect(
			isExecutionControlRuntimeConfigured({
				DEPLOYMENT_ENVIRONMENT: "test",
				EXECUTION_CONTROL_BASE_URL: " ",
				APP_API_EXECUTION_SHARED_SECRET: "shared-secret",
			}),
		).toBe(false);
		expect(
			isExecutionControlRuntimeConfigured({
				DEPLOYMENT_ENVIRONMENT: "test",
				EXECUTION_CONTROL_BASE_URL: "https://execution-control.internal",
				APP_API_EXECUTION_SHARED_SECRET: "",
			}),
		).toBe(false);
		expect(
			isExecutionControlRuntimeConfigured({
				DEPLOYMENT_ENVIRONMENT: "test",
				APP_API_EXECUTION_SHARED_SECRET: "shared-secret",
			} as never),
		).toBe(false);
	});

	it("creates execution runs through the internal execution command endpoint", async () => {
		const fetchImplementation = vi.fn().mockResolvedValue(
			new Response(JSON.stringify(durableRunPayload()), {
				status: 202,
			}),
		);
		const client = createExecutionControlRuntimeClient(
			{
				DEPLOYMENT_ENVIRONMENT: "test",
				EXECUTION_CONTROL_BASE_URL: "https://execution-control.internal",
				APP_API_EXECUTION_SHARED_SECRET: "shared-secret",
			},
			{ fetchImplementation },
		);

		const result = await client.createRun({
			conversationId: "conv_durable_001",
			metadata: EXECUTION_RUN_METADATA,
			ownerUserId: "user_001",
			personalMemoryRecallAllowed: false,
			requestId: "req_durable_001",
			runtimeVersions: {
				contract: "durable-agent-runtime-contract-v1",
			},
			surface: "campus-web",
		});

		expect(fetchImplementation).toHaveBeenCalledWith(
			"https://execution-control.internal/internal/execution/requests",
			expect.objectContaining({
				headers: {
					"content-type": "application/json",
					"x-worker-origin-auth": "shared-secret",
				},
				method: "POST",
			}),
		);
		expect(JSON.parse(readMockRequestBody(fetchImplementation, 0))).toEqual({
			conversation_id: "conv_durable_001",
			metadata: EXECUTION_RUN_METADATA,
			owner_user_id: "user_001",
			personal_memory_recall_allowed: false,
			request_id: "req_durable_001",
			runtime_versions: {
				contract: "durable-agent-runtime-contract-v1",
			},
			surface: "campus-web",
		});
		expect(result).toEqual({
			admittedAt: "",
			completedAt: "",
			conversationId: "conv_durable_001",
			createdAt: "2026-06-04T01:02:03Z",
			failCloseReason: "",
			finalResponseRef: "",
			taskQueue: "campus-agent.workflow",
			ownerUserId: "user_001",
			queuedAt: "2026-06-04T01:02:03Z",
			requestId: "req_durable_001",
			startedAt: "",
			status: "queued",
			streamingStartedAt: "",
			surface: "campus-web",
			terminalReason: "",
			updatedAt: "2026-06-04T01:02:04Z",
		});
	});

	it("queries run projection and ordered run events with internal auth", async () => {
		const fetchImplementation = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(JSON.stringify(durableRunPayload({ status: "running" })), { status: 200 }),
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						events: [
							{
								conversation_id: "conv_durable_001",
								event_id: "run_durable_001:run-created",
								event_type: "run.created",
								occurred_at: "2026-06-04T01:02:03Z",
								payload: { status: "created" },
								payload_schema_version: "run-event-v1",
								request_id: "req_durable_001",
								sequence: 1,
								visibility: "internal",
							},
						],
						next_sequence: 1,
					}),
					{ status: 200 },
				),
			);
		const client = createExecutionControlRuntimeClient(
			{
				DEPLOYMENT_ENVIRONMENT: "test",
				EXECUTION_CONTROL_BASE_URL: "https://execution-control.internal",
				APP_API_EXECUTION_SHARED_SECRET: "shared-secret",
			},
			{ fetchImplementation },
		);

		const run = await client.getRun({
			requestId: "req_durable_001",
		});
		const events = await client.listRunEvents({
			requestId: "req_durable_001",
		});

		expect(fetchImplementation).toHaveBeenNthCalledWith(
			1,
			"https://execution-control.internal/internal/execution/requests/req_durable_001",
			expect.objectContaining({
				headers: {
					"content-type": "application/json",
					"x-worker-origin-auth": "shared-secret",
				},
				method: "GET",
			}),
		);
		expect(fetchImplementation).toHaveBeenNthCalledWith(
			2,
			"https://execution-control.internal/internal/execution/requests/req_durable_001/events",
			expect.objectContaining({
				headers: {
					"content-type": "application/json",
					"x-worker-origin-auth": "shared-secret",
				},
				method: "GET",
			}),
		);
		expect(run.status).toBe("running");
		expect(events).toEqual({
			events: [
				{
					conversationId: "conv_durable_001",
					eventId: "run_durable_001:run-created",
					eventType: "run.created",
					occurredAt: "2026-06-04T01:02:03Z",
					payload: { status: "created" },
					payloadSchemaVersion: "run-event-v1",
					requestId: "req_durable_001",
					sequence: 1,
					visibility: "internal",
				},
			],
			nextSequence: 1,
		});
	});

	it("passes durable run event sequence cursor to execution-control events query", async () => {
		const fetchImplementation = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ events: [], next_sequence: 7 }), {
				status: 200,
			}),
		);
		const client = createExecutionControlRuntimeClient(
			{
				DEPLOYMENT_ENVIRONMENT: "test",
				EXECUTION_CONTROL_BASE_URL: "https://execution-control.internal",
				APP_API_EXECUTION_SHARED_SECRET: "shared-secret",
			},
			{ fetchImplementation },
		);

		await client.listRunEvents({
			afterSequence: 7,
			requestId: "req_durable_001",
		});

		expect(fetchImplementation).toHaveBeenCalledWith(
			"https://execution-control.internal/internal/execution/requests/req_durable_001/events?after_sequence=7",
			expect.objectContaining({
				method: "GET",
			}),
		);
	});

	it("passes bounded wait budget to execution-control events query", async () => {
		const fetchImplementation = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ events: [], next_sequence: 7 }), {
				status: 200,
			}),
		);
		const client = createExecutionControlRuntimeClient(
			{
				DEPLOYMENT_ENVIRONMENT: "test",
				EXECUTION_CONTROL_BASE_URL: "https://execution-control.internal",
				APP_API_EXECUTION_SHARED_SECRET: "shared-secret",
			},
			{ fetchImplementation },
		);

		await client.listRunEvents({
			afterSequence: 7,
			requestId: "req_durable_001",
			waitMs: 25_000,
		});

		expect(fetchImplementation).toHaveBeenCalledWith(
			"https://execution-control.internal/internal/execution/requests/req_durable_001/events?after_sequence=7&wait_ms=25000",
			expect.objectContaining({
				method: "GET",
			}),
		);
	});

	it("preserves external cancellation as AbortError", async () => {
		let upstreamSignal: AbortSignal | null | undefined;
		const fetchImplementation = vi.fn(
			(_request: RequestInfo | URL, init?: RequestInit) =>
				new Promise<Response>((_resolve, reject) => {
					upstreamSignal = init?.signal;
					upstreamSignal?.addEventListener(
						"abort",
						() => reject(new DOMException("The operation was aborted.", "AbortError")),
						{ once: true },
					);
				}),
		);
		const client = createExecutionControlRuntimeClient(
			{
				DEPLOYMENT_ENVIRONMENT: "test",
				EXECUTION_CONTROL_BASE_URL: "https://execution-control.internal",
				APP_API_EXECUTION_SHARED_SECRET: "shared-secret",
			},
			{ fetchImplementation },
		);
		const controller = new AbortController();

		const request = client.listRunEvents({
			requestId: "req_durable_001",
			signal: controller.signal,
			waitMs: 25_000,
		});
		controller.abort();

		await expect(request).rejects.toMatchObject({ name: "AbortError" });
		expect(upstreamSignal?.aborted).toBe(true);
	});

	it("maps only the requester timeout to execution_timeout", async () => {
		vi.useFakeTimers();
		const fetchImplementation = vi.fn(
			(_request: RequestInfo | URL, init?: RequestInit) =>
				new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener(
						"abort",
						() => reject(new DOMException("The operation was aborted.", "AbortError")),
						{ once: true },
					);
				}),
		);
		const client = createExecutionControlRuntimeClient(
			{
				DEPLOYMENT_ENVIRONMENT: "test",
				EXECUTION_CONTROL_BASE_URL: "https://execution-control.internal",
				APP_API_EXECUTION_SHARED_SECRET: "shared-secret",
			},
			{ fetchImplementation },
		);

		try {
			const request = client.listRunEvents({ requestId: "req_durable_001" });
			const rejection = expect(request).rejects.toMatchObject({
				code: "execution_timeout",
				status: 504,
			});
			await vi.advanceTimersByTimeAsync(95_000);
			await rejection;
		} finally {
			vi.useRealTimers();
		}
	});

	it("rejects invalid durable run event wait budgets", async () => {
		const client = createExecutionControlRuntimeClient({
			DEPLOYMENT_ENVIRONMENT: "test",
			EXECUTION_CONTROL_BASE_URL: "https://execution-control.internal",
			APP_API_EXECUTION_SHARED_SECRET: "shared-secret",
		});

		await expect(
			client.listRunEvents({
				requestId: "req_durable_001",
				waitMs: -1,
			}),
		).rejects.toThrow("waitMs must be a non-negative integer.");
	});

	it("cancels durable runs through an explicit cancel command", async () => {
		const fetchImplementation = vi.fn().mockResolvedValue(
			new Response(JSON.stringify(durableRunPayload({ status: "canceled" })), {
				status: 202,
			}),
		);
		const client = createExecutionControlRuntimeClient(
			{
				DEPLOYMENT_ENVIRONMENT: "test",
				EXECUTION_CONTROL_BASE_URL: "https://execution-control.internal",
				APP_API_EXECUTION_SHARED_SECRET: "shared-secret",
			},
			{ fetchImplementation },
		);

		const run = await client.cancelRun({
			reason: "user_requested",
			requestId: "req_durable_001",
		});

		expect(fetchImplementation).toHaveBeenCalledWith(
			"https://execution-control.internal/internal/execution/requests/req_durable_001/cancel",
			expect.objectContaining({
				headers: {
					"content-type": "application/json",
					"x-worker-origin-auth": "shared-secret",
				},
				method: "POST",
			}),
		);
		expect(JSON.parse(readMockRequestBody(fetchImplementation, 0))).toEqual({
			reason: "user_requested",
		});
		expect(run.status).toBe("canceled");
	});

	it("sends native memory curation commands through the command endpoint", async () => {
		const fetchImplementation = vi.fn().mockResolvedValueOnce(
			new Response(JSON.stringify({}), {
				status: 202,
			}),
		);
		const client = createExecutionControlPersonalMemoryClient(
			{
				DEPLOYMENT_ENVIRONMENT: "test",
				EXECUTION_CONTROL_BASE_URL: "https://execution-control.internal",
				APP_API_EXECUTION_SHARED_SECRET: "shared-secret",
			},
			{ fetchImplementation },
		);

		await client.admit({
			commandId: "memcmd_01HQ",
			commandKind: "memory_add",
			item: { text: "新的偏好" },
			lifecycleState: "active",
			ownerGeneration: 2,
			ownerSequence: 7,
			ownerUserId: "user_01HQ",
			schemaVersion: "personal_memory_command.v3",
			sourceUpdatedAt: "2026-06-10T08:00:00.000Z",
			status: "pending_admission",
			subjectId: "fact_01",
			supersessionScope: "memory:fact_01",
		});
		expect(fetchImplementation).toHaveBeenCalledWith(
			"https://execution-control.internal/internal/memory/personal/commands",
			expect.objectContaining({
				headers: expect.objectContaining({ "x-worker-origin-auth": "shared-secret" }),
				method: "POST",
			}),
		);
		expect(JSON.parse(readMockRequestBody(fetchImplementation, 0))).toEqual({
			command_id: "memcmd_01HQ",
			command_kind: "memory_add",
			item: { text: "新的偏好" },
			lifecycle_state: "active",
			owner_generation: 2,
			owner_sequence: 7,
			schema_version: "personal_memory_command.v3",
			source_updated_at: "2026-06-10T08:00:00.000Z",
			subject_id: "fact_01",
			supersession_scope: "memory:fact_01",
			tenant_id: "tenant-main",
			user_id: "user_01HQ",
		});
	});

	it("reads native memory command receipts for admitted-command recovery", async () => {
		const fetchImplementation = vi.fn().mockResolvedValueOnce(
			new Response(
				JSON.stringify({
					command_id: "memcmd_01HQ",
					error_code: "",
					generation: 2,
					kind: "memory_add",
					result_fingerprint: "a".repeat(64),
					sequence: 7,
					stale: false,
					status: "succeeded",
				}),
				{ status: 200 },
			),
		);
		const client = createExecutionControlPersonalMemoryClient(
			{
				DEPLOYMENT_ENVIRONMENT: "test",
				EXECUTION_CONTROL_BASE_URL: "https://execution-control.internal",
				APP_API_EXECUTION_SHARED_SECRET: "shared-secret",
			},
			{ fetchImplementation },
		);

		await expect(
			client.getCommandStatus({ commandId: "memcmd_01HQ", ownerUserId: "user_01HQ" }),
		).resolves.toMatchObject({ commandId: "memcmd_01HQ", status: "succeeded" });
		expect(fetchImplementation).toHaveBeenCalledWith(
			"https://execution-control.internal/internal/memory/personal/commands/status",
			expect.objectContaining({ method: "POST" }),
		);
		expect(JSON.parse(readMockRequestBody(fetchImplementation, 0))).toEqual({
			command_id: "memcmd_01HQ",
			tenant_id: "tenant-main",
			user_id: "user_01HQ",
		});
	});

	it("fails closed when durable runtime configuration is missing", async () => {
		const client = createExecutionControlRuntimeClient({ DEPLOYMENT_ENVIRONMENT: "test" });

		await expect(
			client.getRun({
				requestId: "req_durable_001",
			}),
		).rejects.toMatchObject({
			code: "dependency_not_ready",
			retryable: true,
			status: 503,
		});
	});

	it("maps durable execution-control error envelopes without widening them", async () => {
		const fetchImplementation = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					error: {
						code: "conversation_active_run",
						message: "Conversation already has an active primary run.",
						retryable: true,
					},
				}),
				{ status: 409 },
			),
		);
		const client = createExecutionControlRuntimeClient(
			{
				DEPLOYMENT_ENVIRONMENT: "test",
				EXECUTION_CONTROL_BASE_URL: "https://execution-control.internal",
				APP_API_EXECUTION_SHARED_SECRET: "shared-secret",
			},
			{ fetchImplementation },
		);

		await expect(
			client.createRun({
				conversationId: "conv_durable_001",
				metadata: EXECUTION_RUN_METADATA,
				ownerUserId: "user_001",
				personalMemoryRecallAllowed: false,
				requestId: "req_durable_001",
				surface: "campus-web",
			}),
		).rejects.toMatchObject({
			code: "conversation_active_run",
			message: "Execution-control request failed.",
			retryable: true,
			status: 409,
		});
	});

	it("rejects invalid durable run projections from execution-control", async () => {
		const fetchImplementation = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					request_id: "req_durable_001",
					status: "queued",
				}),
				{ status: 202 },
			),
		);
		const client = createExecutionControlRuntimeClient(
			{
				DEPLOYMENT_ENVIRONMENT: "test",
				EXECUTION_CONTROL_BASE_URL: "https://execution-control.internal",
				APP_API_EXECUTION_SHARED_SECRET: "shared-secret",
			},
			{ fetchImplementation },
		);

		await expect(
			client.createRun({
				conversationId: "conv_durable_001",
				metadata: EXECUTION_RUN_METADATA,
				ownerUserId: "user_001",
				personalMemoryRecallAllowed: false,
				requestId: "req_durable_001",
				surface: "campus-web",
			}),
		).rejects.toMatchObject({
			code: "execution_control_invalid_response",
			retryable: true,
			status: 502,
		});
	});
});
