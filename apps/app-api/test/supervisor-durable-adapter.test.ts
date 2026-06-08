// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
	createExecutionControlRuntimeClient,
	isExecutionControlRuntimeConfigured,
} from "../src/modules/integration/execution-control";

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
		lane: "rag",
		owner_user_id: "user_001",
		request_id: "req_durable_001",
		requested_capability: "knowledge",
		run_id: "run_durable_001",
		selected_capability: "knowledge",
		started_at: "",
		status: "queued",
		streaming_started_at: "",
		surface: "public-chat-web",
		terminal_reason: "",
		trace_id: "trace_durable_001",
		turn_id: "turn_durable_001",
		updated_at: "2026-06-04T01:02:04Z",
		workflow_plan_ref: "",
		...overrides,
	};
}

describe("execution control runtime adapter", () => {
	it("reports execution control configured only when new base URL and shared secret are present", () => {
		expect(
			isExecutionControlRuntimeConfigured({
				EXECUTION_CONTROL_BASE_URL: "https://execution-control.internal",
				EXECUTION_CONTROL_SHARED_SECRET: "shared-secret",
			}),
		).toBe(true);
		expect(
			isExecutionControlRuntimeConfigured({
				EXECUTION_CONTROL_BASE_URL: " ",
				EXECUTION_CONTROL_SHARED_SECRET: "shared-secret",
			}),
		).toBe(false);
		expect(
			isExecutionControlRuntimeConfigured({
				EXECUTION_CONTROL_BASE_URL: "https://execution-control.internal",
				EXECUTION_CONTROL_SHARED_SECRET: "",
			}),
		).toBe(false);
		expect(
			isExecutionControlRuntimeConfigured({
				APP_API_INTERNAL_SHARED_SECRET: "shared-secret",
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
				EXECUTION_CONTROL_BASE_URL: "https://execution-control.internal",
				EXECUTION_CONTROL_SHARED_SECRET: "shared-secret",
			},
			{ fetchImplementation },
		);

		const result = await client.createRun({
			conversationId: "conv_durable_001",
			lane: "rag",
			metadata: {
				execution_payload: {
					conversation_id: "conv_durable_001",
					request_id: "req_durable_001",
					user_goal: "奖学金怎么评？",
				},
			},
			ownerUserId: "user_001",
			requestId: "req_durable_001",
			requestedCapability: "knowledge",
			runId: "run_durable_001",
			runtimeVersions: {
				contract: "durable-agent-runtime-contract-v1",
			},
			selectedCapability: "knowledge",
			surface: "public-chat-web",
			traceId: "trace_durable_001",
			turnId: "turn_durable_001",
		});

		expect(fetchImplementation).toHaveBeenCalledWith(
			"https://execution-control.internal/internal/execution/runs",
			expect.objectContaining({
				headers: {
					"content-type": "application/json",
					"x-trace-id": "trace_durable_001",
					"x-worker-origin-auth": "shared-secret",
				},
				method: "POST",
			}),
		);
		expect(JSON.parse(readMockRequestBody(fetchImplementation, 0))).toEqual({
			conversation_id: "conv_durable_001",
			lane: "rag",
			metadata: {
				execution_payload: {
					conversation_id: "conv_durable_001",
					request_id: "req_durable_001",
					user_goal: "奖学金怎么评？",
				},
			},
			owner_user_id: "user_001",
			request_id: "req_durable_001",
			requested_capability: "knowledge",
			run_id: "run_durable_001",
			runtime_versions: {
				contract: "durable-agent-runtime-contract-v1",
			},
			selected_capability: "knowledge",
			surface: "public-chat-web",
			trace_id: "trace_durable_001",
			turn_id: "turn_durable_001",
		});
		expect(result).toEqual({
			admittedAt: "",
			completedAt: "",
			conversationId: "conv_durable_001",
			createdAt: "2026-06-04T01:02:03Z",
			failCloseReason: "",
			finalResponseRef: "",
			lane: "rag",
			ownerUserId: "user_001",
			requestId: "req_durable_001",
			requestedCapability: "knowledge",
			runId: "run_durable_001",
			selectedCapability: "knowledge",
			startedAt: "",
			status: "queued",
			streamingStartedAt: "",
			surface: "public-chat-web",
			terminalReason: "",
			traceId: "trace_durable_001",
			turnId: "turn_durable_001",
			updatedAt: "2026-06-04T01:02:04Z",
			workflowPlanRef: "",
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
								run_id: "run_durable_001",
								sequence: 1,
								visibility: "internal",
							},
						],
					}),
					{ status: 200 },
				),
			);
		const client = createExecutionControlRuntimeClient(
			{
				EXECUTION_CONTROL_BASE_URL: "https://execution-control.internal",
				EXECUTION_CONTROL_SHARED_SECRET: "shared-secret",
			},
			{ fetchImplementation },
		);

		const run = await client.getRun({
			runId: "run_durable_001",
			traceId: "trace_query_001",
		});
		const events = await client.listRunEvents({
			runId: "run_durable_001",
			traceId: "trace_query_001",
		});

		expect(fetchImplementation).toHaveBeenNthCalledWith(
			1,
			"https://execution-control.internal/internal/execution/runs/run_durable_001",
			expect.objectContaining({
				headers: {
					"content-type": "application/json",
					"x-trace-id": "trace_query_001",
					"x-worker-origin-auth": "shared-secret",
				},
				method: "GET",
			}),
		);
		expect(fetchImplementation).toHaveBeenNthCalledWith(
			2,
			"https://execution-control.internal/internal/execution/runs/run_durable_001/events",
			expect.objectContaining({
				headers: {
					"content-type": "application/json",
					"x-trace-id": "trace_query_001",
					"x-worker-origin-auth": "shared-secret",
				},
				method: "GET",
			}),
		);
		expect(run.status).toBe("running");
		expect(events).toEqual([
			{
				conversationId: "conv_durable_001",
				eventId: "run_durable_001:run-created",
				eventType: "run.created",
				occurredAt: "2026-06-04T01:02:03Z",
				payload: { status: "created" },
				payloadSchemaVersion: "run-event-v1",
				runId: "run_durable_001",
				sequence: 1,
				visibility: "internal",
			},
		]);
	});

	it("passes durable run event sequence cursor to supervisor events query", async () => {
		const fetchImplementation = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ events: [] }), {
				status: 200,
			}),
		);
		const client = createExecutionControlRuntimeClient(
			{
				EXECUTION_CONTROL_BASE_URL: "https://execution-control.internal",
				EXECUTION_CONTROL_SHARED_SECRET: "shared-secret",
			},
			{ fetchImplementation },
		);

		await client.listRunEvents({
			afterSequence: 7,
			runId: "run_durable_001",
			traceId: "trace_query_001",
		});

		expect(fetchImplementation).toHaveBeenCalledWith(
			"https://execution-control.internal/internal/execution/runs/run_durable_001/events?after_sequence=7",
			expect.objectContaining({
				method: "GET",
			}),
		);
	});

	it("cancels durable runs through an explicit cancel command", async () => {
		const fetchImplementation = vi.fn().mockResolvedValue(
			new Response(JSON.stringify(durableRunPayload({ status: "canceled" })), {
				status: 202,
			}),
		);
		const client = createExecutionControlRuntimeClient(
			{
				EXECUTION_CONTROL_BASE_URL: "https://execution-control.internal",
				EXECUTION_CONTROL_SHARED_SECRET: "shared-secret",
			},
			{ fetchImplementation },
		);

		const run = await client.cancelRun({
			reason: "user_requested",
			runId: "run_durable_001",
			traceId: "trace_cancel_001",
		});

		expect(fetchImplementation).toHaveBeenCalledWith(
			"https://execution-control.internal/internal/execution/runs/run_durable_001/cancel",
			expect.objectContaining({
				headers: {
					"content-type": "application/json",
					"x-trace-id": "trace_cancel_001",
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

	it("fails closed when durable runtime configuration is missing", async () => {
		const client = createExecutionControlRuntimeClient({});

		await expect(
			client.getRun({
				runId: "run_durable_001",
				traceId: "trace_query_001",
			}),
		).rejects.toMatchObject({
			code: "dependency_not_ready",
			retryable: true,
			status: 503,
		});
	});

	it("maps durable supervisor error envelopes without widening them", async () => {
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
				EXECUTION_CONTROL_BASE_URL: "https://execution-control.internal",
				EXECUTION_CONTROL_SHARED_SECRET: "shared-secret",
			},
			{ fetchImplementation },
		);

		await expect(
			client.createRun({
				conversationId: "conv_durable_001",
				lane: "rag",
				metadata: { execution_payload: {}, handoff: {} },
				ownerUserId: "user_001",
				requestId: "req_durable_001",
				runId: "run_durable_001",
				surface: "public-chat-web",
				turnId: "turn_durable_001",
			}),
		).rejects.toMatchObject({
			code: "conversation_active_run",
			message: "Conversation already has an active primary run.",
			retryable: true,
			status: 409,
		});
	});

	it("rejects invalid durable run projections from supervisor", async () => {
		const fetchImplementation = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					run_id: "run_durable_001",
					status: "queued",
				}),
				{ status: 202 },
			),
		);
		const client = createExecutionControlRuntimeClient(
			{
				EXECUTION_CONTROL_BASE_URL: "https://execution-control.internal",
				EXECUTION_CONTROL_SHARED_SECRET: "shared-secret",
			},
			{ fetchImplementation },
		);

		await expect(
			client.createRun({
				conversationId: "conv_durable_001",
				lane: "rag",
				metadata: { execution_payload: {}, handoff: {} },
				ownerUserId: "user_001",
				requestId: "req_durable_001",
				runId: "run_durable_001",
				surface: "public-chat-web",
				turnId: "turn_durable_001",
			}),
		).rejects.toMatchObject({
			code: "execution_control_invalid_response",
			retryable: true,
			status: 502,
		});
	});
});
