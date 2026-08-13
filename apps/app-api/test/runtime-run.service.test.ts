// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import type {
	ExecutionControlRun,
	ExecutionControlRunEvent,
	ExecutionControlRuntimeClient,
} from "../src/modules/integration/execution-control";
import {
	buildRuntimeRunService,
	createPgRuntimeRunStore,
	type RuntimeRunEventProjection,
	type RuntimeRunOwnershipRecord,
	type RuntimeRunStore,
} from "../src/modules/runtime-run";
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
		queuedAt: "2026-06-04T01:02:03.500Z",
		requestId: "req_01HQ",
		runId: "run_01HQ",
		startedAt: "",
		status: "running",
		streamingStartedAt: "",
		surface: "campus_web",
		terminalReason: "",
		traceId: "trace_01HQ",
		turnId: "turn_01HQ",
		updatedAt: "2026-06-04T01:02:04.000Z",
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

function ownedRun(overrides: Partial<RuntimeRunOwnershipRecord> = {}): RuntimeRunOwnershipRecord {
	return {
		admissionStatus: "admitted",
		cancelOutboxStatus: "not_requested",
		cancelReason: null,
		cancelRequestedAt: null,
		completedAt: null,
		conversationId: "conv_01HQ",
		requestId: "req_01HQ",
		runId: "run_01HQ",
		status: "accepted",
		traceId: "trace_01HQ",
		...overrides,
	};
}

function runtimeStore(overrides: Partial<RuntimeRunStore> = {}): RuntimeRunStore {
	return {
		getOwnedRun: vi.fn().mockResolvedValue(ownedRun()),
		listPendingCancellations: vi.fn().mockResolvedValue([]),
		markCancellationDelivered: vi.fn().mockResolvedValue(true),
		recordCancellationFailure: vi.fn().mockResolvedValue(true),
		requestCancellation: vi.fn().mockResolvedValue(null),
		...overrides,
	};
}

function pgRuntimeRunStoreHarness(admissionStatus: "dispatching" | "pending_admission") {
	const currentRow = {
		actorUserId: "user_01HQ",
		admissionStatus,
		cancelOutboxStatus: "not_requested",
		cancelReason: null,
		cancelRequestedAt: null,
		completedAt: null,
		conversationId: "conv_01HQ",
		requestId: "req_01HQ",
		runId: "run_01HQ",
		status: "accepted",
		traceId: "trace_01HQ",
	};
	let updateValues: Record<string, unknown> = {};
	const returning = vi.fn(async () => [{ ...currentRow, ...updateValues }]);
	const updateWhere = vi.fn(() => ({ returning }));
	const set = vi.fn((values: Record<string, unknown>) => {
		updateValues = values;
		return { where: updateWhere };
	});
	const update = vi.fn(() => ({ set }));
	const forUpdate = vi.fn(async () => [currentRow]);
	const limit = vi.fn(() => ({ for: forUpdate }));
	const selectWhere = vi.fn(() => ({ limit }));
	const from = vi.fn(() => ({ where: selectWhere }));
	const select = vi.fn(() => ({ from }));
	const transactionClient = { select, update };
	const transaction = vi.fn(async (callback: (tx: typeof transactionClient) => Promise<unknown>) =>
		callback(transactionClient),
	);
	const store = createPgRuntimeRunStore({} as never, {
		getDb: async () => ({ transaction }) as never,
	});
	return { set, store };
}

function eventPage(events: ExecutionControlRunEvent[], nextSequence?: number) {
	return {
		events,
		nextSequence: nextSequence ?? events.at(-1)?.sequence ?? 0,
	};
}

describe("pg runtime run store", () => {
	it("retains frozen execution input when pending admission is locally cancelled", async () => {
		const { set, store } = pgRuntimeRunStoreHarness("pending_admission");
		const requestedAt = "2026-06-04T01:02:05.000Z";

		await expect(
			store.requestCancellation({
				ownerUserId: "user_01HQ",
				reason: "user_requested",
				requestedAt,
				runId: "run_01HQ",
			}),
		).resolves.toMatchObject({
			kind: "local_finalization",
			run: {
				admissionStatus: "cancelled",
				cancelOutboxStatus: "local_finalization_pending",
			},
		});
		expect(set).toHaveBeenCalledWith({
			admissionInputJson: null,
			admissionInputSha256: null,
			admissionStatus: "cancelled",
			cancelOutboxStatus: "local_finalization_pending",
			cancelReason: "user_requested",
			cancelRequestedAt: new Date(requestedAt),
			updatedAt: new Date(requestedAt),
		});
	});

	it("keeps execution input owned when the admission claim wins the cancellation race", async () => {
		const { set, store } = pgRuntimeRunStoreHarness("dispatching");
		const requestedAt = "2026-06-04T01:02:05.000Z";

		await expect(
			store.requestCancellation({
				ownerUserId: "user_01HQ",
				reason: "user_requested",
				requestedAt,
				runId: "run_01HQ",
			}),
		).resolves.toMatchObject({
			kind: "remote_delivery",
			run: {
				admissionStatus: "dispatching",
				cancelOutboxStatus: "pending_delivery",
			},
		});
		expect(set).toHaveBeenCalledWith({
			cancelOutboxStatus: "pending_delivery",
			cancelReason: "user_requested",
			cancelRequestedAt: new Date(requestedAt),
			updatedAt: new Date(requestedAt),
		});
	});
});

