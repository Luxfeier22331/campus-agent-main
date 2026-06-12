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
					access_context: {},
				}),
				signal: AbortSignal.timeout(request.tool.timeoutMs),
			});
		} catch (error) {
			return failedToolResult(request, "tool_handler_request_failed", {
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
			capability: request.tool.capability,
			payloadKind: request.tool.name,
			result,
			resultRef: `agent-runtime://${request.runId}/tools/${request.tool.name}`,
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
		capability: request.tool.capability,
		payloadKind: request.tool.name,
		result,
		resultRef: `agent-runtime://${request.runId}/tools/${request.tool.name}/failed`,
		failCloseReason,
	};
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
