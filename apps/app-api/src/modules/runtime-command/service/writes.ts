import { AppApiRouteError } from "../../../http";
import { buildExecutionAuthorizationContext, type ResolvedAppPrincipal } from "../../auth";
import {
	type ChatConversation,
	type ChatMessage,
	DRAFT_CONVERSATION_TITLE,
	toConversationResponse,
} from "../../chat";
import type { ToolExecutionConversationContext, ToolExecutionResponse } from "../../integration";
import {
	buildAcceptedRequestObservabilityFact,
	buildFinalizedRequestObservabilityFact,
} from "../../request-observability";
import { buildExecutionSessionProjection } from "../curriculum-session";
import type {
	AcceptRequestWrite,
	FinalizeRequestWrite,
	FrozenChatAdmissionWrite,
	TurnDispatchMemorySnapshot,
	TurnDispatchStatus,
} from "../store";
import { normalizeChatResponseStructuredParts, sanitizePublicAssistantText } from "./normalize";
import type { ChatCommandResponse, ChatCommandResult } from "./types";

export function buildConversationTitle(currentTitle: string, prompt: string): string {
	if (currentTitle !== DRAFT_CONVERSATION_TITLE || !prompt.trim()) {
		return currentTitle;
	}

	return prompt.length <= 80 ? prompt : `${prompt.slice(0, 77)}...`;
}

export function buildToolExecutionContextProjection(input: {
	actor: ResolvedAppPrincipal["actor"];
	authorization: ResolvedAppPrincipal["authorization"];
	conversation: ChatConversation;
	currentUserMessageContent: string;
	currentUserMessageCreatedAt: string;
	currentUserMessageId: string;
	memory?: {
		appendEnabled: boolean;
		ownerGeneration: number;
		ownerSequence: number;
		recallEnabled: boolean;
	} | null;
	sessionSlots: ChatConversation["sessionSlots"];
	turnCount: number;
}) {
	const session = buildExecutionSessionProjection({
		sessionSlots: input.sessionSlots,
		turnCount: input.turnCount,
	});
	return {
		actor: input.actor,
		authorization: input.authorization ?? buildExecutionAuthorizationContext(input.actor),
		conversation: buildConversationContextProjection({
			conversation: input.conversation,
			currentUserMessageContent: input.currentUserMessageContent,
			currentUserMessageCreatedAt: input.currentUserMessageCreatedAt,
			currentUserMessageId: input.currentUserMessageId,
			session,
		}),
		...(input.memory ? { memory: input.memory } : {}),
		session,
	};
}

function buildConversationContextProjection(input: {
	conversation: ChatConversation;
	currentUserMessageContent: string;
	currentUserMessageCreatedAt: string;
	currentUserMessageId: string;
	session: ReturnType<typeof buildExecutionSessionProjection>;
}): ToolExecutionConversationContext {
	const priorMessages = input.conversation.messages;
	const parentMessage = priorMessages.at(-1) ?? null;
	const recentTurns: ToolExecutionConversationContext["recentTurns"] = priorMessages.map(
		(message) => ({
			content: message.text,
			createdAt: message.createdAt,
			messageId: message.id,
			role: message.role,
		}),
	);

	return {
		conversationId: input.conversation.id,
		currentUserMessage: {
			role: "user",
			content: input.currentUserMessageContent,
			createdAt: input.currentUserMessageCreatedAt,
		},
		parentMessageId: parentMessage?.id ?? null,
		recentTurns,
		schemaVersion: "conversation_context.v1",
		sessionState: input.session,
		userMessageId: input.currentUserMessageId,
	};
}

const BOUNDED_EXECUTION_ERROR_CODE = /^[a-z0-9_-]{1,64}$/u;
const PUBLIC_EXECUTION_ERROR_CODES = new Set([
	"admission_confirmation_uncertain",
	"admission_identity_conflict",
	"admission_pending",
	"agent_deadline_exceeded",
	"agent_runtime_failed",
	"agent_runtime_timeout",
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
	"provider_config_missing",
	"provider_unavailable",
	"rate_limit_exceeded",
	"request_in_progress",
	"request_not_found",
	"request_rejected",
	"retrieval_lookup_failed",
	"run_expired",
	"run_failed",
	"runtime_invariant_failed",
	"tool_execution_failed",
	"validation_failed",
]);

function boundedExecutionErrorCode(value: string | null | undefined): string {
	const code = value?.trim() ?? "";
	return BOUNDED_EXECUTION_ERROR_CODE.test(code) && PUBLIC_EXECUTION_ERROR_CODES.has(code)
		? code
		: "internal_error";
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
	} else if (
		["agent_runtime_timeout", "agent_deadline_exceeded", "execution_timeout"].includes(errorCode)
	) {
		message = "The agent runtime did not complete before its deadline.";
	} else if (
		["agent_runtime_failed", "provider_config_missing", "provider_unavailable"].includes(errorCode)
	) {
		message = "The answer provider is temporarily unavailable.";
	} else if (["retrieval_lookup_failed", "tool_execution_failed"].includes(errorCode)) {
		message = "Required campus information could not be retrieved.";
	} else if (errorCode === "context_budget_exceeded") {
		message = "The conversation is too large to process safely.";
	} else if (errorCode === "max_turns_exceeded") {
		message = "The request could not be completed within the allowed steps.";
	} else {
		message = "The request could not be completed.";
	}
	return { errorCode, message };
}

