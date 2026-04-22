import { describe, expect, it } from "vitest";

import runtimeSource from "../src/platform/chat/runtime.tsx?raw";
import activeChatSource from "../src/platform/chat/use-active-chat.tsx?raw";

describe("public chat post-submit history refresh", () => {
	it("revalidates donor sidebar history after a successful chat submit", () => {
		expect(activeChatSource).toContain("mutate(getSerializedChatHistoryKey())");
	});

	it("does not keep a parallel shell conversation cache beside the donor sidebar history", () => {
		expect(runtimeSource).not.toContain("conversations:");
		expect(runtimeSource).not.toContain("historyError:");
		expect(runtimeSource).not.toContain("historyLoading:");
		expect(runtimeSource).not.toContain("refreshConversations:");
		expect(runtimeSource).not.toContain("upsertConversationSummary");
		expect(runtimeSource).not.toContain("listShellConversations");
	});
});
