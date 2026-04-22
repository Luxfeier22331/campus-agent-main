import { describe, expect, it } from "vitest";

import runtimeSource from "../src/platform/chat/runtime.tsx?raw";

describe("public chat session bootstrap", () => {
	it("does not list effect events as reactive dependencies", () => {
		expect(runtimeSource).not.toContain("}, [refreshSession]);");
		expect(runtimeSource).not.toContain("}, [refreshConversations, session]);");
		expect(runtimeSource).not.toContain(
			"[conversations, historyError, historyLoading, refreshConversations, refreshSession, session],",
		);
		expect(runtimeSource).not.toContain("}, [conversationId, loadConversation]);");
	});
});
