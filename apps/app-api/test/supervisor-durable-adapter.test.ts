// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
	createExecutionControlPersonalMemoryClient,
	createExecutionControlProviderConfigClient,
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

function durableRunStepsPayload(
	attemptOverrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		attempts: [
			{
				activity_attempt: 1,
				activity_id: "activity-planning-1",
				activity_type: "PlanRouteActivity",
				attempt: 1,
				attempt_id: "plan.route:attempt:1",
				cached_input_tokens: 10,
				cancel_outcome: "not_requested",
				completed_at: "2026-06-04T01:02:04.100Z",
				duration_ms: 100,
				estimated_cost_microusd: 321,
				fail_close_reason: "current_state_unverifiable",
				input_tokens: 120,
				late_completion_outcome: "ignored_after_timeout",
				model_name: "gpt-5-mini",
				model_provider: "openai",
				output_tokens: 42,
				payload_schema_version: "step-attempt-projection-v1",
				pricing_version: "provider-pricing-v1",
				provider_request_ref: "provider://requests/req_001",
				provider_response_id: "resp_001",
				replan_reason: "bounded_replan_after_provider_timeout",
				run_id: "run_durable_001",
				sanitized_payload: {},
				schedule_to_start_ms: 25,
				scheduled_at: "2026-06-04T01:02:03.975Z",
				started_at: "2026-06-04T01:02:04.000Z",
				status: "completed",
				step_id: "plan.route",
				task_queue: "campus-agent.activity.context",
				temporal_run_id: "temporal-run-001",
				terminal_reason: "answer_completed",
				timeout_outcome: "not_timed_out",
				updated_at: "2026-06-04T01:02:04.100Z",
				worker_id: "staging:context:worker-1",
				workflow_id: "campus-agent.chat.run_durable_001",
				...attemptOverrides,
			},
		],
		results: [],
		steps: [
			{
				capability: "knowledge",
				completed_at: "2026-06-04T01:02:04.100Z",
				conversation_id: "conv_durable_001",
				parent_step_id: "",
				payload_schema_version: "run-step-projection-v1",
				run_id: "run_durable_001",
				sanitized_payload: {},
				started_at: "2026-06-04T01:02:04.000Z",
				status: "completed",
				step_id: "plan.route",
				step_kind: "planning",
				task_queue: "campus-agent.activity.context",
				updated_at: "2026-06-04T01:02:04.100Z",
				worker_id: "staging:context:worker-1",
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

	it("passes bounded wait budget to supervisor events query", async () => {
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
				replanReason: "bounded_replan_after_provider_timeout",
			}),
		);
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

	it("indexes explicit profile memory through execution-control personal memory command endpoints", async () => {
		const fetchImplementation = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						episode_uuid: "episode_01HQ",
						memory_id: "mem_01HQ",
						payload_sha256: "hash-upsert",
						schema_version: "memory_profile_item_result_v1",
						status: "active",
						updated_at: "2026-06-10T08:00:00.000Z",
						user_id: "user_01HQ",
					}),
					{ status: 202 },
				),
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						episode_uuid: "episode_01HQ",
						memory_id: "mem_01HQ",
						payload_sha256: "hash-disable",
						schema_version: "memory_profile_item_result_v1",
						status: "disabled",
						updated_at: "2026-06-10T09:00:00.000Z",
						user_id: "user_01HQ",
					}),
					{ status: 202 },
				),
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						status: "disabled",
						updated_at: "2026-06-10T10:00:00.000Z",
						user_id: "user_01HQ",
					}),
					{ status: 202 },
				),
			);
		const client = createExecutionControlPersonalMemoryClient(
			{
				EXECUTION_CONTROL_BASE_URL: "https://execution-control.internal",
				EXECUTION_CONTROL_SHARED_SECRET: "shared-secret",
			},
			{ fetchImplementation },
		);

		const upsert = await client.upsertExplicitMemory({
			canonicalSubject: "answer_style",
			compactText: "answer_style: 先给结论",
			memoryId: "mem_01HQ",
			traceId: "trace_memory_001",
			updatedAt: "2026-06-10T08:00:00.000Z",
			userId: "user_01HQ",
		});
		const disabled = await client.disableExplicitMemory({
			episodeUUID: "episode_01HQ",
			memoryId: "mem_01HQ",
			traceId: "trace_memory_002",
			updatedAt: "2026-06-10T09:00:00.000Z",
			userId: "user_01HQ",
		});
		const ownerDisabled = await client.disableOwnerMemory({
			traceId: "trace_memory_003",
			updatedAt: "2026-06-10T10:00:00.000Z",
			userId: "user_01HQ",
		});

		expect(fetchImplementation).toHaveBeenNthCalledWith(
			1,
			"https://execution-control.internal/internal/memory/personal/items:upsert",
			expect.objectContaining({
				headers: expect.objectContaining({
					"x-trace-id": "trace_memory_001",
					"x-worker-origin-auth": "shared-secret",
				}),
				method: "POST",
			}),
		);
		expect(JSON.parse(readMockRequestBody(fetchImplementation, 0))).toEqual({
			canonical_subject: "answer_style",
			compact_text: "answer_style: 先给结论",
			memory_id: "mem_01HQ",
			tenant_id: "tenant-main",
			updated_at: "2026-06-10T08:00:00.000Z",
			user_id: "user_01HQ",
		});
		expect(fetchImplementation).toHaveBeenNthCalledWith(
			2,
			"https://execution-control.internal/internal/memory/personal/items:disable",
			expect.objectContaining({
				headers: expect.objectContaining({
					"x-trace-id": "trace_memory_002",
					"x-worker-origin-auth": "shared-secret",
				}),
				method: "POST",
			}),
		);
		expect(JSON.parse(readMockRequestBody(fetchImplementation, 1))).toEqual({
			episode_uuid: "episode_01HQ",
			memory_id: "mem_01HQ",
			tenant_id: "tenant-main",
			updated_at: "2026-06-10T09:00:00.000Z",
			user_id: "user_01HQ",
		});
		expect(fetchImplementation).toHaveBeenNthCalledWith(
			3,
			"https://execution-control.internal/internal/memory/personal/owner:disable",
			expect.objectContaining({
				headers: expect.objectContaining({
					"x-trace-id": "trace_memory_003",
					"x-worker-origin-auth": "shared-secret",
				}),
				method: "POST",
			}),
		);
		expect(JSON.parse(readMockRequestBody(fetchImplementation, 2))).toEqual({
			tenant_id: "tenant-main",
			updated_at: "2026-06-10T10:00:00.000Z",
			user_id: "user_01HQ",
		});
		expect(upsert).toEqual({
			episodeUUID: "episode_01HQ",
			memoryId: "mem_01HQ",
			schemaVersion: "memory_profile_item_result_v1",
			status: "active",
			updatedAt: "2026-06-10T08:00:00.000Z",
		});
		expect(disabled.status).toBe("disabled");
		expect(ownerDisabled).toEqual({
			status: "disabled",
			updatedAt: "2026-06-10T10:00:00.000Z",
			userId: "user_01HQ",
		});
	});

	it("checks embedding provider compatibility without forwarding provider API keys", async () => {
		const fetchImplementation = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ ok: true, reason: "" }), {
				status: 200,
			}),
		);
		const client = createExecutionControlProviderConfigClient(
			{
				EXECUTION_CONTROL_BASE_URL: "https://execution-control.internal",
				EXECUTION_CONTROL_SHARED_SECRET: "shared-secret",
			},
			{ fetchImplementation },
		);

		const result = await client.checkEmbeddingCompatibility({
			baseUrl: "https://embedding.example/v1",
			dimensions: 2560,
			model: "embedding-model",
			provider: "openai",
			role: "rag_query_embedding",
			timeoutMs: 30000,
			transport: "embeddings",
		});

		expect(fetchImplementation).toHaveBeenCalledWith(
			"https://execution-control.internal/internal/provider-config/embedding:check-compatibility",
			expect.objectContaining({
				headers: expect.objectContaining({
					"x-worker-origin-auth": "shared-secret",
				}),
				method: "POST",
			}),
		);
		const body = JSON.parse(readMockRequestBody(fetchImplementation, 0));
		expect(body).toEqual({
			base_url: "https://embedding.example/v1",
			dimensions: 2560,
			model: "embedding-model",
			provider: "openai",
			role: "rag_query_embedding",
			timeout_ms: 30000,
			transport: "embeddings",
		});
		expect(JSON.stringify(body)).not.toContain("api_key");
		expect(result).toEqual({ ok: true, reason: "" });
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
