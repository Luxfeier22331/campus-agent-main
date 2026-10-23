import { describe, expect, it } from "vitest";
import { RunOperationMachine } from "../src/features/conversation/run-operation-machine";

describe("conversation run operation machine", () => {
	it("allows one automatic resume per request across operations", () => {
		const machine = new RunOperationMachine();
		expect(machine.claimAutomaticResume("req_one")).toBe(true);
		machine.start();
		expect(machine.claimAutomaticResume("req_one")).toBe(false);
		expect(machine.claimAutomaticResume("req_two")).toBe(true);
	});

	it("does not carry a recovery lock into a new operation", () => {
		const machine = new RunOperationMachine();
		machine.recovering = true;
		machine.start();
		expect(machine.recovering).toBe(false);
		machine.recovering = true;
		machine.begin();
		expect(machine.recovering).toBe(false);
		machine.recovering = true;
		machine.invalidate();
		expect(machine.recovering).toBe(false);
	});
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
		machine.activeRun = { requestId: "req" };
		machine.cancellation = { operationId: operation.id, phase: "awaiting_request_id" };

		machine.invalidate();

		expect(operation.controller.signal.aborted).toBe(true);
		expect(machine.activeRun).toBeNull();
		expect(machine.cancellation).toEqual({ phase: "idle" });
		expect(machine.controller).toBeNull();
	});
});
