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
			message: "Agent run exceeded its configured deadline.",
			retryable: false,
		});
	});

	it("classifies the official SDK max-turns error", () => {
		expect(agentRuntimeErrorPayload(new MaxTurnsExceededError("turn limit"))).toMatchObject({
			code: "max_turns_exceeded",
			retryable: false,
		});
	});

	it.each([429, 500, 503])("classifies provider HTTP %i as unavailable", (status) => {
		const error = Object.assign(new Error(`provider HTTP ${status}`), { status });
		expect(agentRuntimeErrorPayload(error)).toEqual({
			code: "provider_unavailable",
			message: "The answer provider is temporarily unavailable.",
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
			message: "A runtime tool could not complete.",
			retryable: false,
		});
	});
});
