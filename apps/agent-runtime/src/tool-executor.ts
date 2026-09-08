import type {
	ExecutionFailure,
	ToolExecutionRequest,
	UntimedToolExecutionResult,
} from "./agent-run-contract.ts";
import { createCampusSearchReporter } from "./campus-search-observer.ts";
import { injectTraceContext } from "./telemetry.ts";
import { isCanonicalExecutionControlInternalEndpoint } from "./tool-catalog.ts";

export interface ExecutionControlToolExecutorOptions {
	baseUrl: string;
	sharedSecret: string;
	fetchImpl?: typeof fetch;
}

export function createExecutionControlToolExecutor(options: ExecutionControlToolExecutorOptions) {
	const fetchImpl = options.fetchImpl ?? fetch;
	const observe = createCampusSearchReporter(options);
	const executor = async (request: ToolExecutionRequest): Promise<UntimedToolExecutionResult> => {
		let diagnosticFailureCode: string | undefined;
		const execute = async (): Promise<UntimedToolExecutionResult> => {
			const baseUrl = options.baseUrl.trim();
			const sharedSecret = options.sharedSecret;
			if (request.tool.handler.type !== "execution_control_internal_query") {
				return failedToolResult(request, "tool_handler_not_supported", {
					error: "tool handler is not executable through execution-control query HTTP",
				});
			}
			if (baseUrl === "" || sharedSecret === "") {
				return failedToolResult(request, "tool_executor_not_configured", {
					error: "execution-control query base URL and shared secret are required",
				});
			}
			const endpoint = request.tool.handler.endpoint;
			if (!isCanonicalExecutionControlInternalEndpoint(endpoint)) {
				return failedToolResult(request, "tool_handler_invalid_endpoint", {
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
				return failedToolResult(request, "tool_executor_not_configured", {
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
							...(request.workflowStepId ? { workflow_step_id: request.workflowStepId } : {}),
							...(request.tool.name === "campus_search"
								? {
										user_goal: request.userGoal,
										citation_start: request.citationStart,
										result_limit: request.resultLimit,
									}
								: {}),
						},
					}),
					redirect: "manual",
					signal: executionSignal,
				});
			} catch (error) {
				diagnosticFailureCode = timeoutSignal.aborted
					? "campus_search_timeout"
					: "campus_search_network_failed";
				throwIfRunAborted(request.signal, error);
				if (timeoutSignal.aborted) {
					return timedOutToolResult(request);
				}
				return failedToolResult(request, "transient_internal_query_failed", {
					error: "execution-control query request failed",
				});
			}
			throwIfRunAborted(
				request.signal,
				new Error("Agent run was cancelled during tool execution."),
			);
			if (timeoutSignal.aborted) {
				diagnosticFailureCode = "campus_search_timeout";
				return timedOutToolResult(request);
			}
			if (response.status >= 300 && response.status < 400) {
				return failedToolResult(request, "tool_handler_redirected", {
					error: "execution-control query returned a redirect",
				});
			}
			let result: Record<string, unknown>;
			try {
				result = (await response.json()) as Record<string, unknown>;
			} catch (error) {
				if (timeoutSignal.aborted) {
					diagnosticFailureCode = "campus_search_timeout";
				}
				throwIfRunAborted(request.signal, error);
				if (timeoutSignal.aborted) {
					return timedOutToolResult(request);
				}
				return failedToolResult(request, "tool_handler_invalid_response", {
					error: "execution-control query returned invalid JSON",
				});
			}
			throwIfRunAborted(
				request.signal,
				new Error("Agent run was cancelled during tool execution."),
			);
			if (timeoutSignal.aborted) {
				diagnosticFailureCode = "campus_search_timeout";
				return timedOutToolResult(request);
			}
			if (!response.ok) {
				return failedToolResult(
					request,
					"tool_handler_failed",
					{
						error: "execution-control query failed",
					},
					response.status,
				);
			}
			return {
				status: "completed",
				result,
			};
		};
		await observe(request, { phase: "dispatching" });
		try {
			const result = await execute();
			await observe(request, {
				phase: result.status,
				...(result.failure
					? {
							failureCode: diagnosticFailureCode ?? result.failure.code,
							httpStatus: result.failure.httpStatus,
						}
					: {}),
			});
			return result;
		} catch (error) {
			await observe(request, {
				phase: request.signal?.aborted ? "canceled" : "failed",
				failureCode: "campus_search_interrupted",
			});
			throw error;
		}
	};
	return Object.assign(executor, { observe });
}

function timedOutToolResult(request: ToolExecutionRequest): UntimedToolExecutionResult {
	return failedToolResult(request, "transient_internal_query_failed", {
		error: "execution-control query timed out",
	});
}

function failedToolResult(
	request: ToolExecutionRequest,
	code: string,
	result: Record<string, unknown>,
	httpStatus?: number,
): UntimedToolExecutionResult {
	const failure: ExecutionFailure = {
		code,
		operation: `tool.${request.tool.name}`,
		...(httpStatus === undefined ? {} : { httpStatus }),
		...(request.invocationId ? { invocationId: request.invocationId } : {}),
	};
	return {
		status: "failed",
		result,
		failure,
	};
}

function throwIfRunAborted(signal: AbortSignal | undefined, fallback: unknown): void {
	if (signal?.aborted) {
		throw signal.reason ?? fallback;
	}
}
