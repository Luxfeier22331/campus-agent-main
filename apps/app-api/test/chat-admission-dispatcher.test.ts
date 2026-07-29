// @vitest-environment node

import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type {
	ExecutionControlRun,
	ExecutionControlRuntimeClient,
} from "../src/modules/integration";
import { ExecutionControlTransportError } from "../src/modules/integration";
import { dispatchPendingChatAdmissions } from "../src/modules/runtime-command";
import type { ChatCommandStore } from "../src/modules/runtime-command/store-types";

function durableRun(overrides: Partial<ExecutionControlRun> = {}): ExecutionControlRun {
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
		runId: "run_1",
		startedAt: "",
		status: "queued",
		streamingStartedAt: "",
		surface: "campus_web",
		taskQueue: "campus-agent.workflow",
		terminalReason: "",
		traceId: "trace_1",
		turnId: "turn_1",
		updatedAt: "2026-07-15T08:00:00.000Z",
		...overrides,
	};
}

type AdmissionDispatchInput = Parameters<typeof dispatchPendingChatAdmissions>[0];

function dispatchAdmissions(
	input: Omit<AdmissionDispatchInput, "finalizeAdmissionFailure"> & {
		finalizeAdmissionFailure?: AdmissionDispatchInput["finalizeAdmissionFailure"];
	},
) {
	const { finalizeAdmissionFailure = vi.fn(async () => undefined), ...rest } = input;
	return dispatchPendingChatAdmissions({ ...rest, finalizeAdmissionFailure });
}

function pendingAdmissionCandidate(workflowInput: Record<string, unknown>) {
	const admissionInputJson = JSON.stringify(workflowInput);
	return {
		admissionInputJson,
		admissionInputSha256: createHash("sha256").update(admissionInputJson, "utf8").digest("hex"),
		requestId: "req_1",
		runId: "run_1",
		workflowId: "campus-agent.chat.run_1",
	};
}

