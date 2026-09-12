import { MaxTurnsExceededError, ToolCallError, ToolTimeoutError } from "@openai/agents";
import { APIError } from "openai";
import { AgentRuntimeError } from "./runtime-errors.ts";

export function openAIRuntimeError(error: unknown): unknown {
	if (error instanceof AgentRuntimeError) {
		return error;
	}
	if (error instanceof MaxTurnsExceededError) {
		return new AgentRuntimeError(
			"max_turns_exceeded",
			"Agent run exceeded its turn limit.",
			{ operation: "agent.runner" },
			{ cause: error },
		);
	}
	if (error instanceof ToolCallError || error instanceof ToolTimeoutError) {
		if (error instanceof ToolCallError && error.error instanceof AgentRuntimeError) {
			return error.error;
		}
		return new AgentRuntimeError(
			"tool_execution_failed",
			"SDK tool execution failed.",
			{ operation: "agent.tool", detail: "SDK tool execution failed" },
			{ cause: error },
		);
	}
	if (error instanceof APIError && error.status !== undefined) {
		const fields = [error.code, error.param].filter(Boolean).join(", ");
		const reason =
			typeof error.error === "object" &&
			error.error !== null &&
			"message" in error.error &&
			typeof error.error.message === "string"
				? error.error.message
				: "provider rejected request";
		return new AgentRuntimeError(
			error.status === 429
				? "provider_rate_limited"
				: error.status >= 500
					? "provider_http_failed"
					: "run_failed",
			"Model provider rejected request.",
			{
				operation: error.status >= 429 ? "agent.model" : "agent.runtime",
				httpStatus: error.status,
				detail: `${error.constructor.name}: HTTP ${error.status}${fields ? ` (${fields})` : ""}: ${reason}`,
			},
			{ cause: error },
		);
	}
	return error;
}
