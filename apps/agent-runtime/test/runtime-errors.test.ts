import { MaxTurnsExceededError, ToolCallError } from "@openai/agents";
import { BadRequestError } from "openai";
import { describe, expect, it } from "vitest";
import { openAIRuntimeError } from "../src/openai-errors.ts";
import {
	AgentRuntimeError,
	agentRuntimeErrorLogFields,
	agentRuntimeErrorPayload,
	summarizeRuntimeError,
} from "../src/runtime-errors.ts";

describe("agent runtime errors", () => {
	it("preserves a provider rejection reason without copying the response object", () => {
		const error = new BadRequestError(
			400,
			{
				message: "Unknown tool call identifier",
				code: "invalid_request",
				param: "input",
				body: "private model response",
			},
			undefined,
			new Headers({ authorization: "private-key" }),
		);
		const payload = agentRuntimeErrorPayload(openAIRuntimeError(error), {
			operation: "workflow.execute_step",
		});
		expect(payload).toMatchObject({
			code: "run_failed",
			operation: "workflow.execute_step",
			http_status: 400,
			detail: "BadRequestError: HTTP 400 (invalid_request, input): Unknown tool call identifier",
		});
		expect(JSON.stringify(agentRuntimeErrorLogFields(error, payload))).not.toContain("private");
	});
	it("preserves an unknown cause without labelling every SyntaxError a provider failure", () => {
		const cause = new SyntaxError(
			"Unexpected token 'private-model-text', at position 354 (line 2 column 1)",
		);
		const error = new AgentRuntimeError(
			"run_failed",
			"Workflow result is invalid",
			{ operation: "workflow.execute_step", detail: summarizeRuntimeError(cause) },
			{ cause },
		);
		const payload = agentRuntimeErrorPayload(error);
		const log = agentRuntimeErrorLogFields(error, payload);
		expect(error.cause).toBe(cause);
		expect(payload).toMatchObject({
			code: "run_failed",
			operation: "workflow.execute_step",
			detail: "SyntaxError: parsing failed at position 354 (line 2 column 1)",
		});
		expect(log.error_code).toBe(payload.code);
		expect(log.error_cause).toContain("caused by SyntaxError");
		expect(log.error_stack).toContain("runtime-errors.test.ts");
		expect(JSON.stringify({ payload, log })).not.toContain("private-model-text");
	});

	it("keeps diagnostics bounded without serializing credentials or provider bodies", () => {
		const error = Object.assign(new Error("provider response body is private"), {
			status: 502,
			body: "private body",
			headers: { authorization: "secret" },
		});
		const logged = JSON.stringify(
			agentRuntimeErrorLogFields(error, agentRuntimeErrorPayload(error)),
		);
		expect(logged).not.toContain("private");
		expect(logged).not.toContain("secret");
		const cause = new Error(
			"token=private-token Bearer private-key https://user:password@example.com/path?token=private-query " +
				"字".repeat(2000),
		);
		cause.stack = `Error: hidden\n${"    at test (https://example.com/path?secret=private)\n".repeat(300)}`;
		const payload = agentRuntimeErrorPayload(cause);
		const log = agentRuntimeErrorLogFields(cause, payload);
		expect(Array.from(payload.detail ?? "")).toHaveLength(1024);
		expect(Array.from(log.error_stack ?? "").length).toBeLessThanOrEqual(8192);
		expect(JSON.stringify({ payload, log })).not.toContain("private");
		expect(payload).not.toHaveProperty("stack");
	});

	it("retains a plain application error and request operation", () => {
		const payload = agentRuntimeErrorPayload(new TypeError("cannot read current step"), {
			operation: "workflow.replan",
		});
		expect(payload).toMatchObject({
			code: "run_failed",
			operation: "workflow.replan",
			detail: "TypeError: cannot read current step",
		});
	});
	it("classifies an aborted deadline", () => {
		const controller = new AbortController();
		controller.abort();

		expect(
			agentRuntimeErrorPayload(new Error("request aborted"), {
				deadlineSignal: controller.signal,
			}),
		).toEqual({
			code: "agent_deadline_exceeded",
			detail: "agent deadline signal was aborted",
			message: "Agent run exceeded its configured deadline.",
			operation: "agent.runtime",
			retryable: false,
		});
	});

	it("classifies the official SDK max-turns error", () => {
		expect(
			agentRuntimeErrorPayload(openAIRuntimeError(new MaxTurnsExceededError("turn limit"))),
		).toMatchObject({
			code: "max_turns_exceeded",
			retryable: false,
		});
	});

	it.each([
		[429, "provider_rate_limited", "The answer provider rate limit was reached."],
		[500, "provider_http_failed", "The answer provider returned an error."],
		[503, "provider_http_failed", "The answer provider returned an error."],
	] as const)("classifies provider HTTP %i", (status, code, message) => {
		const error = Object.assign(new Error(`provider HTTP ${status}`), { status });
		expect(agentRuntimeErrorPayload(error)).toEqual({
			code,
			detail: `provider returned HTTP ${status}`,
			http_status: status,
			message,
			operation: "agent.model",
			retryable: false,
		});
	});

	it("classifies the official SDK tool-call error", () => {
		const error = new ToolCallError(
			"personal_memory_recall failed",
			new Error("backend unavailable"),
		);
		expect(agentRuntimeErrorPayload(openAIRuntimeError(error))).toEqual({
			code: "tool_execution_failed",
			detail: "SDK tool execution failed",
			message: "A runtime tool could not complete.",
			operation: "agent.tool",
			retryable: false,
		});
	});

	it("classifies provider status nested in an SDK cause", () => {
		const error = Object.assign(new Error("provider request failed"), {
			cause: Object.assign(new Error("gateway response"), { statusCode: 502 }),
		});

		expect(agentRuntimeErrorPayload(error)).toMatchObject({
			code: "provider_http_failed",
			detail: "provider returned HTTP 502",
			http_status: 502,
			operation: "agent.model",
		});
	});
});
