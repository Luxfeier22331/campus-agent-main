// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
	createExecutionControlPersonalMemoryClient,
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
		owner_user_id: "user_001",
		queued_at: "2026-06-04T01:02:03Z",
		request_id: "req_durable_001",
		requested_tool: "knowledge_query",
		run_id: "run_durable_001",
		selected_tool: "knowledge_query",
		started_at: "",
		status: "queued",
		streaming_started_at: "",
		surface: "campus-web",
		task_queue: "campus-agent.workflow",
		terminal_reason: "",
		trace_id: "trace_durable_001",
		turn_id: "turn_durable_001",
		updated_at: "2026-06-04T01:02:04Z",
		...overrides,
	};
}

function durableRunStepsPayload(
	attemptOverrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		agent_runtime_eval_projection: {
			schema_version: "agent_runtime_eval_projection.v1",
			run: {
				run_id: "run_durable_001",
				request_id: "req_durable_001",
				trace_id: "trace_durable_001",
				status: "completed",
			},
			trajectory: {
				selected_tool: "knowledge_query",
			},
		},
		attempts: [
			{
				activity_attempt: 1,
				activity_id: "activity-agent-1",
				activity_type: "ExecutePrimaryAgentActivity",
				attempt: 1,
				attempt_id: "agent.primary:attempt:1",
				cached_input_tokens: 10,
				cancel_outcome: "not_requested",
				completed_at: "2026-06-04T01:02:04.100Z",
				duration_ms: 100,
				fail_close_reason: "current_state_unverifiable",
				input_tokens: 120,
				late_completion_outcome: "ignored_after_timeout",
				model_name: "gpt-5-mini",
				model_provider: "openai",
				output_tokens: 42,
				payload_schema_version: "step-attempt-projection-v1",
				provider_request_ref: "provider://requests/req_001",
				provider_response_id: "resp_001",
				run_id: "run_durable_001",
				sanitized_payload: {},
				schedule_to_start_ms: 25,
				scheduled_at: "2026-06-04T01:02:03.975Z",
				started_at: "2026-06-04T01:02:04.000Z",
				status: "completed",
				step_id: "agent.primary",
				task_queue: "campus-agent.activity.agent",
				temporal_run_id: "temporal-run-001",
				terminal_reason: "answer_completed",
				timeout_outcome: "not_timed_out",
				updated_at: "2026-06-04T01:02:04.100Z",
				worker_id: "staging:agent:worker-1",
				workflow_id: "campus-agent.chat.run_durable_001",
				...attemptOverrides,
			},
		],
		results: [],
		steps: [
			{
				tool: "knowledge_query",
				completed_at: "2026-06-04T01:02:04.100Z",
				conversation_id: "conv_durable_001",
				parent_step_id: "",
				payload_schema_version: "run-step-projection-v1",
				run_id: "run_durable_001",
				sanitized_payload: {},
				started_at: "2026-06-04T01:02:04.000Z",
				status: "completed",
				step_id: "agent.primary",
				step_kind: "agent",
				task_queue: "campus-agent.activity.agent",
				updated_at: "2026-06-04T01:02:04.100Z",
				worker_id: "staging:agent:worker-1",
			},
		],
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
				APP_API_PRODUCT_CALLBACK_SHARED_SECRET: "shared-secret",
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
			metadata: {
				execution_payload: {
					conversation_id: "conv_durable_001",
					request_id: "req_durable_001",
					user_goal: "奖学金怎么评？",
				},
			},
			ownerUserId: "user_001",
			requestId: "req_durable_001",
			runId: "run_durable_001",
			runtimeVersions: {
				contract: "durable-agent-runtime-contract-v1",
			},
			surface: "campus-web",
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
			metadata: {
				execution_payload: {
					conversation_id: "conv_durable_001",
					request_id: "req_durable_001",
					user_goal: "奖学金怎么评？",
				},
			},
			owner_user_id: "user_001",
			request_id: "req_durable_001",
			run_id: "run_durable_001",
			runtime_versions: {
				contract: "durable-agent-runtime-contract-v1",
			},
			surface: "campus-web",
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
			taskQueue: "campus-agent.workflow",
			ownerUserId: "user_001",
			queuedAt: "2026-06-04T01:02:03Z",
			requestId: "req_durable_001",
			requestedTool: "knowledge_query",
			runId: "run_durable_001",
			selectedTool: "knowledge_query",
			startedAt: "",
			status: "queued",
			streamingStartedAt: "",
			surface: "campus-web",
			terminalReason: "",
			traceId: "trace_durable_001",
			turnId: "turn_durable_001",
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

	it("passes durable run event sequence cursor to execution-control events query", async () => {
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

	it("passes bounded wait budget to execution-control events query", async () => {
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
			waitMs: 25_000,
		});

		expect(fetchImplementation).toHaveBeenCalledWith(
			"https://execution-control.internal/internal/execution/runs/run_durable_001/events?after_sequence=7&wait_ms=25000",
			expect.objectContaining({
				method: "GET",
			}),
		);
	});

	it("rejects invalid durable run event wait budgets", async () => {
		const client = createExecutionControlRuntimeClient({
			EXECUTION_CONTROL_BASE_URL: "https://execution-control.internal",
			EXECUTION_CONTROL_SHARED_SECRET: "shared-secret",
		});

		await expect(
			client.listRunEvents({
				runId: "run_durable_001",
				waitMs: -1,
			}),
		).rejects.toThrow("waitMs must be a non-negative integer.");
	});

	it("parses durable run step attempt diagnostic spine fields", async () => {
		const fetchImplementation = vi.fn().mockResolvedValue(
			new Response(JSON.stringify(durableRunStepsPayload()), {
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

		const trajectory = await client.listRunSteps({
			runId: "run_durable_001",
			traceId: "trace_query_001",
		});

		expect(trajectory.attempts[0]).toEqual(
			expect.objectContaining({
				failCloseReason: "current_state_unverifiable",
				lateCompletionOutcome: "ignored_after_timeout",
			}),
		);
		expect(trajectory.agentRuntimeEvalProjection).toMatchObject({
			schema_version: "agent_runtime_eval_projection.v1",
			run: {
				run_id: "run_durable_001",
				status: "completed",
			},
			trajectory: {
				selected_tool: "knowledge_query",
			},
		});
	});

	it("rejects durable run step attempts missing diagnostic spine fields", async () => {
		const attemptWithoutLateOutcome = durableRunStepsPayload();
		delete (attemptWithoutLateOutcome.attempts as Record<string, unknown>[])[0]
			.late_completion_outcome;
		const fetchImplementation = vi.fn().mockResolvedValue(
			new Response(JSON.stringify(attemptWithoutLateOutcome), {
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

		await expect(
			client.listRunSteps({
				runId: "run_durable_001",
				traceId: "trace_query_001",
			}),
		).rejects.toMatchObject({
			code: "execution_control_invalid_response",
			retryable: true,
			status: 502,
		});
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

	it("sends source-document deletion commands through the command endpoint", async () => {
		const fetchImplementation = vi.fn().mockResolvedValueOnce(
			new Response(JSON.stringify({ workflow_id: "campus-agent.memory.command.memcmd_01HQ" }), {
				status: 202,
			}),
		);
		const client = createExecutionControlPersonalMemoryClient(
			{
				EXECUTION_CONTROL_BASE_URL: "https://execution-control.internal",
				EXECUTION_CONTROL_SHARED_SECRET: "shared-secret",
			},
			{ fetchImplementation },
		);

		const result = await client.admit({
			commandId: "memcmd_01HQ",
			commandKind: "conversation_prune",
			item: null,
			lifecycleState: "active",
			ownerGeneration: 2,
			ownerSequence: 7,
			ownerUserId: "user_01HQ",
			schemaVersion: "personal_memory_command.v2",
			sourceMessageIds: ["msg_user_01", "msg_user_02"],
			sourceUpdatedAt: "2026-06-10T08:00:00.000Z",
			status: "pending_admission",
			subjectId: "conv_01HQ",
			subjectRevision: null,
			supersessionScope: "source_batch:memcmd_01HQ",
		});
		expect(result.workflowId).toBe("campus-agent.memory.command.memcmd_01HQ");

		expect(fetchImplementation).toHaveBeenCalledWith(
			"https://execution-control.internal/internal/memory/personal/commands",
			expect.objectContaining({
				headers: expect.objectContaining({ "x-worker-origin-auth": "shared-secret" }),
				method: "POST",
			}),
		);
		expect(JSON.parse(readMockRequestBody(fetchImplementation, 0))).toEqual({
			command_id: "memcmd_01HQ",
			command_kind: "conversation_prune",
			item: null,
			lifecycle_state: "active",
			owner_generation: 2,
			owner_sequence: 7,
			schema_version: "personal_memory_command.v2",
			source_message_ids: ["msg_user_01", "msg_user_02"],
			source_updated_at: "2026-06-10T08:00:00.000Z",
			subject_id: "conv_01HQ",
			subject_revision: null,
			supersession_scope: "source_batch:memcmd_01HQ",
			tenant_id: "tenant-main",
			user_id: "user_01HQ",
		});
		expect(result).toEqual({ workflowId: "campus-agent.memory.command.memcmd_01HQ" });
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
				EXECUTION_CONTROL_BASE_URL: "https://execution-control.internal",
				EXECUTION_CONTROL_SHARED_SECRET: "shared-secret",
			},
			{ fetchImplementation },
		);

		await expect(
			client.createRun({
				conversationId: "conv_durable_001",
				metadata: { execution_payload: {} },
				ownerUserId: "user_001",
				requestId: "req_durable_001",
				runId: "run_durable_001",
				surface: "campus-web",
				turnId: "turn_durable_001",
			}),
		).rejects.toMatchObject({
			code: "conversation_active_run",
			message: "Conversation already has an active primary run.",
			retryable: true,
			status: 409,
		});
	});

	it("rejects invalid durable run projections from execution-control", async () => {
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
				metadata: { execution_payload: {} },
				ownerUserId: "user_001",
				requestId: "req_durable_001",
				runId: "run_durable_001",
				surface: "campus-web",
				turnId: "turn_durable_001",
			}),
		).rejects.toMatchObject({
			code: "execution_control_invalid_response",
			retryable: true,
			status: 502,
		});
	});
});