describe("chat admission dispatcher", () => {
	it("replays only the frozen input and marks deterministic admission", async () => {
		const workflowInput = {
			conversationId: "conv_1",
			metadata: {},
			ownerUserId: "user_1",
			personalMemoryRecallAllowed: false,
			requestId: "req_1",
			runId: "run_1",
			surface: "campus_web",
			traceId: "trace_1",
			turnId: "turn_1",
		};
		const admissionInputJson = JSON.stringify(workflowInput);
		const admissionInputSha256 = createHash("sha256")
			.update(admissionInputJson, "utf8")
			.digest("hex");
		const markAdmitted = vi.fn(async () => true);
		const store = {
			claimAdmission: vi.fn(async () => true),
			listPendingAdmissions: vi.fn(async () => [
				{
					admissionInputJson,
					admissionInputSha256,
					requestId: "req_1",
					runId: "run_1",
					workflowId: "campus-agent.chat.run_1",
				},
			]),
			markAdmitted,
			releaseAdmission: vi.fn(async () => true),
		} as unknown as ChatCommandStore;
		const createRun = vi.fn(async () => durableRun());
		const executionRuntime = { createRun } as unknown as ExecutionControlRuntimeClient;

		await expect(dispatchAdmissions({ executionRuntime, store })).resolves.toEqual({
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
			claimAdmission: vi.fn(async () => true),
			listPendingAdmissions: vi.fn(async () => [
				{
					admissionInputJson: '{"runId":"run_1"}',
					admissionInputSha256: "wrong",
					requestId: "req_1",
					runId: "run_1",
					workflowId: "campus-agent.chat.run_1",
				},
			]),
			markAdmitted: vi.fn(),
			releaseAdmission: vi.fn(async () => true),
		} as unknown as ChatCommandStore;
		const createRun = vi.fn();
		const executionRuntime = { createRun } as unknown as ExecutionControlRuntimeClient;
		const finalizeAdmissionFailure = vi.fn(async () => undefined);

		await expect(
			dispatchAdmissions({ executionRuntime, finalizeAdmissionFailure, store }),
		).resolves.toEqual({
			admitted: 0,
			failed: 1,
			processed: 1,
		});
		expect(createRun).not.toHaveBeenCalled();
		expect(store.markAdmitted).not.toHaveBeenCalled();
		expect(store.releaseAdmission).not.toHaveBeenCalled();
		expect(finalizeAdmissionFailure).toHaveBeenCalledWith({
			errorCode: "runtime_invariant_failed",
			requestId: "req_1",
			runId: "run_1",
			workflowId: "campus-agent.chat.run_1",
		});
	});

	it("does not start a run when cancellation wins the admission claim", async () => {
		const admissionInputJson = '{"runId":"run_1"}';
		const store = {
			claimAdmission: vi.fn(async () => false),
			listPendingAdmissions: vi.fn(async () => [
				{
					admissionInputJson,
					admissionInputSha256: createHash("sha256")
						.update(admissionInputJson, "utf8")
						.digest("hex"),
					requestId: "req_1",
					runId: "run_1",
					workflowId: "campus-agent.chat.run_1",
				},
			]),
			markAdmitted: vi.fn(),
			releaseAdmission: vi.fn(),
		} as unknown as ChatCommandStore;
		const createRun = vi.fn();
		const finalizeAdmissionFailure = vi.fn(async () => undefined);

		await expect(
			dispatchAdmissions({
				executionRuntime: { createRun } as unknown as ExecutionControlRuntimeClient,
				finalizeAdmissionFailure,
				store,
			}),
		).resolves.toEqual({ admitted: 0, failed: 0, processed: 1 });
		expect(createRun).not.toHaveBeenCalled();
		expect(finalizeAdmissionFailure).not.toHaveBeenCalled();
	});

	it("recovers a lost app-api admission fence from the idempotent run", async () => {
		const workflowInput = {
			conversationId: "conv_1",
			metadata: {},
			ownerUserId: "user_1",
			personalMemoryRecallAllowed: false,
			requestId: "req_1",
			runId: "run_1",
			surface: "campus_web",
			traceId: "trace_1",
			turnId: "turn_1",
		};
		const admissionInputJson = JSON.stringify(workflowInput);
		const markAdmitted = vi
			.fn(async () => false)
			.mockResolvedValueOnce(false)
			.mockResolvedValueOnce(true);
		const getRun = vi.fn(async () => durableRun());
		const releaseAdmission = vi.fn(async () => true);
		const store = {
			claimAdmission: vi.fn(async () => true),
			listPendingAdmissions: vi.fn(async () => [
				{
					admissionInputJson,
					admissionInputSha256: createHash("sha256")
						.update(admissionInputJson, "utf8")
						.digest("hex"),
					requestId: "req_1",
					runId: "run_1",
					workflowId: "campus-agent.chat.run_1",
				},
			]),
			markAdmitted,
			releaseAdmission,
		} as unknown as ChatCommandStore;
		const createRun = vi.fn(async () => durableRun());

		await expect(
			dispatchAdmissions({
				executionRuntime: { createRun, getRun } as unknown as ExecutionControlRuntimeClient,
				store,
			}),
		).resolves.toEqual({ admitted: 1, failed: 0, processed: 1 });
		expect(createRun).toHaveBeenCalledOnce();
		expect(getRun).toHaveBeenCalledWith({
			runId: "run_1",
			traceId: "trace_1",
		});
		expect(markAdmitted).toHaveBeenCalledTimes(2);
		expect(releaseAdmission).not.toHaveBeenCalled();
	});

	it("recovers when the first admission mark throws after committing", async () => {
		const workflowInput = {
			conversationId: "conv_1",
			metadata: {},
			ownerUserId: "user_1",
			personalMemoryRecallAllowed: false,
			requestId: "req_1",
			runId: "run_1",
			surface: "campus_web",
			traceId: "trace_1",
			turnId: "turn_1",
		};
		const admissionInputJson = JSON.stringify(workflowInput);
		const markAdmitted = vi
			.fn()
			.mockRejectedValueOnce(new Error("mark response lost"))
			.mockResolvedValueOnce(true);
		const getRun = vi.fn(async () => durableRun());
		const releaseAdmission = vi.fn(async () => true);
		const store = {
			claimAdmission: vi.fn(async () => true),
			listPendingAdmissions: vi.fn(async () => [
				{
					admissionInputJson,
					admissionInputSha256: createHash("sha256")
						.update(admissionInputJson, "utf8")
						.digest("hex"),
					requestId: "req_1",
					runId: "run_1",
					workflowId: "campus-agent.chat.run_1",
				},
			]),
			markAdmitted,
			releaseAdmission,
		} as unknown as ChatCommandStore;

		await expect(
			dispatchAdmissions({
				executionRuntime: {
					createRun: vi.fn(async () => durableRun()),
					getRun,
				} as unknown as ExecutionControlRuntimeClient,
				store,
			}),
		).resolves.toEqual({ admitted: 1, failed: 0, processed: 1 });
		expect(getRun).toHaveBeenCalledOnce();
		expect(markAdmitted).toHaveBeenCalledTimes(2);
		expect(releaseAdmission).not.toHaveBeenCalled();
	});

	it("recovers a lost create response before marking admission", async () => {
		const workflowInput = {
			conversationId: "conv_1",
			metadata: {},
			ownerUserId: "user_1",
			personalMemoryRecallAllowed: false,
			requestId: "req_1",
			runId: "run_1",
			surface: "campus_web",
			traceId: "trace_1",
			turnId: "turn_1",
		};
		const admissionInputJson = JSON.stringify(workflowInput);
		const markAdmitted = vi.fn(async () => true);
		const getRun = vi.fn(async () => durableRun());
		const releaseAdmission = vi.fn(async () => true);
		const store = {
			claimAdmission: vi.fn(async () => true),
			listPendingAdmissions: vi.fn(async () => [
				{
					admissionInputJson,
					admissionInputSha256: createHash("sha256")
						.update(admissionInputJson, "utf8")
						.digest("hex"),
					requestId: "req_1",
					runId: "run_1",
					workflowId: "campus-agent.chat.run_1",
				},
			]),
			markAdmitted,
			releaseAdmission,
		} as unknown as ChatCommandStore;
		const createRun = vi.fn().mockRejectedValue(
			new ExecutionControlTransportError({
				code: "execution_timeout",
				message: "Execution control timed out.",
				retryable: true,
				status: 504,
			}),
		);

		await expect(
			dispatchAdmissions({
				executionRuntime: { createRun, getRun } as unknown as ExecutionControlRuntimeClient,
				store,
			}),
		).resolves.toEqual({ admitted: 1, failed: 0, processed: 1 });
		expect(getRun).toHaveBeenCalledOnce();
		expect(markAdmitted).toHaveBeenCalledOnce();
		expect(releaseAdmission).not.toHaveBeenCalled();
	});

	it("keeps dispatching when the recovered run identity is inconsistent", async () => {
		const admissionInputJson = JSON.stringify({
			conversationId: "conv_1",
			metadata: {},
			ownerUserId: "user_1",
			personalMemoryRecallAllowed: false,
			requestId: "req_1",
			runId: "run_1",
			surface: "campus_web",
			traceId: "trace_1",
			turnId: "turn_1",
		});
		const store = {
			claimAdmission: vi.fn(async () => true),
			listPendingAdmissions: vi.fn(async () => [
				{
					admissionInputJson,
					admissionInputSha256: createHash("sha256")
						.update(admissionInputJson, "utf8")
						.digest("hex"),
					requestId: "req_1",
					runId: "run_1",
					workflowId: "campus-agent.chat.run_1",
				},
			]),
			markAdmitted: vi.fn(),
			releaseAdmission: vi.fn(async () => true),
		} as unknown as ChatCommandStore;
		const createRun = vi.fn(async () => durableRun({ requestId: "other_request" }));
		const finalizeAdmissionFailure = vi.fn(async () => undefined);

		await expect(
			dispatchAdmissions({
				executionRuntime: { createRun } as unknown as ExecutionControlRuntimeClient,
				finalizeAdmissionFailure,
				store,
			}),
		).resolves.toEqual({ admitted: 0, failed: 1, processed: 1 });
		expect(store.markAdmitted).not.toHaveBeenCalled();
		expect(store.releaseAdmission).not.toHaveBeenCalled();
		expect(finalizeAdmissionFailure).toHaveBeenCalledWith({
			errorCode: "admission_identity_conflict",
			requestId: "req_1",
			runId: "run_1",
			workflowId: "campus-agent.chat.run_1",
		});
	});

	it("does not release a claimed fence when lost-create recovery finds another run", async () => {
		const workflowInput = {
			conversationId: "conv_1",
			metadata: {},
			ownerUserId: "user_1",
			personalMemoryRecallAllowed: false,
			requestId: "req_1",
			runId: "run_1",
			surface: "campus_web",
			traceId: "trace_1",
			turnId: "turn_1",
		};
		const admissionInputJson = JSON.stringify(workflowInput);
		const releaseAdmission = vi.fn(async () => true);
		const store = {
			claimAdmission: vi.fn(async () => true),
			listPendingAdmissions: vi.fn(async () => [
				{
					admissionInputJson,
					admissionInputSha256: createHash("sha256")
						.update(admissionInputJson, "utf8")
						.digest("hex"),
					requestId: "req_1",
					runId: "run_1",
					workflowId: "campus-agent.chat.run_1",
				},
			]),
			markAdmitted: vi.fn(),
			releaseAdmission,
		} as unknown as ChatCommandStore;
		const createRun = vi.fn().mockRejectedValue(
			new ExecutionControlTransportError({
				code: "execution_timeout",
				message: "Execution control timed out.",
				retryable: true,
				status: 504,
			}),
		);
		const getRun = vi.fn(async () => durableRun({ requestId: "other_request" }));
		const finalizeAdmissionFailure = vi.fn(async () => undefined);

		await expect(
			dispatchAdmissions({
				executionRuntime: { createRun, getRun } as unknown as ExecutionControlRuntimeClient,
				finalizeAdmissionFailure,
				store,
			}),
		).resolves.toEqual({ admitted: 0, failed: 1, processed: 1 });
		expect(store.markAdmitted).not.toHaveBeenCalled();
		expect(releaseAdmission).not.toHaveBeenCalled();
		expect(finalizeAdmissionFailure).toHaveBeenCalledWith({
			errorCode: "admission_identity_conflict",
			requestId: "req_1",
			runId: "run_1",
			workflowId: "campus-agent.chat.run_1",
		});
	});

	it("finalizes deterministic create rejection without reopening the claim", async () => {
		const workflowInput = {
			conversationId: "conv_1",
			metadata: {},
			ownerUserId: "user_1",
			personalMemoryRecallAllowed: false,
			requestId: "req_1",
			runId: "run_1",
			surface: "campus_web",
			traceId: "trace_1",
			turnId: "turn_1",
		};
		const releaseAdmission = vi.fn(async () => true);
		const store = {
			claimAdmission: vi.fn(async () => true),
			listPendingAdmissions: vi.fn(async () => [pendingAdmissionCandidate(workflowInput)]),
			markAdmitted: vi.fn(),
			releaseAdmission,
		} as unknown as ChatCommandStore;
		const finalizeAdmissionFailure = vi.fn(async () => undefined);
		const createRun = vi.fn().mockRejectedValue(
			new ExecutionControlTransportError({
				code: "invalid_request",
				message: "Invalid admission input.",
				retryable: false,
				status: 400,
			}),
		);

		await expect(
			dispatchAdmissions({
				executionRuntime: { createRun } as unknown as ExecutionControlRuntimeClient,
				finalizeAdmissionFailure,
				store,
			}),
		).resolves.toEqual({ admitted: 0, failed: 1, processed: 1 });
		expect(finalizeAdmissionFailure).toHaveBeenCalledWith({
			errorCode: "invalid_request",
			requestId: "req_1",
			runId: "run_1",
			workflowId: "campus-agent.chat.run_1",
		});
		expect(releaseAdmission).not.toHaveBeenCalled();
	});

	it("releases unknown create failures for idempotent retry", async () => {
		const workflowInput = {
			conversationId: "conv_1",
			metadata: {},
			ownerUserId: "user_1",
			personalMemoryRecallAllowed: false,
			requestId: "req_1",
			runId: "run_1",
			surface: "campus_web",
			traceId: "trace_1",
			turnId: "turn_1",
		};
		const releaseAdmission = vi.fn(async () => true);
		const store = {
			claimAdmission: vi.fn(async () => true),
			listPendingAdmissions: vi.fn(async () => [pendingAdmissionCandidate(workflowInput)]),
			markAdmitted: vi.fn(),
			releaseAdmission,
		} as unknown as ChatCommandStore;
		const finalizeAdmissionFailure = vi.fn(async () => undefined);

		await expect(
			dispatchAdmissions({
				executionRuntime: {
					createRun: vi.fn().mockRejectedValue(new Error("connection reset")),
				} as unknown as ExecutionControlRuntimeClient,
				finalizeAdmissionFailure,
				store,
			}),
		).resolves.toEqual({ admitted: 0, failed: 1, processed: 1 });
		expect(releaseAdmission).toHaveBeenCalledOnce();
		expect(finalizeAdmissionFailure).not.toHaveBeenCalled();
	});

	it("keeps the dispatching claim when product finalization fails", async () => {
		const workflowInput = {
			conversationId: "conv_1",
			metadata: {},
			ownerUserId: "user_1",
			personalMemoryRecallAllowed: false,
			requestId: "req_1",
			runId: "run_1",
			surface: "campus_web",
			traceId: "trace_1",
			turnId: "turn_1",
		};
		const releaseAdmission = vi.fn(async () => true);
		const store = {
			claimAdmission: vi.fn(async () => true),
			listPendingAdmissions: vi.fn(async () => [pendingAdmissionCandidate(workflowInput)]),
			markAdmitted: vi.fn(),
			releaseAdmission,
		} as unknown as ChatCommandStore;
		const finalizeAdmissionFailure = vi.fn().mockRejectedValue(new Error("write response lost"));

		await expect(
			dispatchAdmissions({
				executionRuntime: {
					createRun: vi.fn().mockRejectedValue(
						new ExecutionControlTransportError({
							code: "invalid_request",
							message: "Invalid admission input.",
							retryable: false,
							status: 400,
						}),
					),
				} as unknown as ExecutionControlRuntimeClient,
				finalizeAdmissionFailure,
				store,
			}),
		).resolves.toEqual({ admitted: 0, failed: 1, processed: 1 });
		expect(finalizeAdmissionFailure).toHaveBeenCalledOnce();
		expect(releaseAdmission).not.toHaveBeenCalled();
	});
});
