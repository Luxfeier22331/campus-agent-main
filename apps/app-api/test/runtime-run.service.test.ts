// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import type {
	ExecutionControlRun,
	ExecutionControlRunEvent,
	ExecutionControlRuntimeClient,
} from "../src/modules/integration/execution-control";
import { buildRuntimeRunService, type RuntimeRunEventProjection } from "../src/modules/runtime-run";
import { createPrincipal } from "./chat-command.service.test-support";

function durableRun(overrides: Partial<ExecutionControlRun> = {}): ExecutionControlRun {
	return {
		admittedAt: "",
		completedAt: "",
		conversationId: "conv_01HQ",
		createdAt: "2026-06-04T01:02:03.000Z",
		failCloseReason: "",
		finalResponseRef: "",
		taskQueue: "campus-agent.workflow",
		ownerUserId: "user_01HQ",
		requestId: "req_01HQ",
		requestedTool: "knowledge_query",
		runId: "run_01HQ",
		selectedTool: "knowledge_query",
		startedAt: "",
		status: "running",
		streamingStartedAt: "",
		surface: "campus_web",
		terminalReason: "",
		traceId: "trace_01HQ",
		turnId: "turn_01HQ",
		updatedAt: "2026-06-04T01:02:04.000Z",
		workflowPlanRef: "",
		...overrides,
	};
}

function durableEvent(
	overrides: Partial<ExecutionControlRunEvent> & {
		eventType: string;
		sequence: number;
	},
): ExecutionControlRunEvent {
	const { eventType, sequence, ...rest } = overrides;
	return {
		conversationId: "conv_01HQ",
		eventId: `event-${sequence}`,
		eventType,
		occurredAt: "2026-06-04T01:02:06.000Z",
		payload: {},
		payloadSchemaVersion: "run-event-v1",
		runId: "run_01HQ",
		sequence,
		visibility: "browser",
		...rest,
	};
}

