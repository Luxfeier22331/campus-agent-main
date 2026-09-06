import { MaxTurnsExceededError, ToolCallError, ToolTimeoutError } from "@openai/agents";
import type { ExecutionFailure } from "./agent-run-contract.ts";

export type AgentRuntimeErrorCode =
	| "invalid_request"
	| "context_budget_exceeded"
	| "agent_deadline_exceeded"
	| "max_turns_exceeded"
	| "provider_unavailable"
	| "model_config_incompatible"
	| "citation_validation_failed"
	| "provider_rate_limited"
	| "provider_http_failed"
	| "provider_connection_failed"
	| "provider_timeout"
	| "tool_execution_failed"
	| "tool_contract_mismatch"
	| "run_failed";

export class AgentRuntimeError extends Error {
	readonly code: AgentRuntimeErrorCode;
	readonly failure: ExecutionFailure;

	constructor(
		code: AgentRuntimeErrorCode,
		message: string,
		failure: Omit<ExecutionFailure, "code" | "operation"> & {
			code?: string;
			operation?: string;
		} = {},
	) {
		super(message);
		this.code = code;
		this.failure = {
			code,
			operation: failure.operation ?? "agent.runtime",
			...(failure.detail ? { detail: failure.detail } : {}),
			...(failure.httpStatus === undefined ? {} : { httpStatus: failure.httpStatus }),
			...(failure.invocationId ? { invocationId: failure.invocationId } : {}),
		};
		this.name = "AgentRuntimeError";
	}
}

export function agentRuntimeErrorPayload(
	error: unknown,
	options: { deadlineSignal?: AbortSignal } = {},
): {
	code: AgentRuntimeErrorCode;
	message: string;
	retryable: false;
	operation: string;
	detail?: string;
	http_status?: number;
	invocation_id?: string;
} {
	const classified = classifyAgentRuntimeError(error, options.deadlineSignal);
	return {
		code: classified.code,
		message: classified.message,
		retryable: false,
		operation: classified.failure.operation,
		...(classified.failure.detail ? { detail: classified.failure.detail } : {}),
		...(classified.failure.httpStatus === undefined
			? {}
			: { http_status: classified.failure.httpStatus }),
		...(classified.failure.invocationId ? { invocation_id: classified.failure.invocationId } : {}),
	};
}

function classifyAgentRuntimeError(
	error: unknown,
	deadlineSignal: AbortSignal | undefined,
): AgentRuntimeError {
	if (error instanceof AgentRuntimeError) {
		return new AgentRuntimeError(
			error.code,
			publicAgentRuntimeErrorMessage(error.code),
			error.failure,
		);
	}
	if (deadlineSignal?.aborted) {
		return new AgentRuntimeError(
			"agent_deadline_exceeded",
			"Agent run exceeded its configured deadline.",
			{ operation: "agent.runtime", detail: "agent deadline signal was aborted" },
		);
	}
	if (error instanceof MaxTurnsExceededError) {
		return new AgentRuntimeError("max_turns_exceeded", "Agent run exceeded its turn limit.", {
			operation: "agent.runner",
		});
	}
	if (error instanceof ToolCallError || error instanceof ToolTimeoutError) {
		return new AgentRuntimeError(
			"tool_execution_failed",
			publicAgentRuntimeErrorMessage("tool_execution_failed"),
			{ operation: "agent.tool", detail: "SDK tool execution failed" },
		);
	}
	const providerFailure = classifyProviderFailure(error);
	if (providerFailure) {
		return new AgentRuntimeError(
			providerFailure.code,
			publicAgentRuntimeErrorMessage(providerFailure.code),
			providerFailure,
		);
	}
	return new AgentRuntimeError("run_failed", publicAgentRuntimeErrorMessage("run_failed"), {
		operation: "agent.runtime",
	});
}

function classifyProviderFailure(error: unknown):
	| (Omit<ExecutionFailure, "code"> & {
			code: AgentRuntimeErrorCode;
	  })
	| null {
	const record = providerErrorRecord(error);
	const status = numberValue(record?.status ?? record?.statusCode ?? record?.httpStatus);
	if (status === 429) {
		return {
			code: "provider_rate_limited",
			operation: "agent.model",
			detail: "provider returned HTTP 429",
			httpStatus: status,
		};
	}
	if (status !== undefined && status >= 500) {
		return {
			code: "provider_http_failed",
			operation: "agent.model",
			detail: `provider returned HTTP ${status}`,
			httpStatus: status,
		};
	}
	const name = providerErrorName(error);
	if (/Timeout|timed.?out/i.test(name)) {
		return {
			code: "provider_timeout",
			operation: "agent.model",
			detail: "provider request timed out",
		};
	}
	if (/APIConnectionError|ConnectionError|ECONNRESET|ECONNREFUSED/i.test(name)) {
		return {
			code: "provider_connection_failed",
			operation: "agent.model",
			detail: "provider connection failed",
		};
	}
	return null;
}

function providerErrorRecord(error: unknown): Record<string, unknown> | undefined {
	let current = error;
	for (let depth = 0; depth < 4; depth += 1) {
		const record = objectRecord(current);
		if (record) {
			if (
				numberValue(record.status) !== undefined ||
				numberValue(record.statusCode) !== undefined ||
				numberValue(record.httpStatus) !== undefined
			) {
				return record;
			}
			current = record.cause;
			continue;
		}
		break;
	}
	return objectRecord(error);
}

function providerErrorName(error: unknown): string {
	let current = error;
	for (let depth = 0; depth < 4; depth += 1) {
		if (current instanceof Error) {
			if (current.name) {
				return current.name;
			}
			current = current.cause;
			continue;
		}
		const record = objectRecord(current);
		if (!record) {
			break;
		}
		if (typeof record.name === "string" && record.name) {
			return record.name;
		}
		current = record.cause;
	}
	return "";
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
		case "model_config_incompatible":
			return "The configured answer model does not support the required Responses API.";
		case "citation_validation_failed":
			return "The answer contained invalid web citations.";
		case "provider_rate_limited":
			return "The answer provider rate limit was reached.";
		case "provider_http_failed":
			return "The answer provider returned an error.";
		case "provider_connection_failed":
			return "The answer provider could not be reached.";
		case "provider_timeout":
			return "The answer provider did not respond in time.";
		case "tool_execution_failed":
			return "A runtime tool could not complete.";
		case "tool_contract_mismatch":
			return "The admitted tool contract does not match this agent runtime.";
		default:
			return "The agent runtime could not complete the request.";
	}
}
