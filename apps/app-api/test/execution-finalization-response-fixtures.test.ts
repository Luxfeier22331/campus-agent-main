// @vitest-environment node

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { parseExecutionFinalizationResponsePayload } from "../src/modules/integration/execution-control";
import { parseExecutionTerminalResponse } from "../src/modules/runtime-command/service/stream";

const fixtureDir = resolve(
	process.cwd(),
	"../..",
	"packages/contracts/fixtures/tool_execution_contract",
);

function loadFixture(name: string): Record<string, unknown> {
	return JSON.parse(readFileSync(join(fixtureDir, name), "utf8")) as Record<string, unknown>;
}

describe("execution finalization canonical response fixtures", () => {
	it("parses model usage and rejects retired session updates", () => {
		const payload = loadFixture("response_temporal_finalization.valid.json");
		expect(parseExecutionFinalizationResponsePayload(payload)).toMatchObject({
			modelUsage: {
				cachedInputTokens: 100,
				inputTokens: 510,
				outputTokens: 110,
				totalTokens: 620,
			},
		});

		payload.session_update = {
			upsert_slots: [
				{
					confirmed: true,
					name: "curriculum_program",
					value: "历史学强基计划",
				},
			],
		};

		expect(() => parseExecutionFinalizationResponsePayload(payload)).toThrow(
			"unexpected top-level field session_update",
		);
	});

	it("parses canonical terminal state fixtures", () => {
		expect(
			parseExecutionFinalizationResponsePayload(
				loadFixture("response_completed_delegate.valid.json"),
			),
		).toMatchObject({
			modelUsage: {
				cachedInputTokens: 120,
				inputTokens: 420,
				outputTokens: 96,
				totalTokens: 516,
			},
			status: "completed",
			traceId: "trace-contract-completed",
			workflowTraceSummary: {
				answerArtifactRefs: ["projection://runs/run_contract_completed/agent/primary/result"],
				executionPath: "tool_assisted",
				runtimeVersions: {
					agent_runtime: "openai_agents_sdk",
				},
				terminalReason: "answer",
			},
		});
		expect(
			parseExecutionFinalizationResponsePayload(
				loadFixture("response_temporal_finalization.valid.json"),
			),
		).toMatchObject({
			answerText: "示例奖学金按照现行评审办法执行。",
			error: null,
			status: "completed",
			traceId: "trace-temporal-finalization",
		});
		expect(
			parseExecutionFinalizationResponsePayload(
				loadFixture("response_cancelled_null_target.valid.json"),
			),
		).toMatchObject({
			error: { code: "execution_cancelled", retryable: false },
			status: "cancelled",
		});
		const timeout = loadFixture("response_timeout.valid.json");
		(timeout.error as Record<string, unknown>).message =
			"postgres://runtime:secret@db.internal/runtime";
		expect(parseExecutionFinalizationResponsePayload(timeout)).toMatchObject({
			error: {
				code: "execution_timeout",
				message: "Execution-control request failed.",
				retryable: true,
			},
			status: "error",
		});
	});

	it("rejects non-canonical response fixtures", () => {
		for (const fixtureName of [
			"response_camel_case.invalid.json",
			"response_extra_field.invalid.json",
		]) {
			expect(() => parseExecutionFinalizationResponsePayload(loadFixture(fixtureName))).toThrow(
				/execution finalization response contract/i,
			);
		}
	});

	it("rejects an error code that could carry arbitrary text", () => {
		const payload = loadFixture("response_timeout.valid.json");
		(payload.error as Record<string, unknown>).code = "authorization=Bearer secret-token";

		expect(() => parseExecutionFinalizationResponsePayload(payload)).toThrow(
			/execution finalization response contract/i,
		);
	});

	it("does not expose a terminal provider error in the streamed response", () => {
		const result = parseExecutionTerminalResponse({
			data: {
				occurred_at: "2026-07-26T08:00:00.000Z",
				request_id: "request-1",
				trace_id: "trace-1",
				error: {
					code: "provider_unavailable",
					message: "postgres://runtime:secret@db.internal/runtime",
					retryable: true,
				},
			},
			event: "execution.failed",
			now: () => new Date("2026-07-26T08:00:00.000Z"),
		});

		expect(result?.response.error).toEqual({
			code: "provider_unavailable",
			message: "The answer provider is temporarily unavailable.",
			retryable: true,
		});
		expect(JSON.stringify(result)).not.toContain("postgres://runtime:secret");
	});

	it("parses direct model and prompt observability", () => {
		const payload = loadFixture("response_temporal_finalization.valid.json");
		payload.observability = {
			...(payload.observability as Record<string, unknown>),
			model_name: "gpt-4.1",
			model_provider: "openai",
			prompt_trace: {
				prompt_id: "primary_agent",
				prompt_template_sha256: "sha256:template",
				rendered_prompt_sha256: "sha256:rendered",
				schema_version: "agent_runtime_prompt_trace.v1",
			},
		};

		expect(parseExecutionFinalizationResponsePayload(payload)).toMatchObject({
			observability: {
				modelName: "gpt-4.1",
				modelProvider: "openai",
				promptTrace: {
					promptId: "primary_agent",
					promptTemplateSha256: "sha256:template",
					renderedPromptSha256: "sha256:rendered",
					schemaVersion: "agent_runtime_prompt_trace.v1",
				},
			},
		});
	});

	it("rejects unknown observability projections", () => {
		const payload = loadFixture("response_temporal_finalization.valid.json");
		payload.observability = {
			...(payload.observability as Record<string, unknown>),
			unsupported_projection: {},
		};

		expect(() => parseExecutionFinalizationResponsePayload(payload)).toThrow(
			/observability\.unsupported_projection is not allowed/i,
		);
	});

	it("parses stage timing", () => {
		const payload = loadFixture("response_temporal_finalization.valid.json");
		payload.stage_timing = {
			"agent.runtime_ms": 321,
			"agent.first_delta_ms": 120,
		};

		expect(parseExecutionFinalizationResponsePayload(payload)).toMatchObject({
			stageTiming: {
				"agent.runtime_ms": 321,
				"agent.first_delta_ms": 120,
			},
		});
	});

	it("rejects non-canonical stage timing", () => {
		const invalidStageTiming = loadFixture("response_temporal_finalization.valid.json");
		invalidStageTiming.stage_timing = { agent_runtime_duration_ms: 321 };
		expect(() => parseExecutionFinalizationResponsePayload(invalidStageTiming)).toThrow(
			/execution finalization response contract/i,
		);
	});
});
