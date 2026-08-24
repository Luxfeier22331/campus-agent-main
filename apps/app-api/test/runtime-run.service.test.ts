// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { ExecutionControlTransportError } from "../src/modules/integration";
import { buildRuntimeRunService } from "../src/modules/runtime-run";
import { createPrincipal } from "./chat-command.service.test-support";
import { durableRun, eventPage, runtimeStore } from "./runtime-run.test-support";

function runtime() {
	return {
		cancelRun: vi.fn().mockResolvedValue(durableRun({ status: "canceled" })),
		createRun: vi.fn(),
		getRun: vi.fn().mockResolvedValue(durableRun({ status: "queued" })),
		listRunEvents: vi.fn().mockResolvedValue(eventPage([])),
		listRunSteps: vi.fn().mockResolvedValue({ attempts: [], results: [], steps: [] }),
	};
}

describe("runtime run service", () => {
	it("reads status from execution-control for an accepted product run", async () => {
		const executionRuntime = runtime();
		const service = buildRuntimeRunService({ executionRuntime, store: runtimeStore() });

		await expect(
			service.getStatus({ principal: createPrincipal(), runId: "run_01HQ" }),
		).resolves.toMatchObject({ run: { phase: "queued", status: "queued" } });
		expect(executionRuntime.getRun).toHaveBeenCalledWith({
			runId: "run_01HQ",
			traceId: "trace_01HQ",
		});
	});

	it("cancels through execution-control without writing local cancellation state", async () => {
		const executionRuntime = runtime();
		const service = buildRuntimeRunService({ executionRuntime, store: runtimeStore() });

		await expect(
			service.cancel({
				principal: createPrincipal(),
				reason: "user_requested",
				runId: "run_01HQ",
			}),
		).resolves.toMatchObject({ run: { status: "canceled" } });
		expect(executionRuntime.cancelRun).toHaveBeenCalledWith({
			reason: "user_requested",
			runId: "run_01HQ",
			traceId: "trace_01HQ",
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
			service.getStatus({ principal: createPrincipal(), runId: "run_01HQ" }),
		).resolves.toMatchObject({ run: { status: "queued" } });
		expect(ensureRun).toHaveBeenCalledWith({ runId: "run_01HQ", traceId: "trace_01HQ" });
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
			service.getStatus({ principal: createPrincipal(), runId: "run_01HQ" }),
		).rejects.toBe(error);
		expect(ensureRun).not.toHaveBeenCalled();
	});

	it("rejects cancellation after execution-control reports a terminal run", async () => {
		const executionRuntime = runtime();
		executionRuntime.getRun.mockResolvedValue(durableRun({ status: "completed" }));
		const service = buildRuntimeRunService({ executionRuntime, store: runtimeStore() });

		await expect(
			service.cancel({ principal: createPrincipal(), reason: "user_requested", runId: "run_01HQ" }),
		).rejects.toMatchObject({ code: "run_already_terminal", status: 409 });
		expect(executionRuntime.cancelRun).not.toHaveBeenCalled();
	});
});