describe("runtime run service", () => {
	it("projects durable run statuses into product runtime phases", async () => {
		const executionRuntime: ExecutionControlRuntimeClient = {
			cancelRun: vi.fn(),
			createRun: vi.fn(),
			getRun: vi.fn().mockResolvedValue(
				durableRun({
					status: "queued",
				}),
			),
			listRunEvents: vi.fn().mockResolvedValue([]),
			listRunSteps: vi.fn().mockResolvedValue({ attempts: [], results: [], steps: [] }),
		};
		const service = buildRuntimeRunService({
			executionRuntime,
			store: {
				getOwnedRun: vi.fn().mockResolvedValue({
					conversationId: "conv_01HQ",
					requestId: "req_01HQ",
					runId: "run_01HQ",
					traceId: "trace_01HQ",
				}),
			},
		});

		await expect(
			service.getStatus({
				principal: createPrincipal(),
				runId: "run_01HQ",
			}),
		).resolves.toEqual({
			run: expect.objectContaining({
				phase: "queued",
				status: "queued",
			}),
		});
	});

	it("rejects unknown durable run statuses instead of guessing a product phase", async () => {
		const executionRuntime: ExecutionControlRuntimeClient = {
			cancelRun: vi.fn(),
			createRun: vi.fn(),
			getRun: vi.fn().mockResolvedValue(
				durableRun({
					status: "mystery",
				}),
			),
			listRunEvents: vi.fn().mockResolvedValue([]),
			listRunSteps: vi.fn().mockResolvedValue({ attempts: [], results: [], steps: [] }),
		};
		const service = buildRuntimeRunService({
			executionRuntime,
			store: {
				getOwnedRun: vi.fn().mockResolvedValue({
					conversationId: "conv_01HQ",
					requestId: "req_01HQ",
					runId: "run_01HQ",
					traceId: "trace_01HQ",
				}),
			},
		});

		await expect(
			service.getStatus({
				principal: createPrincipal(),
				runId: "run_01HQ",
			}),
		).rejects.toThrow("Execution durable run status is not supported.");
	});

	it("rejects listed browser events that do not advance the requested cursor", async () => {
		const executionRuntime: ExecutionControlRuntimeClient = {
			cancelRun: vi.fn(),
			createRun: vi.fn(),
			getRun: vi.fn().mockResolvedValue(durableRun()),
			listRunEvents: vi.fn().mockResolvedValue([
				durableEvent({
					eventType: "run.started",
					sequence: 2,
				}),
			]),
			listRunSteps: vi.fn().mockResolvedValue({ attempts: [], results: [], steps: [] }),
		};
		const service = buildRuntimeRunService({
			executionRuntime,
			store: {
				getOwnedRun: vi.fn().mockResolvedValue({
					conversationId: "conv_01HQ",
					requestId: "req_01HQ",
					runId: "run_01HQ",
					traceId: "trace_01HQ",
				}),
			},
		});

		await expect(
			service.listEvents({
				afterSequence: 2,
				principal: createPrincipal(),
				runId: "run_01HQ",
			}),
		).rejects.toThrow("Execution durable run events must advance the requested cursor.");
	});

	it("subscribes to browser-visible durable run events by cursor until terminal event arrives", async () => {
		const sleep = vi.fn(async () => undefined);
		const listRunEvents = vi
			.fn()
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([
				durableEvent({
					eventType: "run.started",
					sequence: 3,
				}),
			])
			.mockResolvedValueOnce([
				durableEvent({
					eventType: "finalization.completed",
					payload: {
						request_id: "req_01HQ",
						trace_id: "trace_01HQ",
					},
					sequence: 4,
				}),
			]);
		const executionRuntime: ExecutionControlRuntimeClient = {
			cancelRun: vi.fn(),
			createRun: vi.fn(),
			getRun: vi.fn().mockResolvedValue(durableRun()),
			listRunEvents,
			listRunSteps: vi.fn().mockResolvedValue({ attempts: [], results: [], steps: [] }),
		};
		const service = buildRuntimeRunService({
			executionRuntime,
			store: {
				getOwnedRun: vi.fn().mockResolvedValue({
					conversationId: "conv_01HQ",
					requestId: "req_01HQ",
					runId: "run_01HQ",
					traceId: "trace_01HQ",
				}),
			},
		});

		const observed: RuntimeRunEventProjection[] = [];
		for await (const event of service.subscribeEvents({
			afterSequence: 2,
			polling: {
				maxAttempts: 3,
				pollIntervalMs: 25,
				sleep,
			},
			principal: createPrincipal(),
			runId: "run_01HQ",
		})) {
			observed.push(event);
		}

		expect(listRunEvents).toHaveBeenNthCalledWith(1, {
			afterSequence: 2,
			runId: "run_01HQ",
			traceId: "trace_01HQ",
		});
		expect(listRunEvents).toHaveBeenNthCalledWith(2, {
			afterSequence: 2,
			runId: "run_01HQ",
			traceId: "trace_01HQ",
		});
		expect(listRunEvents).toHaveBeenNthCalledWith(3, {
			afterSequence: 3,
			runId: "run_01HQ",
			traceId: "trace_01HQ",
		});
		expect(sleep).toHaveBeenCalledTimes(2);
		expect(observed).toEqual([
			{
				eventId: "event-3",
				eventType: "run.started",
				occurredAt: "2026-06-04T01:02:06.000Z",
				payload: {},
				runId: "run_01HQ",
				sequence: 3,
				visibility: "browser",
			},
			{
				eventId: "event-4",
				eventType: "finalization.completed",
				occurredAt: "2026-06-04T01:02:06.000Z",
				payload: {
					request_id: "req_01HQ",
					trace_id: "trace_01HQ",
				},
				runId: "run_01HQ",
				sequence: 4,
				visibility: "browser",
			},
		]);
	});

	it("strips internal finalization payload from student-visible run events", async () => {
		const executionRuntime: ExecutionControlRuntimeClient = {
			cancelRun: vi.fn(),
			createRun: vi.fn(),
			getRun: vi.fn().mockResolvedValue(durableRun({ status: "completed" })),
			listRunEvents: vi.fn().mockResolvedValue([
				durableEvent({
					eventType: "finalization.completed",
					payload: {
						agent_result_ref: "agent-result-hidden",
						observability: {
							answer_eval_fingerprint: {
								answer_fingerprint_sha256:
									"sha256:abababababababababababababababababababababababababababababababab",
							},
							llm_io_fingerprint: {
								provider_request_safe_hash: "hidden",
							},
						},
						request_id: "req_01HQ",
						response: {
							result: {
								terminal_envelope: {
									kind: "answer",
									text: "internal final response",
								},
								tool_results: [{ raw: "hidden" }],
							},
						},
						trace_id: "trace_01HQ",
						workflow_trace_summary: {
							tool_call_summaries: [{ provider_response_id: "resp_hidden" }],
						},
					},
					sequence: 3,
				}),
			]),
			listRunSteps: vi.fn().mockResolvedValue({ attempts: [], results: [], steps: [] }),
		};
		const service = buildRuntimeRunService({
			executionRuntime,
			store: {
				getOwnedRun: vi.fn().mockResolvedValue({
					conversationId: "conv_01HQ",
					requestId: "req_01HQ",
					runId: "run_01HQ",
					traceId: "trace_01HQ",
				}),
			},
		});

		const result = await service.listEvents({
			afterSequence: 2,
			principal: createPrincipal(),
			runId: "run_01HQ",
		});

		expect(result).toEqual({
			events: [
				expect.objectContaining({
					eventType: "finalization.completed",
					payload: {
						request_id: "req_01HQ",
						trace_id: "trace_01HQ",
					},
				}),
			],
			run: expect.objectContaining({
				phase: "completed",
				runId: "run_01HQ",
			}),
		});
		const serializedPayload = JSON.stringify(result.events[0]?.payload);
		expect(serializedPayload).not.toContain("response");
		expect(serializedPayload).not.toContain("observability");
		expect(serializedPayload).not.toContain("tool_results");
		expect(serializedPayload).not.toContain("workflow_trace_summary");
		expect(serializedPayload).not.toContain("answer_eval_fingerprint");
		expect(serializedPayload).not.toContain("llm_io_fingerprint");
	});

	it("keeps the default durable event subscription open long enough for RAG closeout", async () => {
		const sleep = vi.fn(async () => undefined);
		const listRunEvents = vi.fn();
		for (let index = 0; index < 55; index += 1) {
			listRunEvents.mockResolvedValueOnce([]);
		}
		listRunEvents.mockResolvedValueOnce([
			durableEvent({
				eventType: "finalization.completed",
				payload: {
					request_id: "req_01HQ",
					trace_id: "trace_01HQ",
				},
				sequence: 3,
			}),
		]);
		const executionRuntime: ExecutionControlRuntimeClient = {
			cancelRun: vi.fn(),
			createRun: vi.fn(),
			getRun: vi.fn().mockResolvedValue(durableRun()),
			listRunEvents,
			listRunSteps: vi.fn().mockResolvedValue({ attempts: [], results: [], steps: [] }),
		};
		const service = buildRuntimeRunService({
			executionRuntime,
			store: {
				getOwnedRun: vi.fn().mockResolvedValue({
					conversationId: "conv_01HQ",
					requestId: "req_01HQ",
					runId: "run_01HQ",
					traceId: "trace_01HQ",
				}),
			},
		});

		const observed: RuntimeRunEventProjection[] = [];
		for await (const event of service.subscribeEvents({
			afterSequence: 2,
			polling: {
				maxAttempts: 56,
				pollIntervalMs: 1000,
				sleep,
			},
			principal: createPrincipal(),
			runId: "run_01HQ",
		})) {
			observed.push(event);
		}

		expect(listRunEvents).toHaveBeenCalledTimes(56);
		expect(sleep).toHaveBeenCalledTimes(55);
		expect(observed).toEqual([
			expect.objectContaining({
				eventType: "finalization.completed",
				sequence: 3,
			}),
		]);
	});

	it("lists sanitized durable step trajectory for an owned run", async () => {
		const listRunSteps = vi.fn().mockResolvedValue({
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
			steps: [
				{
					tool: "any",
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
		const executionRuntime: ExecutionControlRuntimeClient = {
			cancelRun: vi.fn(),
			createRun: vi.fn(),
			getRun: vi.fn().mockResolvedValue(durableRun({ status: "completed" })),
			listRunEvents: vi.fn().mockResolvedValue([]),
			listRunSteps,
		};
		const service = buildRuntimeRunService({
			executionRuntime,
			store: {
				getOwnedRun: vi.fn().mockResolvedValue({
					conversationId: "conv_01HQ",
					requestId: "req_01HQ",
					runId: "run_01HQ",
					traceId: "trace_01HQ",
				}),
			},
		});

		await expect(
			service.listSteps({
				principal: createPrincipal(),
				runId: "run_01HQ",
			}),
		).resolves.toEqual({
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
					tool: "any",
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
		expect(listRunSteps).toHaveBeenCalledWith({
			runId: "run_01HQ",
			traceId: "trace_01HQ",
		});
	});

	it("strips Hindsight runtime refs from student-visible step trajectory", async () => {
		const listRunSteps = vi.fn().mockResolvedValue({
			agentRuntimeEvalProjection: {
				memoryOperationRef: "projection://runs/run_01HQ/memory/operations/op-hidden",
				score: 0.91,
			},
			attempts: [
				{
					activityAttempt: 1,
					activityId: "activity-memory",
					activityType: "AppendConversationMemoryActivity",
					attempt: 1,
					attemptId: "attempt-memory",
					cachedInputTokens: 0,
					cancelOutcome: "",
					completedAt: "2026-06-04T01:02:05.000Z",
					durationMs: 10,
					estimatedCostMicrousd: 0,
					failCloseReason: "",
					inputTokens: 0,
					lateCompletionOutcome: "",
					modelName: "",
					modelProvider: "",
					outputTokens: 0,
					payloadSchemaVersion: "step-attempt-projection-v1",
					pricingVersion: "",
					providerRequestRef: "",
					providerResponseId: "",
					replanReason: "",
					runId: "run_01HQ",
					sanitizedPayload: {
						operation_id: "op-hidden",
						operationStatusRef: "projection://runs/run_01HQ/memory/operations/op-hidden",
						public_status: "accepted",
					},
					scheduleToStartMs: 1,
					scheduledAt: "2026-06-04T01:02:04.000Z",
					startedAt: "2026-06-04T01:02:04.000Z",
					status: "completed",
					stepId: "memory.append",
					taskQueue: "context",
					temporalRunId: "temporal-run",
					terminalReason: "",
					timeoutOutcome: "",
					updatedAt: "2026-06-04T01:02:05.000Z",
					workerId: "test-worker",
					workflowId: "workflow-run_01HQ",
				},
			],
			results: [
				{
					attemptId: "attempt-memory",
					createdAt: "2026-06-04T01:02:05.000Z",
					payloadSchemaVersion: "step-result-projection-v1",
					projectionRef: "projection://runs/run_01HQ/memory/append",
					resultId: "result-memory",
					resultKind: "memory_conversation_append_result",
					runId: "run_01HQ",
					sanitizedPayload: {
						appended_message_count: 1,
						bank_id: "hindsight_bank_hidden",
						document_id: "profile:mem_hidden",
						operation_id: "op-hidden",
						operation_ref: "projection://runs/run_01HQ/memory/operations/op-hidden",
						operation_status_ref: "projection://runs/run_01HQ/memory/operations/op-hidden",
						related_document_id: "student_rules",
						result_metadata_shape: {
							raw_payload: "string",
						},
						runtime_document_ref:
							"projection://runs/run_01HQ/memory/documents/conversation%3Ahidden",
						status: "accepted",
					},
					status: "completed",
					stepId: "memory.append",
				},
			],
			steps: [
				{
					tool: "memory",
					completedAt: "2026-06-04T01:02:05.000Z",
					conversationId: "conv_01HQ",
					parentStepId: "",
					payloadSchemaVersion: "run-step-projection-v1",
					runId: "run_01HQ",
					sanitizedPayload: {
						comment: "profile: 学生偏好先看结论",
						documentId: "conversation:0123456789abcdef0123456789abcdef",
						public_status: "accepted",
						runtimeDocumentRef: "projection://runs/run_01HQ/memory/documents/conversation%3Ahidden",
					},
					startedAt: "2026-06-04T01:02:04.000Z",
					status: "completed",
					stepId: "memory.append",
					stepKind: "memory",
					taskQueue: "context",
					updatedAt: "2026-06-04T01:02:05.000Z",
					workerId: "test-worker",
				},
			],
		});
		const executionRuntime: ExecutionControlRuntimeClient = {
			cancelRun: vi.fn(),
			createRun: vi.fn(),
			getRun: vi.fn().mockResolvedValue(durableRun({ status: "completed" })),
			listRunEvents: vi.fn().mockResolvedValue([]),
			listRunSteps,
		};
		const service = buildRuntimeRunService({
			executionRuntime,
			store: {
				getOwnedRun: vi.fn().mockResolvedValue({
					conversationId: "conv_01HQ",
					requestId: "req_01HQ",
					runId: "run_01HQ",
					traceId: "trace_01HQ",
				}),
			},
		});

		const trajectory = await service.listSteps({
			principal: createPrincipal(),
			runId: "run_01HQ",
		});
		const encoded = JSON.stringify(trajectory);

		for (const forbidden of [
			"operation_id",
			"operationId",
			"operation_ref",
			"operationRef",
			"operation_status_ref",
			"operationStatusRef",
			"runtime_document_ref",
			"runtimeDocumentRef",
			"profile:mem_hidden",
			"conversation:0123456789abcdef0123456789abcdef",
			"bank_id",
			"bankId",
			"result_metadata_shape",
			"resultMetadataShape",
			"hindsight_bank_",
			"memory/operations",
			"memory/documents",
		]) {
			expect(encoded).not.toContain(forbidden);
		}
		expect(trajectory.results[0]?.sanitizedPayload).toMatchObject({
			appended_message_count: 1,
			related_document_id: "student_rules",
			status: "accepted",
		});
		expect(trajectory.steps[0]?.sanitizedPayload).toMatchObject({
			comment: "profile: 学生偏好先看结论",
			public_status: "accepted",
		});
		expect(trajectory.attempts[0]?.sanitizedPayload).toMatchObject({
			public_status: "accepted",
		});
		expect(trajectory.agentRuntimeEvalProjection).toEqual({ score: 0.91 });
	});
});
