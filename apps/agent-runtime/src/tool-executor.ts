import type { ToolExecutionRequest, UntimedToolExecutionResult } from "./agent-run-contract.ts";
import { injectTraceContext } from "./telemetry.ts";
import { isCanonicalExecutionControlInternalEndpoint } from "./tool-catalog.ts";

export interface ExecutionControlToolExecutorOptions {
	baseUrl: string;
	sharedSecret: string;
	fetchImpl?: typeof fetch;
}

export function createExecutionControlToolExecutor(options: ExecutionControlToolExecutorOptions) {
	const fetchImpl = options.fetchImpl ?? fetch;
	return async (request: ToolExecutionRequest): Promise<UntimedToolExecutionResult> => {
		const baseUrl = options.baseUrl.trim();
		const sharedSecret = options.sharedSecret;
		if (request.tool.handler.type !== "execution_control_internal_query") {
			return failedToolResult("tool_handler_not_supported", {
				error: "tool handler is not executable through execution-control query HTTP",
			});
		}
		if (baseUrl === "" || sharedSecret === "") {
			return failedToolResult("tool_executor_not_configured", {
				error: "execution-control query base URL and shared secret are required",
			});
		}
		const endpoint = request.tool.handler.endpoint;
		if (!isCanonicalExecutionControlInternalEndpoint(endpoint)) {
			return failedToolResult("tool_handler_invalid_endpoint", {
				error: "execution-control query endpoint must be a canonical /internal/ path",
			});
		}
		let target: URL;
		try {
			const base = new URL(baseUrl);
			if (
				(base.protocol !== "http:" && base.protocol !== "https:") ||
				base.username !== "" ||
				base.password !== ""
			) {
				throw new Error("invalid execution-control base URL");
			}
			target = new URL(endpoint, base);
			if (target.origin !== base.origin || !target.pathname.startsWith("/internal/")) {
				throw new Error("execution-control endpoint escaped its configured origin");
			}
		} catch {
			return failedToolResult("tool_executor_not_configured", {
				error: "execution-control query base URL is invalid",
			});
		}
		const timeoutSignal = AbortSignal.timeout(request.tool.timeoutMs);
		const executionSignal = AbortSignal.any(
			[request.signal, timeoutSignal].filter(
				(signal): signal is AbortSignal => signal !== undefined,
			),
		);
		let response: Response;
		try {
			const headers = injectTraceContext(
				new Headers({
					"x-execution-query-auth": sharedSecret,
					"content-type": "application/json",
				}),
			);
			response = await fetchImpl(target, {
				method: "POST",
				headers,
				body: JSON.stringify({
					payload: request.argumentsJson,
					access_context: {
						activity_attempt: request.activityAttempt ?? 1,
						request_id: request.requestId,
						invocation_id: request.invocationId,
					},
				}),
				redirect: "manual",
				signal: executionSignal,
			});
		} catch (error) {
			throwIfRunAborted(request.signal, error);
			if (timeoutSignal.aborted) {
				return timedOutToolResult();
			}
			return failedToolResult("transient_internal_query_failed", {
				error: "execution-control query request failed",
			});
		}
		throwIfRunAborted(request.signal, new Error("Agent run was cancelled during tool execution."));
		if (timeoutSignal.aborted) {
			return timedOutToolResult();
		}
		if (response.status >= 300 && response.status < 400) {
			return failedToolResult("tool_handler_redirected", {
				error: "execution-control query returned a redirect",
			});
		}
		let result: Record<string, unknown>;
		try {
			result = (await response.json()) as Record<string, unknown>;
		} catch (error) {
			throwIfRunAborted(request.signal, error);
			if (timeoutSignal.aborted) {
				return timedOutToolResult();
			}
			return failedToolResult("tool_handler_invalid_response", {
				error: "execution-control query returned invalid JSON",
			});
		}
		throwIfRunAborted(request.signal, new Error("Agent run was cancelled during tool execution."));
		if (timeoutSignal.aborted) {
			return timedOutToolResult();
		}
		if (!response.ok) {
			return failedToolResult("tool_handler_failed", {
				error: "execution-control query failed",
			});
		}
		return {
			status: "completed",
			result,
		};
	};
}

function timedOutToolResult(): UntimedToolExecutionResult {
	return failedToolResult("transient_internal_query_failed", {
		error: "execution-control query timed out",
	});
}

function failedToolResult(
	failCloseReason: string,
	result: Record<string, unknown>,
): UntimedToolExecutionResult {
	return {
		status: "failed",
		result,
		failCloseReason,
	};
}

function throwIfRunAborted(signal: AbortSignal | undefined, fallback: unknown): void {
	if (signal?.aborted) {
		throw signal.reason ?? fallback;
	}
}