describe("runtime run service", () => {
	it.each([
		["completed", "completed", "completed"],
		["needs_clarification", "completed", "completed"],
		["no_answer", "completed", "completed"],
		["approval_required", "completed", "completed"],
		["rejected", "completed", "completed"],
		["error", "failed", "failed"],
		["cancelled", "canceled", "canceled"],
	] as const)(
		"maps the product terminal status %s without consulting execution-control",
		async (productStatus, expectedStatus, expectedPhase) => {
			const getRun = vi.fn();
			const service = buildRuntimeRunService({
				executionRuntime: {
					cancelRun: vi.fn(),
					createRun: vi.fn(),
					getRun,
					listRunEvents: vi.fn(),
					listRunSteps: vi.fn(),
				},
				store: runtimeStore({
					getOwnedRun: vi.fn().mockResolvedValue(ownedRun({ status: productStatus })),
				}),
			});

			await expect(
				service.getStatus({
					principal: createPrincipal(),
					runId: "run_01HQ",
				}),
			).resolves.toMatchObject({
				run: { phase: expectedPhase, status: expectedStatus },
			});
			expect(getRun).not.toHaveBeenCalled();
		},
	);

	it("rejects cancellation after the product run is already terminal", async () => {
		const cancelRun = vi.fn();
		const store = runtimeStore({
			requestCancellation: vi.fn().mockResolvedValue({
				kind: "terminal",
				run: {
					...ownedRun({
						completedAt: "2026-06-04T01:02:05.000Z",
						status: "completed",
					}),
					requestedAt: "2026-06-04T01:02:06.000Z",
				},
			}),
		});
		const service = buildRuntimeRunService({
			executionRuntime: {
				cancelRun,
				createRun: vi.fn(),
				getRun: vi.fn(),
				listRunEvents: vi.fn(),
				listRunSteps: vi.fn(),
			},
			store,
		});

		await expect(
			service.cancel({
				principal: createPrincipal(),
				reason: "user_requested",
				runId: "run_01HQ",
			}),
		).rejects.toMatchObject({
			code: "run_already_terminal",
			retryable: false,
			status: 409,
		});
		expect(cancelRun).not.toHaveBeenCalled();
	});

	it("finalizes cancellation locally before admission without contacting execution-control", async () => {
		const cancelRun = vi.fn();
		const finalizeLocalCancellation = vi.fn(async () => undefined);
		const cancellationRun = {
			...ownedRun({
				admissionStatus: "cancelled",
				cancelOutboxStatus: "local_finalization_pending",
				cancelReason: "user_requested",
				cancelRequestedAt: "2026-06-04T01:02:05.000Z",
			}),
			requestedAt: "2026-06-04T01:02:05.000Z",
		};
		const store = runtimeStore({
			requestCancellation: vi.fn().mockResolvedValue({
				kind: "local_finalization",
				run: cancellationRun,
			}),
		});
		const service = buildRuntimeRunService({
			executionRuntime: {
				cancelRun,
				createRun: vi.fn(),
				getRun: vi.fn(),
				listRunEvents: vi.fn(),
				listRunSteps: vi.fn(),
			},
			finalizeLocalCancellation,
			store,
		});

		await expect(
			service.cancel({
				principal: createPrincipal(),
				reason: "user_requested",
				runId: "run_01HQ",
			}),
		).resolves.toEqual({
			run: expect.objectContaining({
				phase: "canceled",
				status: "canceled",
				terminalReason: "user_requested",
			}),
		});
		expect(finalizeLocalCancellation).toHaveBeenCalledWith({
			completedAt: "2026-06-04T01:02:05.000Z",
			runId: "run_01HQ",
		});
		expect(cancelRun).not.toHaveBeenCalled();
	});

	it("retries persisted remote cancellation outbox entries", async () => {
		const cancellationRun = {
			...ownedRun({
				cancelOutboxStatus: "pending_delivery",
				cancelReason: "user_requested",
				cancelRequestedAt: "2026-06-04T01:02:05.000Z",
			}),
			requestedAt: "2026-06-04T01:02:05.000Z",
		};
		const markCancellationDelivered = vi.fn().mockResolvedValue(true);
		const store = runtimeStore({
			listPendingCancellations: vi
				.fn()
				.mockResolvedValue([{ kind: "remote_delivery", run: cancellationRun }]),
			markCancellationDelivered,
		});
		const cancelRun = vi.fn().mockResolvedValue(
			durableRun({
				completedAt: "2026-06-04T01:02:06.000Z",
				status: "canceled",
				terminalReason: "user_requested",
			}),
		);
		const service = buildRuntimeRunService({
			executionRuntime: {
				cancelRun,
				createRun: vi.fn(),
				getRun: vi.fn(),
				listRunEvents: vi.fn(),
				listRunSteps: vi.fn(),
			},
			now: () => new Date("2026-06-04T01:02:06.000Z"),
			store,
		});

		await expect(service.dispatchPendingCancellations?.()).resolves.toEqual({
			delivered: 1,
			failed: 0,
			finalized: 0,
			processed: 1,
		});
		expect(cancelRun).toHaveBeenCalledTimes(1);
		expect(markCancellationDelivered).toHaveBeenCalledWith({
			deliveredAt: "2026-06-04T01:02:06.000Z",
			runId: "run_01HQ",
		});
	});

	it("projects durable run statuses into product runtime phases", async () => {
		const executionRuntime: ExecutionControlRuntimeClient = {
			cancelRun: vi.fn(),
			createRun: vi.fn(),
			getRun: vi.fn().mockResolvedValue(
				durableRun({
					status: "queued",
				}),
			),
			listRunEvents: vi.fn().mockResolvedValue(eventPage([])),
			listRunSteps: vi.fn().mockResolvedValue({ attempts: [], results: [], steps: [] }),
		};
		const service = buildRuntimeRunService({
			executionRuntime,
			store: runtimeStore(),
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
			listRunEvents: vi.fn().mockResolvedValue(eventPage([])),
			listRunSteps: vi.fn().mockResolvedValue({ attempts: [], results: [], steps: [] }),
		};
		const service = buildRuntimeRunService({
			executionRuntime,
			store: runtimeStore(),
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
			listRunEvents: vi.fn().mockResolvedValue(
				eventPage([
					durableEvent({
						eventType: "run.started",
						sequence: 2,
					}),
				]),
			),
			listRunSteps: vi.fn().mockResolvedValue({ attempts: [], results: [], steps: [] }),
		};
		const service = buildRuntimeRunService({
			executionRuntime,
			store: runtimeStore(),
		});

		await expect(
			service.listEvents({
				afterSequence: 2,
				principal: createPrincipal(),
				runId: "run_01HQ",
			}),
		).rejects.toThrow("Execution durable run events must advance the requested cursor.");
	});

	it("advances next_sequence across mixed pages and exposes browser-visible queued events", async () => {
		const listRunEvents = vi
			.fn()
			.mockResolvedValueOnce(
				eventPage(
					[
						durableEvent({
							eventType: "run.queued",
							sequence: 3,
							visibility: "browser",
						}),
						durableEvent({
							eventType: "workflow.internal",
							sequence: 4,
							visibility: "internal",
						}),
					],
					4,
				),
			)
			.mockResolvedValueOnce(
				eventPage([
					durableEvent({
						eventType: "run.started",
						sequence: 5,
					}),
				]),
			);
		const service = buildRuntimeRunService({
			executionRuntime: {
				cancelRun: vi.fn(),
				createRun: vi.fn(),
				getRun: vi.fn().mockResolvedValue(durableRun()),
				listRunEvents,
				listRunSteps: vi.fn(),
			},
			store: runtimeStore(),
		});

		const first = await service.listEvents({
			afterSequence: 2,
			principal: createPrincipal(),
			runId: "run_01HQ",
		});
		expect(first.events).toMatchObject([
			{
				eventType: "run.queued",
				sequence: 3,
				visibility: "browser",
			},
		]);
		expect(first.nextSequence).toBe(4);
		const second = await service.listEvents({
			afterSequence: first.nextSequence,
			principal: createPrincipal(),
			runId: "run_01HQ",
		});
		expect(second.events.map((event) => event.eventType)).toEqual(["run.started"]);
		expect(listRunEvents).toHaveBeenNthCalledWith(2, expect.objectContaining({ afterSequence: 4 }));
	});

	it("subscribes to browser-visible durable run events by cursor until terminal event arrives", async () => {
		const listRunEvents = vi
			.fn()
			.mockResolvedValueOnce(eventPage([], 2))
			.mockResolvedValueOnce(
				eventPage([
					durableEvent({
						eventType: "run.started",
						sequence: 3,
					}),
				]),
			)
			.mockResolvedValueOnce(
				eventPage([
					durableEvent({
						eventType: "finalization.completed",
						payload: {
							request_id: "req_01HQ",
							trace_id: "trace_01HQ",
						},
						sequence: 4,
					}),
				]),
			);
		const executionRuntime: ExecutionControlRuntimeClient = {
			cancelRun: vi.fn(),
			createRun: vi.fn(),
			getRun: vi.fn().mockResolvedValue(durableRun()),
			listRunEvents,
			listRunSteps: vi.fn().mockResolvedValue({ attempts: [], results: [], steps: [] }),
		};
		const service = buildRuntimeRunService({
			executionRuntime,
			store: runtimeStore(),
		});
		const controller = new AbortController();

		const observed: RuntimeRunEventProjection[] = [];
		for await (const event of service.subscribeEvents({
			afterSequence: 2,
			polling: {
				maxAttempts: 3,
				waitMs: 25,
			},
			principal: createPrincipal(),
			runId: "run_01HQ",
			signal: controller.signal,
		})) {
			observed.push(event);
		}

		expect(listRunEvents).toHaveBeenNthCalledWith(1, {
			afterSequence: 2,
			runId: "run_01HQ",
			signal: controller.signal,
			traceId: "trace_01HQ",
			waitMs: 25,
		});
		expect(listRunEvents).toHaveBeenNthCalledWith(2, {
			afterSequence: 2,
			runId: "run_01HQ",
			signal: controller.signal,
			traceId: "trace_01HQ",
			waitMs: 25,
		});
		expect(listRunEvents).toHaveBeenNthCalledWith(3, {
			afterSequence: 3,
			runId: "run_01HQ",
			signal: controller.signal,
			traceId: "trace_01HQ",
			waitMs: 25,
		});
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
					eventType: "finalization.completed",
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

	it("continues long polling through empty event pages until a terminal event arrives", async () => {
		const listRunEvents = vi.fn();
		for (let index = 0; index < 55; index += 1) {
			listRunEvents.mockResolvedValueOnce(eventPage([], 2));
		}
		listRunEvents.mockResolvedValueOnce(
			eventPage([
				durableEvent({
					eventType: "finalization.completed",
					payload: {
						request_id: "req_01HQ",
						trace_id: "trace_01HQ",
					},
					sequence: 3,
				}),
			]),
		);
		const executionRuntime: ExecutionControlRuntimeClient = {
			cancelRun: vi.fn(),
			createRun: vi.fn(),
			getRun: vi.fn().mockResolvedValue(durableRun()),
			listRunEvents,
			listRunSteps: vi.fn().mockResolvedValue({ attempts: [], results: [], steps: [] }),
		};
		const service = buildRuntimeRunService({
			executionRuntime,
			store: runtimeStore(),
		});

		const observed: RuntimeRunEventProjection[] = [];
		for await (const event of service.subscribeEvents({
			afterSequence: 2,
			polling: {
				maxAttempts: 56,
				waitMs: 1000,
			},
			principal: createPrincipal(),
			runId: "run_01HQ",
		})) {
			observed.push(event);
		}

		expect(listRunEvents).toHaveBeenCalledTimes(56);
		expect(listRunEvents).toHaveBeenLastCalledWith({
			afterSequence: 2,
			runId: "run_01HQ",
			traceId: "trace_01HQ",
			waitMs: 1000,
		});
		expect(observed).toEqual([
			expect.objectContaining({
				eventType: "finalization.completed",
				sequence: 3,
			}),
		]);
	});

	it.each(["completed", "failed", "canceled", "expired"] as const)(
		"stops subscribing when the durable run is already %s beyond the event cursor",
		async (status) => {
			const listRunEvents = vi.fn().mockResolvedValue(eventPage([], 9));
			const executionRuntime: ExecutionControlRuntimeClient = {
				cancelRun: vi.fn(),
				createRun: vi.fn(),
				getRun: vi.fn().mockResolvedValue(durableRun({ status })),
				listRunEvents,
				listRunSteps: vi.fn().mockResolvedValue({ attempts: [], results: [], steps: [] }),
			};
			const service = buildRuntimeRunService({ executionRuntime, store: runtimeStore() });

			const observed: RuntimeRunEventProjection[] = [];
			for await (const event of service.subscribeEvents({
				afterSequence: 9,
				polling: { maxAttempts: 3, waitMs: 25 },
				principal: createPrincipal(),
				runId: "run_01HQ",
			})) {
				observed.push(event);
			}

			expect(observed).toEqual([]);
			expect(listRunEvents).toHaveBeenCalledOnce();
		},
	);

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
		).resolves.toEqual({
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
