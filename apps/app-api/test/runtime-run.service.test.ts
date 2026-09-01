// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { ExecutionControlTransportError } from "../src/modules/integration";
import { buildRuntimeRunService } from "../src/modules/runtime-run";
import { createPrincipal } from "./chat-command.service.test-support";
import { durableEvent, durableRun, eventPage, runtimeStore } from "./runtime-run.test-support";

function runtime() {
	return {
		cancelRun: vi.fn().mockResolvedValue(durableRun({ status: "canceled" })),
		createRun: vi.fn(),
		getRun: vi.fn().mockResolvedValue(durableRun({ status: "queued" })),
		listRunEvents: vi.fn().mockResolvedValue(eventPage([])),
	};
}

describe("runtime run service", () => {
	it("reads status from execution-control for an accepted product run", async () => {
		const executionRuntime = runtime();
		const service = buildRuntimeRunService({ executionRuntime, store: runtimeStore() });

		await expect(
			service.getStatus({ principal: createPrincipal(), requestId: "req_01HQ" }),
		).resolves.toMatchObject({ run: { phase: "queued", status: "queued" } });
		expect(executionRuntime.getRun).toHaveBeenCalledWith({
			requestId: "req_01HQ",
		});
	});

	it("cancels through execution-control without writing local cancellation state", async () => {
		const executionRuntime = runtime();
		const service = buildRuntimeRunService({ executionRuntime, store: runtimeStore() });

		await expect(
			service.cancel({
				principal: createPrincipal(),
				reason: "user_requested",
				requestId: "req_01HQ",
			}),
		).resolves.toMatchObject({ run: { status: "canceled" } });
		expect(executionRuntime.cancelRun).toHaveBeenCalledWith({
			reason: "user_requested",
			requestId: "req_01HQ",
		});
	});

	it("reconstructs a missing accepted run through the shared handoff", async () => {
		const executionRuntime = runtime();
		executionRuntime.getRun.mockRejectedValue(
			new ExecutionControlTransportError({
				code: "durable_run_not_found",
				message: "Durable run not found.",
				retryable: false,
				status: 404,
			}),
		);
		const ensureRun = vi.fn().mockResolvedValue(durableRun({ status: "queued" }));
		const service = buildRuntimeRunService({ executionRuntime, ensureRun, store: runtimeStore() });

		await expect(
			service.getStatus({ principal: createPrincipal(), requestId: "req_01HQ" }),
		).resolves.toMatchObject({ run: { status: "queued" } });
		expect(ensureRun).toHaveBeenCalledWith({ requestId: "req_01HQ" });
	});

	it("does not reconstruct an accepted run on an upstream failure", async () => {
		const executionRuntime = runtime();
		const error = new ExecutionControlTransportError({
			code: "execution_control_unavailable",
			message: "Execution control runtime request failed.",
			retryable: true,
			status: 503,
		});
		executionRuntime.getRun.mockRejectedValue(error);
		const ensureRun = vi.fn();
		const service = buildRuntimeRunService({ executionRuntime, ensureRun, store: runtimeStore() });

		await expect(
			service.getStatus({ principal: createPrincipal(), requestId: "req_01HQ" }),
		).rejects.toBe(error);
		expect(ensureRun).not.toHaveBeenCalled();
	});

	it("rejects cancellation after execution-control reports a terminal run", async () => {
		const executionRuntime = runtime();
		executionRuntime.getRun.mockResolvedValue(durableRun({ status: "completed" }));
		const service = buildRuntimeRunService({ executionRuntime, store: runtimeStore() });

		await expect(
			service.cancel({
				principal: createPrincipal(),
				reason: "user_requested",
				requestId: "req_01HQ",
			}),
		).rejects.toMatchObject({ code: "request_already_terminal", status: 409 });
		expect(executionRuntime.cancelRun).not.toHaveBeenCalled();
	});

	it("keeps every phase pending when a failed run has no phase evidence", async () => {
		const executionRuntime = runtime();
		executionRuntime.getRun.mockResolvedValue(
			durableRun({
				completedAt: "2026-06-04T01:02:06.000Z",
				status: "failed",
				terminalReason: "execution_failed",
			}),
		);
		executionRuntime.listRunEvents.mockResolvedValue(
			eventPage([
				durableEvent({
					eventType: "run.failed",
					payload: {
						error: {
							code: "run_failed",
							message: "The request could not be completed.",
							retryable: false,
						},
						status: "failed",
						terminal_reason: "execution_failed",
					},
					sequence: 1,
				}),
			]),
		);
		const service = buildRuntimeRunService({ executionRuntime, store: runtimeStore() });

		await expect(
			service.listSteps({ principal: createPrincipal(), requestId: "req_01HQ" }),
		).resolves.toMatchObject({
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
	});

	it("does not complete earlier phases that were never observed", async () => {
		const executionRuntime = runtime();
		executionRuntime.getRun.mockResolvedValue(
			durableRun({
				completedAt: "2026-06-04T01:02:06.000Z",
				status: "failed",
				terminalReason: "execution_failed",
			}),
		);
		executionRuntime.listRunEvents.mockResolvedValue(
			eventPage([
				durableEvent({
					eventType: "run.answer_started",
					occurredAt: "2026-06-04T01:02:04.000Z",
					sequence: 1,
				}),
				durableEvent({
					eventType: "run.failed",
					occurredAt: "2026-06-04T01:02:06.000Z",
					payload: {
						error: {
							code: "run_failed",
							message: "The request could not be completed.",
							retryable: false,
						},
						status: "failed",
						terminal_reason: "execution_failed",
					},
					sequence: 2,
				}),
			]),
		);
		const service = buildRuntimeRunService({ executionRuntime, store: runtimeStore() });

		const result = await service.listSteps({
			principal: createPrincipal(),
			requestId: "req_01HQ",
		});

		expect(result.steps).toEqual([
			{ completedAt: null, durationMs: null, phase: "queued", startedAt: null, status: "pending" },
			{
				completedAt: null,
				durationMs: null,
				phase: "preparing",
				startedAt: null,
				status: "pending",
			},
			{
				completedAt: "2026-06-04T01:02:06.000Z",
				durationMs: 2_000,
				phase: "generating",
				startedAt: "2026-06-04T01:02:04.000Z",
				status: "failed",
			},
			{
				completedAt: null,
				durationMs: null,
				phase: "finalizing",
				startedAt: null,
				status: "pending",
			},
		]);
	});
});
