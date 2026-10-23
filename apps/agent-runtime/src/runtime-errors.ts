import {
	type CitationDiagnostic,
	CitationDiagnosticSchema,
	FailureReasonSchema,
} from "campus-contracts/citation-diagnostic";
import { ZodError } from "zod";
import type { ExecutionFailure } from "./agent-run-contract.ts";

export type AgentRuntimeErrorCode =
	| "model_output_invalid"
	| "workflow_operation_payload_too_large"
	| "invalid_request"
	| "context_budget_exceeded"
	| "agent_deadline_exceeded"
	| "max_turns_exceeded"
	| "tool_call_budget_exhausted"
	| "retrieval_budget_exhausted"
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
		options: ErrorOptions = {},
	) {
		super(message, options);
		this.code = code;
		this.failure = {
			code,
			operation: failure.operation ?? "agent.runtime",
			...(FailureReasonSchema.safeParse(failure.reason).success ? { reason: failure.reason } : {}),
			...(CitationDiagnosticSchema.safeParse(failure.citation).success
				? { citation: failure.citation }
				: {}),
			...(failure.detail ? { detail: boundedErrorText(failure.detail, 1024) } : {}),
			...(failure.httpStatus === undefined ? {} : { httpStatus: failure.httpStatus }),
			...(failure.invocationId ? { invocationId: failure.invocationId } : {}),
		};
		this.name = "AgentRuntimeError";
	}
}

