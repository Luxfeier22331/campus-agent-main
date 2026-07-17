// @vitest-environment node

import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type {
	ExecutionControlRun,
	ExecutionControlRuntimeClient,
} from "../src/modules/integration";
import { dispatchPendingChatAdmissions } from "../src/modules/runtime-command";
import type { ChatCommandStore } from "../src/modules/runtime-command/store-types";

function durableRun(): ExecutionControlRun {
	return {
		admittedAt: "2026-07-15T08:00:00.000Z",
		completedAt: "",
		conversationId: "conv_1",
		createdAt: "2026-07-15T08:00:00.000Z",
		failCloseReason: "",
		finalResponseRef: "",
		ownerUserId: "user_1",
		queuedAt: "2026-07-15T08:00:00.000Z",
		requestId: "req_1",
		requestedTool: "",
		runId: "run_1",
		selectedTool: "",
		startedAt: "",
		status: "queued",
		streamingStartedAt: "",
		surface: "campus_web",
		taskQueue: "campus-agent.workflow",
		terminalReason: "",
		traceId: "trace_1",
		turnId: "turn_1",
		updatedAt: "2026-07-15T08:00:00.000Z",
	};
}

describe("chat admission dispatcher", () => {
	it("replays only the frozen input and marks deterministic admission", async () => {
		const workflowInput = {
			conversationId: "conv_1",
			metadata: {},
			ownerUserId: "user_1",
			requestId: "req_1",
			runId: "run_1",
			surface: "campus_web",
			traceId: "trace_1",
			turnId: "turn_1",
		};
		const workflowInputSha256 = createHash("sha256")
			.update(JSON.stringify(workflowInput), "utf8")
			.digest("hex");
		const markAdmitted = vi.fn(async () => true);
		const store = {
			listPendingAdmissions: vi.fn(async () => [
				{
					requestId: "req_1",
					workflowId: "campus-agent.chat.run_1",
					workflowInput,
					workflowInputSha256,
				},
			]),
			markAdmitted,
		} as unknown as ChatCommandStore;
		const createRun = vi.fn(async () => durableRun());
		const executionRuntime = { createRun } as unknown as ExecutionControlRuntimeClient;

		await expect(dispatchPendingChatAdmissions({ executionRuntime, store })).resolves.toEqual({
			admitted: 1,
			failed: 0,
			processed: 1,
		});
		expect(createRun).toHaveBeenCalledWith(workflowInput);
		expect(markAdmitted).toHaveBeenCalledWith({
			admittedAt: "2026-07-15T08:00:00.000Z",
			requestId: "req_1",
			workflowId: "campus-agent.chat.run_1",
		});
	});

	it("fails closed when the frozen input hash does not match", async () => {
		const store = {
			listPendingAdmissions: vi.fn(async () => [
				{
					requestId: "req_1",
					workflowId: "campus-agent.chat.run_1",
					workflowInput: { runId: "run_1" },
					workflowInputSha256: "wrong",
				},
			]),
			markAdmitted: vi.fn(),
		} as unknown as ChatCommandStore;
		const createRun = vi.fn();
		const executionRuntime = { createRun } as unknown as ExecutionControlRuntimeClient;

		await expect(dispatchPendingChatAdmissions({ executionRuntime, store })).resolves.toEqual({
			admitted: 0,
			failed: 1,
			processed: 1,
		});
		expect(createRun).not.toHaveBeenCalled();
		expect(store.markAdmitted).not.toHaveBeenCalled();
	});
});
