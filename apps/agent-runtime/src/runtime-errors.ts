import { MaxTurnsExceededError, ToolCallError, ToolTimeoutError } from "@openai/agents";

export type AgentRuntimeErrorCode =
	| "invalid_request"
	| "context_budget_exceeded"
	| "agent_deadline_exceeded"
	| "max_turns_exceeded"
	| "provider_unavailable"
	| "tool_execution_failed"
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
		return error;
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
		return new AgentRuntimeError("tool_execution_failed", error.message);
	}
	if (providerUnavailable(error)) {
		return new AgentRuntimeError("provider_unavailable", errorMessage(error));
	}
	return new AgentRuntimeError("run_failed", errorMessage(error));
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

function errorMessage(error: unknown): string {
	return error instanceof Error && error.message.trim() !== ""
		? error.message
		: "Agent run failed.";
}
