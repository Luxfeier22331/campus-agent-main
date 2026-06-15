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
		lane: "rag",
		ownerUserId: "user_01HQ",
		requestId: "req_01HQ",
		requestedCapability: "knowledge",
		runId: "run_01HQ",
		selectedCapability: "knowledge",
		startedAt: "",
		status: "running",
		streamingStartedAt: "",
		surface: "public_chat_web",
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
		expect(listRunSteps).toHaveBeenCalledWith({
			runId: "run_01HQ",
			traceId: "trace_01HQ",
		});
	});
});
