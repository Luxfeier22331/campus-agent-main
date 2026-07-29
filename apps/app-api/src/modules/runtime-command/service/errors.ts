import { AppApiRouteError } from "../../../http";
import { ExecutionControlTransportError, type ToolExecutionResponse } from "../../integration";

export function createPreAcceptError(input: {
	code: string;
	details?: unknown;
	message: string;
	retryable?: boolean;
	status: number;
}): AppApiRouteError {
	return new AppApiRouteError({
		code: input.code,
		details: input.details,
		message: input.message,
		retryable: input.retryable ?? false,
		status: input.status,
	});
}

export function toHandledErrorTransportOutcome(error: unknown): ToolExecutionResponse & {
	error: NonNullable<ToolExecutionResponse["error"]>;
	status: "error";
} {
	if (error instanceof ExecutionControlTransportError) {
		const publicMessage = publicTransportErrorMessage(error);
		return {
			answerText: "",
			error: {
				code: error.code,
				message: publicMessage,
				retryable: error.retryable,
			},
			followUpQuestion: "",
			modelUsage: zeroModelUsage(),
			result: null,
			status: "error",
			traceId: "",
		};
	}

	return {
		answerText: "",
		error: {
			code: "internal_error",
			message: error instanceof Error ? error.message : "Unexpected execution failure.",
			retryable: false,
		},
		followUpQuestion: "",
		modelUsage: zeroModelUsage(),
		result: null,
		status: "error",
		traceId: "",
	};
}

function publicTransportErrorMessage(error: ExecutionControlTransportError): string {
	if (error.code === "execution_control_unavailable") {
		return "问答服务暂时无法连接，请稍后再试。";
	}
	return error.message;
}

export function buildAbuseThrottleRejectedResponse(input: {
	traceId: string;
}): ToolExecutionResponse {
	return {
		answerText: "Too many requests. Please wait a few minutes and try again.",
		error: {
			code: "rate_limit_exceeded",
			message: "Too many requests. Please wait a few minutes and try again.",
			retryable: false,
		},
		followUpQuestion: "",
		observability: {
			agentRuntime: null,
			modelName: null,
			modelProvider: null,
			promptTrace: null,
			terminalReason: "rate_limit_exceeded",
		},
		modelUsage: zeroModelUsage(),
		result: null,
		status: "rejected",
		traceId: input.traceId,
	};
}

function zeroModelUsage(): ToolExecutionResponse["modelUsage"] {
	return { cachedInputTokens: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 };
}
