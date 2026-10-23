import { describe, expect, it } from "vitest";

import {
	resolveValidatedPayload,
	sanitizePublicAssistantText,
} from "../src/modules/runtime-command/service/normalize";

describe("chat payload boundary", () => {
	it("validates public assistant text without rewriting it", () => {
		const text = "  第一段。\n\n第二段保留原始排版。  ";
		expect(sanitizePublicAssistantText({ status: "completed", text })).toBe(text);
	});

	it("does not classify ordinary answer text as an internal locator", () => {
		const text = "回答 ticket:ABC-123。";
		expect(sanitizePublicAssistantText({ status: "completed", text })).toBe(text);
	});

	it("keeps public chat limited to conversation and prompt fields", () => {
		expect(() =>
			resolveValidatedPayload({
				prompt: "缓考需要什么材料？",
				requestedTool: "knowledge_query",
			} as never),
		).toThrow("requestedTool is not supported.");
	});

	it("uses the same route-free payload for internal evaluation", () => {
		expect(
			resolveValidatedPayload({
				prompt: "测试一个未开放工具",
			}),
		).toEqual({
			conversationId: null,
			prompt: "测试一个未开放工具",
		});
	});
});
