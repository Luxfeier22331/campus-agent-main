import { AppApiRouteError } from "../../../http";
import { ExecutionControlTransportError, type ToolExecutionResponse } from "../../integration";

const BOUNDED_EXECUTION_ERROR_CODE = /^[a-z0-9_-]{1,64}$/u;
const PROVIDER_EXECUTION_ERROR_CODES = new Set([
	"provider_connection_failed",
	"provider_http_failed",
	"provider_rate_limited",
	"provider_timeout",
	"provider_unavailable",
]);
const TIMEOUT_EXECUTION_ERROR_CODES = new Set([
	"agent_deadline_exceeded",
	"agent_runtime_timeout",
	"execution_timeout",
]);
const RUNTIME_INVARIANT_ERROR_CODES = new Set([
	"admission_snapshot_invalid",
	"admission_snapshot_mismatch",
	"agent_invocation_envelope_invalid",
	"agent_runtime_incomplete",
	"agent_runtime_missing_final_output",
	"agent_runtime_not_configured",
	"agent_runtime_request_failed",
	"agent_runtime_response_invalid",
	"agent_runtime_result_invalid",
	"agent_runtime_unauthorized",
	"execution_input_metadata_invalid",
	"finalization_input_invalid",
	"finalization_projection_conflict",
	"finalization_replay_conflict",
	"finalization_replay_incomplete",
	"invalid_request",
	"invalid_model_target_sha256",
	"model_target_mismatch",
	"temporal_execution_binding_mismatch",
	"tool_contract_mismatch",
	"workflow_canceled_without_terminal_projection",
	"workflow_completed_without_terminal_projection",
	"workflow_failed_without_terminal_projection",
	"workflow_start_after_dispatch_invalid",
	"workflow_start_not_dispatched_invalid",
	"workflow_start_remote_identity_conflict",
	"workflow_successor_without_authorization",
	"workflow_terminated_without_terminal_projection",
]);
const PUBLIC_EXECUTION_ERROR_CODES = new Set([
	"approval_required",
	"context_budget_exceeded",
	"dependency_not_ready",
	"execution_cancelled",
	"execution_control_invalid_error_envelope",
	"execution_control_invalid_response",
	"execution_control_unavailable",
	"execution_invalid_public_response",
	"execution_runtime_required",
	"execution_status_pending",
	"execution_timeout",
	"forbidden",
	"idempotency_conflict",
	"internal_error",
	"invalid_request",
	"max_turns_exceeded",
	"personal_memory_not_configured",
	"product_finalization_missing",
	"provider_unavailable",
	"rate_limit_exceeded",
	"request_not_found",
	"request_rejected",
	"run_expired",
	"run_failed",
	"runtime_invariant_failed",
	"tool_execution_failed",
	"validation_failed",
]);

function boundedExecutionErrorCode(value: string | null | undefined): string {
	const code = value?.trim() ?? "";
	if (!BOUNDED_EXECUTION_ERROR_CODE.test(code)) {
		return "internal_error";
	}
	if (PROVIDER_EXECUTION_ERROR_CODES.has(code)) {
		return "provider_unavailable";
	}
	if (TIMEOUT_EXECUTION_ERROR_CODES.has(code)) {
		return "execution_timeout";
	}
	if (RUNTIME_INVARIANT_ERROR_CODES.has(code)) {
		return "runtime_invariant_failed";
	}
	return PUBLIC_EXECUTION_ERROR_CODES.has(code) ? code : "run_failed";
}

export function publicExecutionFailure(input: {
	errorCode?: string | null;
	status: ToolExecutionResponse["status"];
}): { errorCode: string; message: string } {
	const suppliedErrorCode = input.errorCode?.trim();
	const errorCode = suppliedErrorCode
		? boundedExecutionErrorCode(suppliedErrorCode)
		: input.status === "approval_required"
			? "approval_required"
			: input.status === "rejected"
				? "request_rejected"
				: input.status === "cancelled"
					? "execution_cancelled"
					: "internal_error";
	let message: string;
	if (errorCode === "approval_required") {
		message = "The request requires approval before it can continue.";
	} else if (errorCode === "request_rejected") {
		message = "The request was rejected by execution policy.";
	} else if (errorCode === "execution_cancelled") {
		message = "The request was cancelled.";
	} else if (errorCode === "rate_limit_exceeded") {
		message = "Too many requests. Please wait a few minutes and try again.";
	} else if (errorCode === "run_expired") {
		message = "The request expired before it completed.";
	} else if (["personal_memory_not_configured"].includes(errorCode)) {
		message = "Personal memory could not be loaded for this request.";
	} else if (errorCode === "execution_timeout") {
		message = "本次回答超时，未能完成。";
	} else if (errorCode === "provider_unavailable") {
		message = "The answer provider is temporarily unavailable.";
	} else if (errorCode === "tool_execution_failed") {
		message = "A runtime tool could not complete.";
	} else if (errorCode === "context_budget_exceeded") {
		message = "The conversation is too large to process safely.";
	} else if (errorCode === "max_turns_exceeded") {
		message = "The request could not be completed within the allowed steps.";
	} else {
		message = "The request could not be completed.";
	}
	return { errorCode, message };
}

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
	};
}

export function buildAbuseThrottleRejectedResponse(): ToolExecutionResponse {
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
	};
}

function zeroModelUsage(): ToolExecutionResponse["modelUsage"] {
	return { cachedInputTokens: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 };
}
