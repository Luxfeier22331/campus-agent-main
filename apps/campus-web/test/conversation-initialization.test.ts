import { describe, expect, it, vi } from "vitest";
import { ConversationInitializationRegistry } from "../src/features/conversation/conversation-initialization";

describe("conversation initialization registry", () => {
	it("deduplicates initialization and transfers operation ownership", async () => {
		const registry = new ConversationInitializationRegistry();
		const initialize = vi.fn(async () => ({ remoteId: "conversation-1" }));
		const target = { deleteThread: vi.fn(), initialize, threadId: "thread-1" };

		const first = registry.getOrCreate(target, 1);
		const second = registry.getOrCreate(target, 2);

		expect(first).toBe(second);
		expect(await second.initializeTask).toBe("conversation-1");
		expect(initialize).toHaveBeenCalledOnce();
		expect(registry.ownedBy("thread-1", second, 1)).toBe(false);
		expect(registry.ownedBy("thread-1", second, 2)).toBe(true);
	});
});
