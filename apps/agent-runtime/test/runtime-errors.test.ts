import { MaxTurnsExceededError, ToolCallError } from "@openai/agents";
import { describe, expect, it } from "vitest";
import { agentRuntimeErrorPayload } from "../src/runtime-errors.ts";

describe("agent runtime errors", () => {
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
		expect(agentRuntimeErrorPayload(new MaxTurnsExceededError("turn limit"))).toMatchObject({
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
		expect(agentRuntimeErrorPayload(error)).toEqual({
			code: "tool_execution_failed",
			detail: "SDK tool execution failed",
			message: "A runtime tool could not complete.",
			operation: "agent.tool",
			retryable: false,
		});
	});
});
