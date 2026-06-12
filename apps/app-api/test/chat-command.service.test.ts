// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
	buildChatCommandService,
	createCommandStore,
	createConversationStore,
	createDeterministicIdGenerator,
	createPrincipal,
} from "./chat-command.service.test-support";

describe("chat command service", () => {
	it("fails closed instead of using a legacy direct execution path", async () => {
		const { store, acceptedWrites, finalWrites } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const legacySupervisor = {
			execute: vi.fn(),
			executeStream: vi.fn(),
		};
		const service = buildChatCommandService({
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-06-06T00:00:00.000Z"),
			conversationStore,
			store,
		});

		await expect(
			service.submit({
				payload: {
					conversationId: "conv_01HQ",
					prompt: "图书馆开放到几点？",
				},
				principal: createPrincipal(),
				surface: "public_chat_web",
			}),
		).rejects.toMatchObject({
			code: "execution_runtime_required",
			retryable: true,
			status: 503,
		});
		expect(legacySupervisor.execute).not.toHaveBeenCalled();
		expect(legacySupervisor.executeStream).not.toHaveBeenCalled();
		expect(acceptedWrites).toHaveLength(1);
		expect(finalWrites).toHaveLength(0);
	});
});
