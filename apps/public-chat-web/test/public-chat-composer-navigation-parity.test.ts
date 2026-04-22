import { describe, expect, it } from "vitest";

import activeChatSource from "../src/platform/chat/use-active-chat.tsx?raw";
import multimodalInputSource from "../vendor/vercel-ai-chatbot/components/chat/multimodal-input.tsx?raw";
import suggestedActionsSource from "../vendor/vercel-ai-chatbot/components/chat/suggested-actions.tsx?raw";

describe("public chat composer navigation parity", () => {
	it("pushes the repo chat route before first-turn submit instead of waiting for a server-owned redirect", () => {
		const routePush = ["await router.push(`/chat/", "${", "chatId", "}`);"].join("");
		const sendMessageCall = "void sendMessage({";

		expect(multimodalInputSource).toContain(routePush);
		expect(multimodalInputSource).toContain(sendMessageCall);
		expect(multimodalInputSource.indexOf(routePush)).toBeLessThan(
			multimodalInputSource.indexOf(sendMessageCall),
		);
	});

	it("binds new-chat submission to the active chat id instead of omitting conversation identity", () => {
		expect(activeChatSource).toContain(
			"const activeConversationId = conversationId ?? tempChatIdRef.current;",
		);
		expect(activeChatSource).toContain("conversationId: activeConversationId");
		expect(activeChatSource).not.toContain(
			"conversationId ? { conversationId, prompt: trimmedPrompt } : { prompt: trimmedPrompt }",
		);
		expect(activeChatSource).not.toContain(
			["await router.push(`/chat/", "${", "outcome.conversation.id", "}`)"].join(""),
		);
	});

	it("routes suggested actions through the same first-turn chat route ownership", () => {
		expect(suggestedActionsSource).toContain(
			["await router.push(`/chat/", "${", "chatId", "}`);"].join(""),
		);
		expect(suggestedActionsSource).toContain("void sendMessage({");
	});
});