export function buildAcceptedWrite(input: {
	assistantMessageId: string;
	captureMemorySnapshot: boolean;
	branchId: string;
	conversation: ChatConversation;
	conversationSeed?: {
		id: string;
		ownerUserId: string;
		title: string;
		createdAt: string;
		updatedAt: string;
	};
	conversationTitle: string;
	freezeDurableAdmission: (
		memorySnapshot: TurnDispatchMemorySnapshot | null,
	) => FrozenChatAdmissionWrite;
	idempotencyKey: string | null;
	now: string;
	principal: ResolvedAppPrincipal;
	prompt: string;
	requestFingerprintSha256: string | null;
	requestId: string;
	runId: string | null;
	safetyIdentifier: string | null;
	surface: string;
	traceId: string;
	turnSequence: number;
	userMessageId: string;
}): AcceptRequestWrite {
	const parentMessageId = input.conversation.messages.at(-1)?.id ?? null;
	const userMessage: ChatMessage = {
		id: input.userMessageId,
		conversationId: input.conversation.id,
		branchId: input.branchId,
		isActiveBranchHead: true,
		role: "user",
		kind: null,
		text: input.prompt,
		createdAt: input.now,
		parentMessageId,
		requestId: null,
		retryable: null,
		runId: input.runId,
		structuredParts: [],
		turnSequence: input.turnSequence,
	};

	return {
		captureMemorySnapshot: input.captureMemorySnapshot,
		conversationBaseline: {
			activeBranchId: input.conversation.activeBranchId ?? "branch_active",
			activeMessageId: input.conversation.activeMessageId ?? null,
			activeRunId: input.conversation.activeRunId ?? null,
			activeTurnSequence: input.conversation.activeTurnSequence ?? 0,
			updatedAt: input.conversation.updatedAt,
		},
		...(input.conversationSeed ? { conversationSeed: input.conversationSeed } : {}),
		conversationTitle: input.conversationTitle,
		freezeDurableAdmission: input.freezeDurableAdmission,
		ownerUserId: input.conversation.ownerUserId,
		userMessage,
		turnDispatch: {
			assistantMessageId: input.assistantMessageId,
			requestId: input.requestId,
			conversationId: input.conversation.id,
			userMessageId: input.userMessageId,
			turnSequence: input.turnSequence,
			surface: input.surface,
			ownerUserId: input.conversation.ownerUserId,
			actorUserId: input.principal.actor.userId,
			principalSnapshot: {
				actor: input.principal.actor,
				authorization: input.principal.authorization ?? null,
				principal: {
					displayName: input.principal.principal.displayName,
					principalId: input.principal.principal.principalId,
					type: input.principal.principal.type,
				},
			},
			idempotencyKey: input.idempotencyKey,
			requestFingerprintSha256: input.requestFingerprintSha256,
			traceId: input.traceId,
			runId: input.runId,
			safetyIdentifier: input.safetyIdentifier,
			status: "accepted",
			errorCode: null,
			completedAt: null,
			createdAt: input.now,
			updatedAt: input.now,
		},
		requestObservabilityFact: buildAcceptedRequestObservabilityFact({
			conversationId: input.conversation.id,
			principal: input.principal,
			requestId: input.requestId,
			safetyIdentifier: input.safetyIdentifier,
			startedAt: input.now,
			surface: input.surface,
			traceId: input.traceId,
		}),
	};
}

function requireFinalizationRunId(value: string | null): string {
	if (typeof value === "string" && value.trim()) {
		return value.trim();
	}
	throw new AppApiRouteError({
		code: "validation_failed",
		message: "request finalization requires run_id for observability projection.",
		retryable: false,
		status: 422,
	});
}

function requireFinalizationTraceMatch(input: {
	acceptedTraceId: string;
	requestId: string;
	responseTraceId: string;
}): string {
	if (input.responseTraceId === input.acceptedTraceId) {
		return input.acceptedTraceId;
	}
	throw new AppApiRouteError({
		code: "validation_failed",
		details: { field: "trace_id", requestId: input.requestId },
		message: "request finalization trace_id must match the accepted request trace_id.",
		retryable: false,
		status: 422,
		traceId: input.acceptedTraceId,
	});
}

