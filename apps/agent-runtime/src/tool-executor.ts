import type { ToolExecutionRequest, ToolExecutionResult } from "./primary-agent.ts";

export interface ExecutionControlToolExecutorOptions {
	baseUrl: string;
	sharedSecret: string;
	fetchImpl?: typeof fetch;
}

export function createExecutionControlToolExecutor(options: ExecutionControlToolExecutorOptions) {
	const fetchImpl = options.fetchImpl ?? fetch;
	return async (request: ToolExecutionRequest): Promise<ToolExecutionResult> => {
		const baseUrl = options.baseUrl.trim();
		const sharedSecret = options.sharedSecret.trim();
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
		let response: Response;
		try {
			response = await fetchImpl(new URL(request.tool.handler.endpoint, baseUrl), {
				method: "POST",
				headers: {
					"x-execution-query-auth": sharedSecret,
					"content-type": "application/json",
				},
				body: JSON.stringify({
					payload: request.argumentsJson,
					access_context: {
						run_id: request.runId,
						trace_id: request.traceId,
						invocation_id: request.invocationId,
						knowledge_scope: request.knowledge?.scope,
						version_query: request.knowledge?.versionQuery,
					},
				}),
				signal: composedAbortSignal([request.signal, AbortSignal.timeout(request.tool.timeoutMs)]),
			});
		} catch (error) {
			return failedToolResult(request, "transient_internal_query_failed", {
				error: "execution-control query request failed",
				detail: errorMessage(error),
			});
		}
		let result: Record<string, unknown>;
		try {
			result = (await response.json()) as Record<string, unknown>;
		} catch {
			return failedToolResult(request, "tool_handler_invalid_response", {
				error: "execution-control query returned invalid JSON",
			});
		}
		if (!response.ok) {
			return failedToolResult(request, "tool_handler_failed", result);
		}
		return {
			status: "completed",
			toolName: request.tool.name,
			payloadKind: request.tool.name,
			argumentsJson: request.argumentsJson,
			result,
			resultRef: toolResultRef(request),
		};
	};
}

function failedToolResult(
	request: ToolExecutionRequest,
	failCloseReason: string,
	result: Record<string, unknown>,
): ToolExecutionResult {
	return {
		status: "failed",
		toolName: request.tool.name,
		payloadKind: request.tool.name,
		argumentsJson: request.argumentsJson,
		result,
		resultRef: `${toolResultRef(request)}/failed`,
		failCloseReason,
	};
}

function toolResultRef(request: ToolExecutionRequest): string {
	const invocation = request.invocationId?.trim();
	return invocation
		? `agent-runtime://${request.runId}/tools/${request.tool.name}/${encodeURIComponent(invocation)}`
		: `agent-runtime://${request.runId}/tools/${request.tool.name}`;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function composedAbortSignal(signals: Array<AbortSignal | undefined>): AbortSignal {
	const activeSignals = signals.filter((signal): signal is AbortSignal => signal !== undefined);
	if (activeSignals.length === 1) {
		return activeSignals[0];
	}
	const controller = new AbortController();
	const abort = (signal: AbortSignal) => {
		if (!controller.signal.aborted) {
			controller.abort(signal.reason);
		}
	};
	for (const signal of activeSignals) {
		if (signal.aborted) {
			abort(signal);
			break;
		}
		signal.addEventListener("abort", () => abort(signal), { once: true });
	}
	return controller.signal;
}
