// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import type { ExecutionControlRuntimeClient } from "../src/modules/integration/execution-control";
import { buildRuntimeRunService, type RuntimeRunEventProjection } from "../src/modules/runtime-run";
import { createPrincipal } from "./chat-command.service.test-support";
import {
	durableEvent,
	durableRun,
	eventPage,
	ownedRun,
	runtimeStore,
} from "./runtime-run.test-support";

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

	it.each(["pending_admission", "dispatching"])(
		"keeps %s runs local until durable admission is confirmed",
		async (admissionStatus) => {
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
					getOwnedRun: vi.fn().mockResolvedValue(ownedRun({ admissionStatus })),
				}),
			});

			await expect(
				service.getStatus({
					principal: createPrincipal(),
					runId: "run_01HQ",
				}),
			).resolves.toMatchObject({
				run: { phase: "queued", status: "pending_admission" },
			});
			expect(getRun).not.toHaveBeenCalled();
		},
	);

	it.each(["pending_admission", "dispatching"])(
		"returns pending product steps while a %s run has no durable projection",
		async (admissionStatus) => {
			const getRun = vi.fn();
			const listRunSteps = vi.fn();
			const service = buildRuntimeRunService({
				executionRuntime: {
					cancelRun: vi.fn(),
					createRun: vi.fn(),
					getRun,
					listRunEvents: vi.fn(),
					listRunSteps,
				},
				store: runtimeStore({
					getOwnedRun: vi.fn().mockResolvedValue(ownedRun({ admissionStatus })),
				}),
			});

			await expect(
				service.listSteps({
					principal: createPrincipal(),
					runId: "run_01HQ",
				}),
			).resolves.toEqual({
				run: expect.objectContaining({ phase: "queued", status: "pending_admission" }),
				steps: [
					{
						completedAt: null,
						durationMs: null,
						phase: "queued",
						startedAt: null,
						status: "pending",
					},
					{
						completedAt: null,
						durationMs: null,
						phase: "preparing",
						startedAt: null,
						status: "pending",
					},
					{
						completedAt: null,
						durationMs: null,
						phase: "generating",
						startedAt: null,
						status: "pending",
					},
					{
						completedAt: null,
						durationMs: null,
						phase: "finalizing",
						startedAt: null,
						status: "pending",
					},
				],
			});
			expect(getRun).not.toHaveBeenCalled();
			expect(listRunSteps).not.toHaveBeenCalled();
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
				eventType: "execution.queued",
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
		expect(second.events.map((event) => event.eventType)).toEqual(["execution.running"]);
		expect(listRunEvents).toHaveBeenNthCalledWith(2, expect.objectContaining({ afterSequence: 4 }));
	});

	it("returns an empty local event page before durable admission", async () => {
		const getRun = vi.fn();
		const listRunEvents = vi.fn();
		const service = buildRuntimeRunService({
			executionRuntime: {
				cancelRun: vi.fn(),
				createRun: vi.fn(),
				getRun,
				listRunEvents,
				listRunSteps: vi.fn(),
			},
			store: runtimeStore({
				getOwnedRun: vi.fn().mockResolvedValue(ownedRun({ admissionStatus: "pending_admission" })),
			}),
		});

		await expect(
			service.listEvents({
				afterSequence: 4,
				principal: createPrincipal(),
				runId: "run_01HQ",
			}),
		).resolves.toEqual({
			events: [],
			nextSequence: 4,
			run: expect.objectContaining({ phase: "queued", status: "pending_admission" }),
		});
		expect(getRun).not.toHaveBeenCalled();
		expect(listRunEvents).not.toHaveBeenCalled();
	});

	it("reads durable events after product finalization", async () => {
		const getRun = vi.fn().mockResolvedValue(durableRun({ status: "completed" }));
		const listRunEvents = vi.fn().mockResolvedValue(
			eventPage([
				durableEvent({
					eventType: "finalization.completed",
					sequence: 7,
				}),
			]),
		);
		const service = buildRuntimeRunService({
			executionRuntime: {
				cancelRun: vi.fn(),
				createRun: vi.fn(),
				getRun,
				listRunEvents,
				listRunSteps: vi.fn(),
			},
			store: runtimeStore({
				getOwnedRun: vi.fn().mockResolvedValue(ownedRun({ status: "completed" })),
			}),
		});

		await expect(
			service.listEvents({
				afterSequence: 6,
				principal: createPrincipal(),
				runId: "run_01HQ",
			}),
		).resolves.toMatchObject({
			events: [expect.objectContaining({ eventType: "request.completed", sequence: 7 })],
			nextSequence: 7,
			run: { phase: "completed", status: "completed" },
		});
		expect(getRun).toHaveBeenCalledOnce();
		expect(listRunEvents).toHaveBeenCalledWith({
			afterSequence: 6,
			runId: "run_01HQ",
			traceId: "trace_01HQ",
		});
	});

	it("reads durable steps after product finalization", async () => {
		const getOwnedRun = vi.fn().mockResolvedValue(ownedRun({ status: "completed" }));
		const getRun = vi.fn().mockResolvedValue(
			durableRun({
				completedAt: "2026-06-04T01:02:07.000Z",
				status: "completed",
			}),
		);
		const listRunEvents = vi.fn().mockResolvedValue(
			eventPage([
				durableEvent({
					eventType: "run.queued",
					occurredAt: "2026-06-04T01:02:03.500Z",
					sequence: 1,
				}),
				durableEvent({
					eventType: "run.started",
					occurredAt: "2026-06-04T01:02:04.000Z",
					sequence: 2,
				}),
				durableEvent({
					eventType: "run.answer_started",
					occurredAt: "2026-06-04T01:02:05.000Z",
					sequence: 3,
				}),
				durableEvent({
					eventType: "finalization.completed",
					occurredAt: "2026-06-04T01:02:07.000Z",
					sequence: 4,
				}),
			]),
		);
		const listRunSteps = vi.fn();
		const service = buildRuntimeRunService({
			executionRuntime: {
				cancelRun: vi.fn(),
				createRun: vi.fn(),
				getRun,
				listRunEvents,
				listRunSteps,
			},
			store: runtimeStore({
				getOwnedRun,
			}),
		});

		await expect(
			service.listSteps({
				principal: createPrincipal(),
				runId: "run_01HQ",
			}),
		).resolves.toMatchObject({
			run: { phase: "completed", status: "completed" },
			steps: [
				expect.objectContaining({ phase: "queued", status: "completed" }),
				expect.objectContaining({ phase: "preparing", status: "completed" }),
				expect.objectContaining({ phase: "generating", status: "completed" }),
				expect.objectContaining({ phase: "finalizing", status: "completed" }),
			],
		});
		expect(getOwnedRun).toHaveBeenCalledOnce();
		expect(getRun).toHaveBeenCalledOnce();
		expect(listRunEvents).toHaveBeenCalledWith({
			afterSequence: 0,
			runId: "run_01HQ",
			traceId: "trace_01HQ",
		});
		expect(listRunSteps).not.toHaveBeenCalled();
	});

	it.each(["admission_failed", "cancelled"])(
		"keeps terminal %s runs local without durable history",
		async (admissionStatus) => {
			const getRun = vi.fn();
			const listRunEvents = vi.fn();
			const listRunSteps = vi.fn();
			const productStatus = admissionStatus === "cancelled" ? "cancelled" : "error";
			const service = buildRuntimeRunService({
				executionRuntime: {
					cancelRun: vi.fn(),
					createRun: vi.fn(),
					getRun,
					listRunEvents,
					listRunSteps,
				},
				store: runtimeStore({
					getOwnedRun: vi
						.fn()
						.mockResolvedValue(ownedRun({ admissionStatus, status: productStatus })),
				}),
			});

			await expect(
				service.listEvents({
					afterSequence: 4,
					principal: createPrincipal(),
					runId: "run_01HQ",
				}),
			).resolves.toMatchObject({
				events: [],
				nextSequence: 4,
				run: { phase: productStatus === "cancelled" ? "canceled" : "failed" },
			});
			await expect(
				service.listSteps({
					principal: createPrincipal(),
					runId: "run_01HQ",
				}),
			).resolves.toEqual({
				run: expect.objectContaining({
					phase: productStatus === "cancelled" ? "canceled" : "failed",
				}),
				steps: [
					expect.objectContaining({ phase: "queued", status: "pending" }),
					expect.objectContaining({ phase: "preparing", status: "pending" }),
					expect.objectContaining({ phase: "generating", status: "pending" }),
					expect.objectContaining({ phase: "finalizing", status: "pending" }),
				],
			});
			expect(getRun).not.toHaveBeenCalled();
			expect(listRunEvents).not.toHaveBeenCalled();
			expect(listRunSteps).not.toHaveBeenCalled();
		},
	);

	it.each(["pending_admission", "dispatching"])(
		"ends the subscription immediately before %s admission",
		async (admissionStatus) => {
			const getOwnedRun = vi.fn().mockResolvedValue(ownedRun({ admissionStatus }));
			const getRun = vi.fn();
			const listRunEvents = vi.fn();
			const service = buildRuntimeRunService({
				executionRuntime: {
					cancelRun: vi.fn(),
					createRun: vi.fn(),
					getRun,
					listRunEvents,
					listRunSteps: vi.fn(),
				},
				store: runtimeStore({ getOwnedRun }),
			});

			const result = await service
				.subscribeEvents({
					polling: { maxAttempts: 180, waitMs: 25_000 },
					principal: createPrincipal(),
					runId: "run_01HQ",
				})
				[Symbol.asyncIterator]()
				.next();

			expect(result).toMatchObject({ done: true });
			expect(getOwnedRun).toHaveBeenCalledOnce();
			expect(getRun).not.toHaveBeenCalled();
			expect(listRunEvents).not.toHaveBeenCalled();
		},
	);

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
				eventType: "execution.running",
				occurredAt: "2026-06-04T01:02:06.000Z",
				payload: {},
				runId: "run_01HQ",
				sequence: 3,
				visibility: "browser",
			},
			{
				eventId: "event-4",
				eventType: "request.completed",
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
				eventType: "request.completed",
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
});
