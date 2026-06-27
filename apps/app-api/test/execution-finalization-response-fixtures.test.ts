// @vitest-environment node

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { parseExecutionFinalizationResponsePayload } from "../src/modules/integration/execution-control";

const fixtureDir = resolve(process.cwd(), "../..", "tests/fixtures/tool_execution_contract");

function loadFixture(name: string): Record<string, unknown> {
	return JSON.parse(readFileSync(join(fixtureDir, name), "utf8")) as Record<string, unknown>;
}

describe("execution finalization canonical response fixtures", () => {
	it("parses canonical terminal state fixtures", () => {
		expect(
			parseExecutionFinalizationResponsePayload(
				loadFixture("response_completed_delegate.valid.json"),
			),
		).toMatchObject({
			selectedTool: "knowledge_query",
			status: "completed",
			traceId: "trace-contract-completed",
			workflowTraceSummary: {
				contextProjections: [],
				directVsDelegateBranch: "delegate",
				selectedTool: "knowledge_query",
				selectedTools: ["knowledge_query"],
			},
		});
		expect(
			parseExecutionFinalizationResponsePayload(
				loadFixture("response_temporal_finalization.valid.json"),
			),
		).toMatchObject({
			answerText: "国家奖学金按学校现行评审办法执行。",
			error: null,
			selectedTool: "knowledge_query",
			status: "completed",
			traceId: "trace-temporal-finalization",
			workflowTraceSummary: {
				selectedTool: "knowledge_query",
				selectedTools: ["knowledge_query"],
			},
		});
		expect(
			parseExecutionFinalizationResponsePayload(
				loadFixture("response_cancelled_null_target.valid.json"),
			),
		).toMatchObject({
			error: {
				code: "execution_cancelled",
				retryable: false,
			},
			selectedTool: null,
			status: "cancelled",
			traceId: "trace-contract-cancelled",
		});
		expect(
			parseExecutionFinalizationResponsePayload(loadFixture("response_timeout.valid.json")),
		).toMatchObject({
			error: {
				code: "execution_timeout",
				retryable: true,
			},
			selectedTool: null,
			status: "error",
		});
	});

	it("rejects non-canonical response fixtures instead of accepting camelCase fallback", () => {
		for (const fixtureName of [
			"response_camel_case.invalid.json",
			"response_extra_field.invalid.json",
		]) {
			expect(() => parseExecutionFinalizationResponsePayload(loadFixture(fixtureName))).toThrow(
				/execution finalization response contract/i,
			);
		}
	});

	it("parses canonical context projection summaries", () => {
		const payload = loadFixture("response_completed_delegate.valid.json");
		payload.workflow_trace_summary = {
			...(payload.workflow_trace_summary as Record<string, unknown>),
			context_projections: [
				{
					projection_id: "projection:notice:001",
					source_step_id: "tool:notice:campus_notice_get",
					projection_kind: "notice_context",
					content_hash: "sha256:test",
					safety: {
						truncated: false,
						redacted: false,
						max_chars: 1600,
						fields_present: ["title", "body_excerpt", "source_url"],
					},
				},
			],
		};

		expect(parseExecutionFinalizationResponsePayload(payload)).toMatchObject({
			workflowTraceSummary: {
				contextProjections: [
					{
						projection_id: "projection:notice:001",
						projection_kind: "notice_context",
					},
				],
			},
		});
	});

	it("parses canonical usage summary from finalization observability", () => {
		const payload = loadFixture("response_temporal_finalization.valid.json");
		payload.observability = {
			...(payload.observability as Record<string, unknown>),
			usage_summary: {
				billable_step_count: 2,
				cached_input_tokens: 12,
				estimated_cost_microusd: 60920,
				input_tokens: 18550,
				model_name: null,
				model_provider: null,
				model_usage: [
					{
						cached_input_tokens: 0,
						estimated_cost_microusd: 0,
						input_tokens: 11268,
						model_name: "gpt-5.5",
						model_provider: "openai",
						output_tokens: 494,
						step_count: 1,
					},
					{
						cached_input_tokens: 12,
						estimated_cost_microusd: 60920,
						input_tokens: 7282,
						model_name: "gpt-4.1",
						model_provider: "openai",
						output_tokens: 817,
						step_count: 1,
					},
				],
				output_tokens: 1311,
			},
		};

		expect(parseExecutionFinalizationResponsePayload(payload)).toMatchObject({
			observability: {
				usageSummary: {
					billableStepCount: 2,
					cachedInputTokens: 12,
					estimatedCostMicrousd: 60920,
					inputTokens: 18550,
					modelName: null,
					modelProvider: null,
					outputTokens: 1311,
				},
			},
		});
	});
});