export function buildFinalizedWrite(input: {
	allowedPublicNoticeHosts?: readonly string[];
	assistantMessageId: string;
	branchId: string;
	conversation: ChatConversation;
	conversationTitle: string;
	completedAt: string;
	durationMs: number;
	principal: ResolvedAppPrincipal;
	projectionCloseoutMs?: number | null;
	requestId: string;
	response: ToolExecutionResponse;
	runId: string | null;
	safetyIdentifier: string | null;
	stageTiming?: Record<string, unknown> | null;
	surface: string;
	startedAt: string;
	streamAppApiTtftMs?: number | null;
	traceId: string;
	turnSequence: number;
	userMessageId: string;
}): {
	responseBody: ChatCommandResponse;
	write: FinalizeRequestWrite;
} {
	const normalizedTraceId = requireFinalizationTraceMatch({
		acceptedTraceId: input.traceId,
		requestId: input.requestId,
		responseTraceId: input.response.traceId,
	});
	const runId = requireFinalizationRunId(input.runId);
	const normalizedExecutionResponse = {
		...input.response,
		traceId: normalizedTraceId,
	} satisfies ToolExecutionResponse;
	const structuredParts = normalizeChatResponseStructuredParts({
		allowedPublicNoticeHosts: input.allowedPublicNoticeHosts,
		result: input.response.result,
		status: input.response.status,
	});
	let assistantKind: ChatMessage["kind"];
	let assistantText: string;
	let errorCode: string | null = null;
	let retryable: boolean | null = null;
	let result: ChatCommandResult;
	let status: TurnDispatchStatus;

	if (input.response.status === "needs_clarification") {
		assistantKind = "clarification";
		assistantText = input.response.followUpQuestion || input.response.answerText;
		result = {
			kind: "clarification",
			requestId: input.requestId,
			text: assistantText,
			traceId: normalizedTraceId,
		};
		status = "needs_clarification";
	} else if (input.response.status === "no_answer") {
		assistantKind = "no_answer";
		assistantText = input.response.answerText;
		result = {
			kind: "no_answer",
			requestId: input.requestId,
			text: assistantText,
			traceId: normalizedTraceId,
		};
		status = "no_answer";
	} else if (
		input.response.status === "error" ||
		input.response.status === "approval_required" ||
		input.response.status === "rejected" ||
		input.response.status === "cancelled"
	) {
		assistantKind = "error";
		const publicFailure = publicExecutionFailure({
			errorCode: input.response.error?.code,
			status: input.response.status,
		});
		assistantText = publicFailure.message;
		errorCode = publicFailure.errorCode;
		retryable = input.response.error?.retryable ?? false;
		result = {
			kind: "error",
			message: assistantText,
			errorCode,
			requestId: input.requestId,
			retryable,
			traceId: normalizedTraceId,
		};
		status = input.response.status;
	} else {
		assistantKind = "answer";
		assistantText = input.response.answerText;
		result = {
			kind: "answer",
			requestId: input.requestId,
			text: assistantText,
			traceId: normalizedTraceId,
		};
		status = "completed";
	}

	assistantText = sanitizePublicAssistantText({
		status: input.response.status,
		text: assistantText,
	});
	if (result.kind === "error") {
		result = {
			...result,
			message: assistantText,
		};
	} else {
		result = {
			...result,
			text: assistantText,
		};
	}

	const assistantMessage: ChatMessage = {
		id: input.assistantMessageId,
		conversationId: input.conversation.id,
		branchId: input.branchId,
		isActiveBranchHead: true,
		role: "assistant",
		kind: assistantKind,
		text: assistantText,
		createdAt: input.completedAt,
		parentMessageId: input.userMessageId,
		requestId: input.requestId,
		retryable,
		runId,
		structuredParts,
		turnSequence: input.turnSequence,
	};

	const write: FinalizeRequestWrite = {
		assistantMessage,
		conversationTitle: input.conversationTitle,
		ownerUserId: input.conversation.ownerUserId,
		turnDispatch: {
			requestId: input.requestId,
			runId,
			safetyIdentifier: input.safetyIdentifier,
			status,
			errorCode,
			turnSequence: input.turnSequence,
			completedAt: input.completedAt,
			updatedAt: input.completedAt,
		},
		requestObservabilityFact: buildFinalizedRequestObservabilityFact({
			completedAt: input.completedAt,
			conversationId: input.conversation.id,
			durationMs: input.durationMs,
			errorCode,
			principal: input.principal,
			projectionCloseoutMs: input.projectionCloseoutMs,
			requestId: input.requestId,
			response: normalizedExecutionResponse,
			runId,
			safetyIdentifier: input.safetyIdentifier,
			startedAt: input.startedAt,
			stageTiming: input.stageTiming,
			status,
			streamAppApiTtftMs: input.streamAppApiTtftMs,
			surface: input.surface,
			traceId: normalizedTraceId,
		}),
		sessionSlots: [],
	};

	return {
		responseBody: {
			answer: {
				conversation: toConversationResponse(input.conversation),
				result,
			},
			execution: normalizedExecutionResponse,
			requestId: input.requestId,
			traceId: normalizedTraceId,
		},
		write,
	};
}
