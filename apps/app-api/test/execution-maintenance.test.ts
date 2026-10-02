import { expect, it, vi } from "vitest";
import { acceptChatCommand } from "../src/modules/runtime-command/service/acceptance";
import { createChatCommandServiceContext } from "../src/modules/runtime-command/service/context";
import {
	createCommandStore,
	createConversationStore,
	createExecutionRuntimeFromToolClient,
	createPrincipal,
} from "./chat-command.service.test-support";

it("rejects new answers before persistence while preserving accepted replay", async () => {
	const { store, acceptedWrites } = createCommandStore();
	const { store: conversationStore } = createConversationStore();
	const execute = vi.fn();
	const context = createChatCommandServiceContext({
		commandStore: store,
		abuseThrottleEnabled: false,
		observabilityStore: store,
		conversationStore,
		executionRuntime: createExecutionRuntimeFromToolClient({ execute }),
		executionMaintenance: true,
		safetyIdentifierHmacSecret: "test",
	});
	const input = {
		principal: createPrincipal(),
		idempotencyKey: "maintenance-test",
		payload: { prompt: "校园服务" },
	};
	await expect(acceptChatCommand(context, input)).rejects.toMatchObject({
		code: "execution_maintenance",
		status: 503,
	});
	expect(acceptedWrites).toHaveLength(0);
	expect(execute).not.toHaveBeenCalled();
	context.dependencies.executionMaintenance = false;
	const accepted = await acceptChatCommand(context, input);
	expect(accepted.kind).toBe("accepted");
	if (accepted.kind !== "accepted") {
		throw new Error("expected acceptance");
	}
	vi.mocked(store.findIdempotentRequest).mockResolvedValue({
		acceptedAt: accepted.value.acceptedAt,
		status: "accepted",
		requestFingerprintSha256: accepted.value.requestFingerprintSha256,
		response: { requestId: accepted.value.requestId },
	} as NonNullable<Awaited<ReturnType<typeof store.findIdempotentRequest>>>);
	context.dependencies.executionMaintenance = true;
	const replay = await acceptChatCommand(context, input);
	expect(replay.kind).toBe("accepted_replay");
	expect(acceptedWrites).toHaveLength(1);
});
