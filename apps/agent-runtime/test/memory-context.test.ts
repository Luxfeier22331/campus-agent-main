import { describe, expect, it } from "vitest";
import { formatMemoryRecall } from "../src/memory-context.ts";

describe("memory context presentation", () => {
	it.each([
		{ facts: [], budget: 2500, text: "" },
		{
			facts: [" 喜欢安静😀 ", "偏好晚间"],
			budget: 2500,
			text: "用户记忆:\n相关事实:\n- 喜欢安静😀\n- 偏好晚间",
		},
		{ facts: ["😀"], budget: 16, text: "用户记忆:\n相关事实:\n- 😀" },
		{ facts: ["😀"], budget: 15, text: "用户记忆:\n相关事实:" },
		{ facts: ["这一整条事实超出预算", "短"], budget: 16, text: "用户记忆:\n相关事实:\n- 短" },
		{ facts: ["事实"], budget: 1, text: "用户记忆:" },
	])("preserves whole-line codepoint budgeting: $facts / $budget", ({ facts, budget, text }) => {
		expect(formatMemoryRecall({ facts, context_char_budget: budget })).toEqual({
			outcome: facts.length > 0 ? "matched" : "no_match",
			memory_text: text,
		});
	});
	it.each([
		null,
		{},
		{ outcome: "matched", memory_text: "legacy" },
		{ facts: [1], context_char_budget: 20 },
		{ facts: [], context_char_budget: 0 },
		{ facts: [], context_char_budget: 1.5 },
	])("rejects invalid internal responses: %j", (response) => {
		expect(() => formatMemoryRecall(response)).toThrow(
			expect.objectContaining({ code: "tool_contract_mismatch" }),
		);
	});
});
