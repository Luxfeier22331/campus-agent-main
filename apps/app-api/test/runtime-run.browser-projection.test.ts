// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import type { ExecutionControlRuntimeClient } from "../src/modules/integration/execution-control";
import { buildRuntimeRunService } from "../src/modules/runtime-run";
import { createPrincipal } from "./chat-command.service.test-support";
import { durableEvent, durableRun, eventPage, runtimeStore } from "./runtime-run.test-support";

describe("runtime run browser projection", () => {
	it("projects the browser-visible run completion as a product completion", async () => {
		const executionRuntime: ExecutionControlRuntimeClient = {
			cancelRun: vi.fn(),
			createRun: vi.fn(),
			getRun: vi.fn().mockResolvedValue(durableRun({ status: "completed" })),
			listRunEvents: vi.fn().mockResolvedValue(
				eventPage([
					durableEvent({
						eventType: "run.completed",
						payload: {
							request_id: "req_01HQ",
							status: "completed",
							terminal_reason: "answer_completed",
							trace_id: "trace_01HQ",
						},
						sequence: 3,
					}),
				]),
			),
			listRunSteps: vi.fn().mockResolvedValue({ attempts: [], results: [], steps: [] }),
		};
		const service = buildRuntimeRunService({
			executionRuntime,
			store: runtimeStore(),
		});

		const result = await service.listEvents({
			afterSequence: 2,
			principal: createPrincipal(),
			runId: "run_01HQ",
		});

		expect(result.events).toEqual([
			expect.objectContaining({
				eventType: "request.completed",
				payload: {
					request_id: "req_01HQ",
					status: "completed",
					terminal_reason: "answer_completed",
					trace_id: "trace_01HQ",
				},
			}),
		]);
	});

	it("strips internal finalization payload from student-visible run events", async () => {
		const executionRuntime: ExecutionControlRuntimeClient = {
			cancelRun: vi.fn(),
			createRun: vi.fn(),
			getRun: vi.fn().mockResolvedValue(durableRun({ status: "completed" })),
			listRunEvents: vi.fn().mockResolvedValue(
				eventPage([
					durableEvent({
						eventType: "finalization.completed",
						payload: {
							agent_result_ref: "agent-result-hidden",
							observability: {
								prompt_trace: {
									rendered_prompt_sha256: "hidden",
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
			),
			listRunSteps: vi.fn().mockResolvedValue({ attempts: [], results: [], steps: [] }),
		};
		const service = buildRuntimeRunService({
			executionRuntime,
			store: runtimeStore(),
		});

		const result = await service.listEvents({
			afterSequence: 2,
			principal: createPrincipal(),
			runId: "run_01HQ",
		});

		expect(result).toEqual({
			events: [
				expect.objectContaining({
					eventType: "request.completed",
					payload: {
						request_id: "req_01HQ",
						trace_id: "trace_01HQ",
					},
				}),
			],
			nextSequence: 3,
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
	});
	it("lists sanitized durable step trajectory for an owned run", async () => {
		const listRunSteps = vi.fn().mockResolvedValue({
			attempts: [],
			results: [
				{
					attemptId: "attempt-memory",
					createdAt: "2026-06-04T01:02:05.000Z",
					payloadSchemaVersion: "step-result-projection-v1",
					projectionRef: "projection://runs/run_01HQ/sdk-tools/personal_memory_recall/1",
					resultId: "result-memory",
					resultKind: "typed_tool_result",
					runId: "run_01HQ",
					sanitizedPayload: {
						outcome: "matched",
						tool_name: "personal_memory_recall",
						tool_status: "completed",
					},
					status: "completed",
					stepId: "sdk_tool.execute.personal_memory_recall.1",
				},
			],
			steps: [
				{
					tool: "personal_memory_recall",
					completedAt: "2026-06-04T01:02:05.000Z",
					conversationId: "conv_01HQ",
					parentStepId: "",
					payloadSchemaVersion: "run-step-projection-v1",
					runId: "run_01HQ",
					sanitizedPayload: {
						outcome: "matched",
						tool_name: "personal_memory_recall",
						tool_status: "completed",
					},
					startedAt: "2026-06-04T01:02:04.000Z",
					status: "completed",
					stepId: "sdk_tool.execute.personal_memory_recall.1",
					stepKind: "tool",
					taskQueue: "campus-agent.activity.agent.v3",
					updatedAt: "2026-06-04T01:02:05.000Z",
					workerId: "test-worker",
				},
			],
		});
		const executionRuntime: ExecutionControlRuntimeClient = {
			cancelRun: vi.fn(),
			createRun: vi.fn(),
			getRun: vi.fn().mockResolvedValue(durableRun({ status: "completed" })),
			listRunEvents: vi.fn().mockResolvedValue(eventPage([])),
			listRunSteps,
		};
		const service = buildRuntimeRunService({
			executionRuntime,
			store: runtimeStore(),
		});

		await expect(
			service.listSteps({
				principal: createPrincipal(),
				runId: "run_01HQ",
			}),
		).resolves.toMatchObject({
			run: expect.objectContaining({
				phase: "completed",
				runId: "run_01HQ",
			}),
			steps: [
				expect.objectContaining({ phase: "queued", status: "completed" }),
				expect.objectContaining({ phase: "preparing", status: "completed" }),
				expect.objectContaining({ phase: "generating", status: "completed" }),
				expect.objectContaining({ phase: "finalizing", status: "completed" }),
			],
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
					failCloseReason: "",
					inputTokens: 0,
					lateCompletionOutcome: "",
					modelName: "",
					modelProvider: "",
					outputTokens: 0,
					payloadSchemaVersion: "step-attempt-projection-v1",
					providerRequestRef: "",
					providerResponseId: "",
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
			listRunEvents: vi.fn().mockResolvedValue(eventPage([])),
			listRunSteps,
		};
		const service = buildRuntimeRunService({
			executionRuntime,
			store: runtimeStore(),
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
		expect(trajectory.steps).toHaveLength(4);
		expect(trajectory.steps.map((step) => step.phase)).toEqual([
			"queued",
			"preparing",
			"generating",
			"finalizing",
		]);
		expect(trajectory.steps.at(-1)).toMatchObject({
			phase: "finalizing",
			status: "completed",
		});
		expect(trajectory).not.toHaveProperty("attempts");
		expect(trajectory).not.toHaveProperty("results");
		expect(trajectory).not.toHaveProperty("agentRuntimeEvalProjection");
	});
});
