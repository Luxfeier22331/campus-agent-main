import { describe, expect, it } from "vitest";
import { RunOperationMachine } from "../src/features/conversation/run-operation-machine";

describe("conversation run operation machine", () => {
	it("owns only the latest operation and aborts the previous controller", () => {
		const machine = new RunOperationMachine();
		const first = machine.start();
		const second = machine.start();

		expect(first.controller.signal.aborted).toBe(true);
		expect(machine.ownedBy(first)).toBe(false);
		expect(machine.ownedBy(second)).toBe(true);
	});

	it("invalidates active state atomically", () => {
		const machine = new RunOperationMachine();
		const operation = machine.start();
		machine.activeRun = { requestId: "req", runId: "run", traceId: "trace" };
		machine.cancellation = { operationId: operation.id, phase: "awaiting_run_id" };

		machine.invalidate();

		expect(operation.controller.signal.aborted).toBe(true);
		expect(machine.activeRun).toBeNull();
		expect(machine.cancellation).toEqual({ phase: "idle" });
		expect(machine.controller).toBeNull();
	});
});
