// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
	type ExecutionControlRuntimeClient,
	ExecutionControlTransportError,
	type ToolExecutionResponse,
} from "../src/modules/integration/execution-control";
import {
	buildChatCommandService,
	createCommandStore,
	createConversationStore,
	createDeterministicIdGenerator,
	createPrincipal,
	createTelemetryMock,
} from "./chat-command.service.test-support";

function executionRuntime(): ExecutionControlRuntimeClient {
	return {
		cancelRun: vi.fn(),
		createRun: vi.fn(),
		getRun: vi.fn(),
		listRunEvents: vi.fn(),
		listRunSteps: vi.fn(),
	};
}

function finalResponse(): ToolExecutionResponse {
	return {
		answerText: "国家奖学金每学年评审一次。",
		error: null,
		followUpQuestion: "",
		modelUsage: { cachedInputTokens: 10, inputTokens: 120, outputTokens: 42, totalTokens: 162 },
		result: null,
		status: "completed",
		traceId: "trace_0001",
	};
}

function submitPending(service: ReturnType<typeof buildChatCommandService>) {
	return service.submit({
		payload: { conversationId: "conv_01HQ", prompt: "奖学金多久评审一次？" },
		principal: createPrincipal(),
		requestKind: "public_chat",
	});
}

describe("chat command finalization replay", () => {
	it("binds remote finalization replay to fingerprint and completion time without duplicate telemetry", async () => {
		const { finalWrites, store } = createCommandStore();
		store.claimAdmission = vi.fn(async () => false);
		const { store: conversationStore } = createConversationStore();
		const telemetry = createTelemetryMock();
		const service = buildChatCommandService({
			conversationStore,
			executionRuntime: executionRuntime(),
			generateId: createDeterministicIdGenerator(),
			store,
			telemetry,
		});
		await expect(submitPending(service)).rejects.toMatchObject({ code: "admission_pending" });
		const input = {
			completedAt: "2026-06-04T01:02:06.000Z",
			finalizationFingerprint: "finalization-01",
			response: finalResponse(),
			runId: "run_0001",
		};

		await expect(service.applyProductFinalization?.(input)).resolves.toEqual({
			outcome: "applied",
		});
		await expect(service.applyProductFinalization?.(input)).resolves.toEqual({
			outcome: "replayed",
		});

		expect(finalWrites).toHaveLength(1);
		expect(finalWrites[0]?.durableAdmissionConfirmed).toBe(true);
		expect(telemetry.configureRequestOutcome).toHaveBeenCalledTimes(1);
		await expect(
			service.applyProductFinalization?.({
				...input,
				completedAt: "2026-06-04T01:02:07.000Z",
			}),
		).rejects.toMatchObject({ name: "ChatFinalizationConflict" });
	});

	it("replays local cancellation only for the original requested time", async () => {
		const { finalWrites, store } = createCommandStore();
		store.claimAdmission = vi.fn(async () => false);
		const { store: conversationStore } = createConversationStore();
		const telemetry = createTelemetryMock();
		const service = buildChatCommandService({
			conversationStore,
			executionRuntime: executionRuntime(),
			generateId: createDeterministicIdGenerator(),
			store,
			telemetry,
		});
		await expect(submitPending(service)).rejects.toMatchObject({ code: "admission_pending" });
		const input = {
			completedAt: "2026-06-04T01:02:06.000Z",
			runId: "run_0001",
		};

		await expect(service.finalizeLocalCancellation?.(input)).resolves.toEqual({
			outcome: "applied",
		});
		await expect(service.finalizeLocalCancellation?.(input)).resolves.toEqual({
			outcome: "replayed",
		});

		expect(finalWrites).toHaveLength(1);
		expect(finalWrites[0]?.durableAdmissionConfirmed).toBe(false);
		expect(telemetry.configureRequestOutcome).toHaveBeenCalledTimes(1);
		await expect(
			service.finalizeLocalCancellation?.({
				...input,
				completedAt: "2026-06-04T01:02:07.000Z",
			}),
		).rejects.toMatchObject({ name: "ChatFinalizationConflict" });
	});

	it("replays an admission failure with its recorded completion time and no duplicate telemetry", async () => {
		const { finalWrites, frozenAdmissions, store } = createCommandStore();
		store.claimAdmission = vi.fn(async () => false);
		const runtime = executionRuntime();
		vi.mocked(runtime.createRun).mockRejectedValue(
			new ExecutionControlTransportError({
				code: "invalid_request",
				message: "Invalid admission input.",
				retryable: false,
				status: 400,
			}),
		);
		const { store: conversationStore } = createConversationStore();
		const telemetry = createTelemetryMock();
		const service = buildChatCommandService({
			conversationStore,
			executionRuntime: runtime,
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-06-04T01:02:06.000Z"),
			store,
			telemetry,
		});
		await expect(submitPending(service)).rejects.toMatchObject({ code: "admission_pending" });
		const frozen = frozenAdmissions[0];
		if (!frozen) {
			throw new Error("expected frozen admission");
		}
		store.claimAdmission = vi.fn(async () => true);
		store.listPendingAdmissions = vi.fn(async () => [
			{
				admissionInputJson: frozen.admissionInputJson,
				admissionInputSha256: frozen.admissionInputSha256,
				requestId: "req_0001",
				runId: "run_0001",
				workflowId: "campus-agent.chat.run_0001",
			},
		]);

		await expect(service.dispatchPendingAdmissions?.()).resolves.toMatchObject({ failed: 1 });
		await expect(service.dispatchPendingAdmissions?.()).resolves.toMatchObject({ failed: 1 });

		expect(finalWrites).toHaveLength(1);
		expect(finalWrites[0]?.durableAdmissionConfirmed).toBe(false);
		expect(telemetry.configureRequestOutcome).toHaveBeenCalledTimes(1);
	});
});
