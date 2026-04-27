import { describe, expect, it } from "vitest";

import messageSource from "../vendor/vercel-ai-chatbot/components/chat/message.tsx?raw";

describe("vendor chat messages", () => {
	it("preserves assistant outcome semantics in the active vendor message chrome", () => {
		expect(messageSource).toContain(
			["data-testid={`message-", "${", "message.role", "}`}"].join(""),
		);
		expect(messageSource).toContain("MessageActions");
		expect(messageSource).toContain("MessageReasoning");
		expect(messageSource).toContain("ToolHeader");
		expect(messageSource).toContain("DocumentPreview");
		expect(messageSource).toContain('type === "data-place-card"');
		expect(messageSource).toContain('type === "data-source-cards"');
		expect(messageSource).toContain('type === "data-campus-service-trace-cards"');
		expect(messageSource).toContain("校区范围");
		expect(messageSource).toContain("位置说明");
		expect(messageSource).toContain("地标提示");
		expect(messageSource).toContain("通行提示");
		expect(messageSource).toContain("开放说明");
		expect(messageSource).toContain("信息来源");
		expect(messageSource).toContain("serviceTags");
		expect(messageSource).toContain("pointGeometry");
		expect(messageSource).toContain("参考来源");
		expect(messageSource).toContain("信息溯源");
		expect(messageSource).toContain("查看原文");
		expect(messageSource).not.toContain("Clarification needed");
		expect(messageSource).not.toContain("Needs more detail before answering.");
		expect(messageSource).not.toContain(
			"The current evidence does not support a grounded answer yet.",
		);
		expect(messageSource).not.toContain("You can retry this request.");
	});
});
