import { AppApiRouteError } from "../../../http";
import { ExecutionControlTransportError, type ToolExecutionResponse } from "../../integration";
import { publicExecutionFailure } from "./writes";

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
		const failure = publicExecutionFailure({ errorCode: error.code, status: "error" });
		return {
			answerText: "",
			error: {
				code: failure.errorCode,
				message: failure.message,
				retryable: error.retryable,
			},
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
			message: "Unexpected execution failure.",
			retryable: false,
		},
		modelUsage: zeroModelUsage(),
		result: null,
		status: "error",
		traceId: "",
	};
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
