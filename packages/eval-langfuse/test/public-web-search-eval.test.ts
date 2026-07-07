import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
	loadPublicWebSearchEvalAsset,
	validatePublicWebSearchEvalAsset,
} from "../src/public-web-search-eval";

const repoRoot = resolve(import.meta.dirname, "../../..");

describe("public web search agent eval asset", () => {
	it("validates the tracked asset as an agent routing and source-use eval asset", () => {
		const result = loadPublicWebSearchEvalAsset(
			resolve(
				repoRoot,
				"packages/eval-langfuse/assets/datasets/agent/public_web_search/agent_cases.v1.json",
			),
		);

		expect(result.case_count).toBe(8);
		expect(result.expected_tool_counts).toMatchObject({
			direct_answer: 2,
			knowledge_query: 2,
			public_web_search: 4,
		});
		expect(result.eval_kinds).toEqual([
			"routing_tool_selection",
			"source_quality",
			"answer_grounding",
		]);
	});

	it("rejects external or private expected urls", () => {
		expect(() =>
			validatePublicWebSearchEvalAsset({
				cases: [
					{
						case_id: "bad-url",
						expected_tool: "public_web_search",
						min_sources: 1,
						query: "校园网密码怎么改",
						required_allowed_url_patterns: ["https://example.com/info"],
						required_answer_facts: ["说明校园网密码处理入口"],
					},
				],
				eval_kinds: ["routing_tool_selection", "source_quality", "answer_grounding"],
				schema_version: "public_web_search_agent_eval.v1",
			}),
		).toThrow("expected url pattern must stay under public HTTPS muc.edu.cn");
	});

	it("rejects non-agent tool names", () => {
		expect(() =>
			validatePublicWebSearchEvalAsset({
				cases: [
					{
						case_id: "bad-tool",
						expected_tool: "ragas",
						min_sources: 0,
						query: "校园网密码怎么改",
						required_allowed_url_patterns: [],
						required_answer_facts: [],
					},
				],
				eval_kinds: ["routing_tool_selection"],
				schema_version: "public_web_search_agent_eval.v1",
			}),
		).toThrow("expected_tool is not allowed");
	});
});
