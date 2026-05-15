import { AppApiRouteError } from "../../../http";
import { type SupervisorExecutionResponse, SupervisorTransportError } from "../../integration";

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

export function toHandledErrorTransportOutcome(error: unknown): {
	answerText: string;
	error: {
		code: string;
		message: string;
		retryable: boolean;
	};
	followUpQuestion: string;
	result: null;
	selectedTarget: null;
	status: "error";
	traceId: string;
} {
	if (error instanceof SupervisorTransportError) {
		return {
			answerText: "",
			error: {
				code: error.code,
				message: error.message,
				retryable: error.retryable,
			},
			followUpQuestion: "",
			result: null,
			selectedTarget: null,
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
		result: null,
		selectedTarget: null,
		status: "error",
		traceId: "",
	};
}

export function buildAbuseThrottleRejectedResponse(input: {
	traceId: string;
}): SupervisorExecutionResponse {
	return {
		answerText: "Too many requests. Please wait a few minutes and try again.",
		error: {
			code: "rate_limit_exceeded",
			message: "Too many requests. Please wait a few minutes and try again.",
			retryable: false,
		},
		followUpQuestion: "",
		observability: {
			aclAnomalyCode: null,
			aclDecision: "denied",
			cachedInputTokens: null,
			candidateCount: null,
			citationCount: null,
			citationExpected: null,
			citationMissing: null,
			estimatedCostMicrousd: null,
			failClosed: true,
			inputTokens: null,
			modelName: null,
			modelProvider: null,
			outputTokens: null,
			policyReason: "rate_limit_exceeded",
			refusalClass: "rejected",
			retrievedSourceCount: null,
			retrievalAttempted: false,
			scopeClass: null,
			semanticOutcome: "policy_refusal",
		},
		result: null,
		selectedTarget: null,
		status: "rejected",
		traceId: input.traceId,
	};
}
