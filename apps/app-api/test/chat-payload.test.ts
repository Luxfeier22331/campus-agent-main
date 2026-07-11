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

	it("rejects internal locators instead of removing them", () => {
		expect(() =>
			sanitizePublicAssistantText({
				status: "completed",
				text: "回答 [student_rules:doc#chunk-001]",
			}),
		).toThrow(/leaked internal locator/i);
	});

	it("keeps public chat limited to conversation and prompt fields", () => {
		expect(() =>
			resolveValidatedPayload(
				{
					prompt: "校车几点发车？",
					requestedTool: "transport_schedule_lookup",
				},
				{ requestKind: "public_chat" },
			),
		).toThrow("requestedTool is not supported.");
	});

	it("normalizes trusted internal hints without owning runtime admission", () => {
		expect(
			resolveValidatedPayload(
				{
					prompt: "测试一个未开放工具",
					requestedTool: "unpublished_tool",
				},
				{ requestKind: "internal_eval" },
			),
		).toEqual({
			conversationId: null,
			prompt: "测试一个未开放工具",
			requestedScope: null,
			requestedTool: "unpublished_tool",
			versionQuery: null,
		});
	});
});
