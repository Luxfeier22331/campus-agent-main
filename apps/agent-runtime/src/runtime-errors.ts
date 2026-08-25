import { MaxTurnsExceededError, ToolCallError, ToolTimeoutError } from "@openai/agents";

export type AgentRuntimeErrorCode =
	| "invalid_request"
	| "context_budget_exceeded"
	| "agent_deadline_exceeded"
	| "max_turns_exceeded"
	| "provider_unavailable"
	| "tool_execution_failed"
	| "tool_contract_mismatch"
	| "run_failed";

export class AgentRuntimeError extends Error {
	readonly code: AgentRuntimeErrorCode;

	constructor(code: AgentRuntimeErrorCode, message: string) {
		super(message);
		this.code = code;
		this.name = "AgentRuntimeError";
	}
}

export function agentRuntimeErrorPayload(
	error: unknown,
	options: { deadlineSignal?: AbortSignal } = {},
): { code: AgentRuntimeErrorCode; message: string; retryable: false } {
	const classified = classifyAgentRuntimeError(error, options.deadlineSignal);
	return {
		code: classified.code,
		message: classified.message,
		retryable: false,
	};
}

function classifyAgentRuntimeError(
	error: unknown,
	deadlineSignal: AbortSignal | undefined,
): AgentRuntimeError {
	if (error instanceof AgentRuntimeError) {
		return new AgentRuntimeError(error.code, publicAgentRuntimeErrorMessage(error.code));
	}
	if (deadlineSignal?.aborted) {
		return new AgentRuntimeError(
			"agent_deadline_exceeded",
			"Agent run exceeded its configured deadline.",
		);
	}
	if (error instanceof MaxTurnsExceededError) {
		return new AgentRuntimeError("max_turns_exceeded", "Agent run exceeded its turn limit.");
	}
	if (error instanceof ToolCallError || error instanceof ToolTimeoutError) {
		return new AgentRuntimeError(
			"tool_execution_failed",
			publicAgentRuntimeErrorMessage("tool_execution_failed"),
		);
	}
	if (providerUnavailable(error)) {
		return new AgentRuntimeError(
			"provider_unavailable",
			publicAgentRuntimeErrorMessage("provider_unavailable"),
		);
	}
	return new AgentRuntimeError("run_failed", publicAgentRuntimeErrorMessage("run_failed"));
}

function providerUnavailable(error: unknown): boolean {
	const record = objectRecord(error);
	const status = numberValue(record?.status ?? record?.statusCode);
	if (status === 429 || (status !== undefined && status >= 500)) {
		return true;
	}
	const name = error instanceof Error ? error.name : "";
	return /APIConnectionError|RateLimitError|ServiceUnavailableError/i.test(name);
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object"
		? (value as Record<string, unknown>)
		: undefined;
}

function numberValue(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function publicAgentRuntimeErrorMessage(code: AgentRuntimeErrorCode): string {
	switch (code) {
		case "invalid_request":
			return "The agent runtime request is invalid.";
		case "context_budget_exceeded":
			return "The agent runtime context exceeded its configured budget.";
		case "agent_deadline_exceeded":
			return "Agent run exceeded its configured deadline.";
		case "max_turns_exceeded":
			return "Agent run exceeded its turn limit.";
		case "provider_unavailable":
			return "The answer provider is temporarily unavailable.";
		case "tool_execution_failed":
			return "A runtime tool could not complete.";
		case "tool_contract_mismatch":
			return "The admitted tool contract does not match this agent runtime.";
		default:
			return "The agent runtime could not complete the request.";
	}
}