export function agentRuntimeErrorPayload(
	error: unknown,
	options: { deadlineSignal?: AbortSignal; operation?: string } = {},
): {
	code: AgentRuntimeErrorCode;
	message: string;
	retryable: false;
	reason?: string;
	citation?: CitationDiagnostic;
	operation: string;
	detail?: string;
	http_status?: number;
	invocation_id?: string;
} {
	const classified = classifyAgentRuntimeError(error, options.deadlineSignal);
	return {
		code: classified.code,
		...(classified.failure.reason ? { reason: classified.failure.reason } : {}),
		...(classified.failure.citation ? { citation: classified.failure.citation } : {}),
		message: classified.message,
		retryable: false,
		operation:
			classified.failure.operation === "agent.runtime"
				? (options.operation ?? classified.failure.operation)
				: classified.failure.operation,
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
	const providerFailure = classifyProviderFailure(error);
	if (providerFailure) {
		return new AgentRuntimeError(
			providerFailure.code,
			publicAgentRuntimeErrorMessage(providerFailure.code),
			providerFailure,
		);
	}
	const httpStatus = numberValue(providerErrorRecord(error)?.status);
	return new AgentRuntimeError("run_failed", publicAgentRuntimeErrorMessage("run_failed"), {
		operation: "agent.runtime",
		detail: summarizeRuntimeError(error),
		...(httpStatus === undefined ? {} : { httpStatus }),
	});
}

export type AgentRuntimeErrorPayload = ReturnType<typeof agentRuntimeErrorPayload>;

// Only explicit error fields are diagnostic input: never serialize the SDK's
// request, response, headers, configuration, or model-output objects.
export function summarizeRuntimeError(error: unknown): string {
	const causes: string[] = [];
	let current = error;
	for (let depth = 0; depth < 4 && current instanceof Error; depth++) {
		const name = current.name;
		if (current instanceof SyntaxError) {
			const position = current.message.match(
				/(?:at position \d+(?: \(line \d+ column \d+\))?|line \d+ column \d+)/u,
			)?.[0];
			causes.push(`${name}: parsing failed${position ? ` ${position}` : ""}`);
		} else if (current instanceof ZodError) {
			causes.push(
				`${name}: ${current.issues
					.slice(0, 8)
					.map((issue) => `${issue.path.join(".")}: ${issue.code}`)
					.join("; ")}`,
			);
		} else {
			const record = providerErrorRecord(current);
			const providerStatus = numberValue(
				record?.status ?? record?.statusCode ?? record?.httpStatus,
			);
			causes.push(
				`${name}: ${providerStatus === undefined ? current.message : `HTTP ${providerStatus}`}`,
			);
		}
		current = current.cause;
	}
	return boundedErrorText(causes.join("; caused by ") || "Non-Error exception", 1024);
}

export function agentRuntimeErrorLogFields(error: unknown, payload: AgentRuntimeErrorPayload) {
	const stacks: string[] = [];
	let current = error;
	for (let depth = 0; depth < 4 && current instanceof Error; depth++) {
		// Error headlines can include response bodies; only keep stack frames.
		stacks.push(
			(current.stack ?? "")
				.split("\n")
				.filter((line) => /^\s+at /u.test(line))
				.join("\n"),
		);
		current = current.cause;
	}
	return {
		error_code: payload.code,
		...(payload.reason ? { error_reason: payload.reason } : {}),
		...Object.fromEntries(
			Object.entries(payload.citation ?? {})
				.filter(([, value]) => value !== undefined)
				.map(([key, value]) => [`citation_${key}`, value]),
		),
		error_operation: payload.operation,
		error_cause: summarizeRuntimeError(error),
		...(stacks.some(Boolean) ? { error_stack: boundedErrorText(stacks.join("\n"), 8192) } : {}),
		...(payload.detail ? { error_detail: payload.detail } : {}),
		...(payload.http_status === undefined ? {} : { error_http_status: payload.http_status }),
		...(payload.invocation_id ? { invocation_id: payload.invocation_id } : {}),
	};
}

function boundedErrorText(text: string, limit: number): string {
	const safe = text
		.replace(/\bBearer\s+[^\s,;"']+/giu, "Bearer [redacted]")
		.replace(
			/\b(api[_-]?key|token|password|secret|authorization|cookie)\s*[:=]\s*(?:"[^"\n]*"|'[^'\n]*'|[^\s,;]+)/giu,
			"$1=[redacted]",
		)
		.replace(/https?:\/\/[^\s"'<>]+/gu, (value) => {
			try {
				const url = new URL(value);
				url.username = "";
				url.password = "";
				url.search = "";
				url.hash = "";
				return url.toString();
			} catch {
				return "[invalid URL]";
			}
		});
	return Array.from(safe).slice(0, limit).join("");
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
	const names = providerErrorNames(error);
	const codes = providerErrorCodes(error);
	if (
		codes.some((code) => code === "ETIMEDOUT") ||
		names.some((name) => /Timeout|timed.?out/i.test(name))
	) {
		return {
			code: "provider_timeout",
			operation: "agent.model",
			detail: "provider request timed out",
		};
	}
	if (
		codes.some((code) => /^E(?:CONN|HOST|NET)/.test(code)) ||
		names.some((name) => /APIConnectionError|ConnectionError|ECONNRESET|ECONNREFUSED/i.test(name))
	) {
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

function providerErrorNames(error: unknown): string[] {
	return providerErrorChain(error).flatMap((value) => {
		const record = objectRecord(value);
		return typeof record?.name === "string" ? [record.name] : [];
	});
}

function providerErrorCodes(error: unknown): string[] {
	return providerErrorChain(error).flatMap((value) => {
		const record = objectRecord(value);
		return typeof record?.code === "string" ? [record.code] : [];
	});
}

function providerErrorChain(error: unknown): unknown[] {
	const values: unknown[] = [];
	const queue: unknown[] = [error];
	const seen = new Set<unknown>();
	while (queue.length > 0 && values.length < 16) {
		const current = queue.shift();
		if (current === undefined || seen.has(current)) {
			continue;
		}
		seen.add(current);
		values.push(current);
		const record = objectRecord(current);
		if (record?.cause) {
			queue.push(record.cause);
		}
		if (record?.errors && Array.isArray(record.errors)) {
			queue.push(...record.errors);
		}
	}
	return values;
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
