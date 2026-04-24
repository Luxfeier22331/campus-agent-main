import { buildExecutionAuthorizationContext, type ResolvedAppPrincipal } from "../../auth";
import {
	type ChatConversation,
	type ChatMessage,
	DRAFT_CONVERSATION_TITLE,
	toConversationResponse,
} from "../../chat";
import type { RequestedScope, SupervisorExecutionResponse } from "../../integration";
import { extractRequestDiagnosticsSummary } from "../../request-diagnostics";
import {
	buildAcceptedRequestObservabilityFact,
	buildFinalizedRequestObservabilityFact,
} from "../../request-observability";
import type { VersionQuery } from "../../version-query";
import {
	buildSupervisorSessionProjection,
	deriveCurriculumSessionSlots,
} from "../curriculum-session";
import type { AcceptRequestWrite, FinalizeRequestWrite, RequestExecutionStatus } from "../store";
import {
	extractSourceDocIds,
	normalizePlaceCardPart,
	previewText,
	sanitizePublicAssistantText,
} from "./normalize";
import type { ChatCommandResponse, ChatCommandResult } from "./types";

export function buildConversationTitle(currentTitle: string, prompt: string): string {
	if (currentTitle !== DRAFT_CONVERSATION_TITLE || !prompt.trim()) {
		return currentTitle;
	}

	return prompt.length <= 80 ? prompt : `${prompt.slice(0, 77)}...`;
}

export function buildSupervisorContextProjection(input: {
	actor: ResolvedAppPrincipal["actor"];
	authorization: ResolvedAppPrincipal["authorization"];
	sessionSlots: ChatConversation["sessionSlots"];
	turnCount: number;
}) {
	return {
		actor: input.actor,
		authorization: input.authorization ?? buildExecutionAuthorizationContext(input.actor),
		profileMemory: {
			items: [],
		},
		session: buildSupervisorSessionProjection({
			sessionSlots: input.sessionSlots,
			turnCount: input.turnCount,
		}),
	};
}

export function buildAcceptedWrite(input: {
	conversation: ChatConversation;
	conversationSeed?: {
		id: string;
		ownerUserId: string;
		title: string;
		createdAt: string;
		updatedAt: string;
	};
	conversationTitle: string;
	idempotencyKey: string | null;
	now: string;
	principal: ResolvedAppPrincipal;
	prompt: string;
	requestFingerprintSha256: string | null;
	requestId: string;
	requestedCapability: string | null;
	requestedScope: RequestedScope | null;
	versionQuery: VersionQuery | null;
	safetyIdentifier: string | null;
	surface: string;
	traceId: string;
	userMessageId: string;
	outboxEventId: string;
}): AcceptRequestWrite {
	const userMessage: ChatMessage = {
		id: input.userMessageId,
		conversationId: input.conversation.id,
		role: "user",
		kind: null,
		text: input.prompt,
		createdAt: input.now,
		requestId: null,
		retryable: null,
		structuredParts: [],
	};

	return {
		...(input.conversationSeed ? { conversationSeed: input.conversationSeed } : {}),
		conversationTitle: input.conversationTitle,
		ownerUserId: input.conversation.ownerUserId,
		userMessage,
		requestExecution: {
			requestId: input.requestId,
			conversationId: input.conversation.id,
			userMessageId: input.userMessageId,
			assistantMessageId: null,
			surface: input.surface,
			actorUserId: input.principal.actor.userId,
			actorPrincipalId: input.principal.actor.principalId,
			actorRoles: input.principal.actor.roles,
			actorDepartments: input.principal.actor.departments,
			principalType: input.principal.principal.type,
			principalLabel: input.principal.principal.displayName,
			entitlementSnapshotId: input.principal.authorization?.entitlementSnapshotId || null,
			entitlementGroups: input.principal.authorization?.entitlementGroups ?? [],
			visibilityScope: input.principal.authorization?.visibilityScope ?? null,
			applicabilityScope: input.principal.authorization?.applicabilityScope ?? null,
			idempotencyKey: input.idempotencyKey,
			requestFingerprintSha256: input.requestFingerprintSha256,
			traceId: input.traceId,
			safetyIdentifier: input.safetyIdentifier,
			requestedCapability: input.requestedCapability,
			requestedScope: input.requestedScope,
			versionQuery: input.versionQuery,
			resolvedScope: null,
			selectedTarget: null,
			status: "accepted",
			errorCode: null,
			questionPreview: previewText(input.prompt),
			answerPreview: null,
			diagnostics: null,
			sourceDocIds: [],
			startedAt: input.now,
			completedAt: null,
			durationMs: null,
			createdAt: input.now,
			updatedAt: input.now,
		},
		requestObservabilityFact: buildAcceptedRequestObservabilityFact({
			conversationId: input.conversation.id,
			principal: input.principal,
			requestId: input.requestId,
			requestedCapability: input.requestedCapability,
			requestedScope: input.requestedScope,
			resolvedScope: null,
			safetyIdentifier: input.safetyIdentifier,
			startedAt: input.now,
			surface: input.surface,
			traceId: input.traceId,
			versionQuery: input.versionQuery,
		}),
		outboxEvent: {
			eventId: input.outboxEventId,
			requestId: input.requestId,
			eventType: "request.accepted",
			payload: {
				requestId: input.requestId,
				traceId: input.traceId,
				conversationId: input.conversation.id,
				status: "accepted",
				questionPreview: previewText(input.prompt),
				requestedCapability: input.requestedCapability,
				requestedScope: input.requestedScope,
				surface: input.surface,
			},
			occurredAt: input.now,
			availableAt: input.now,
			processedAt: null,
			attemptCount: 0,
			lastError: null,
		},
	};
}

function resolveFinalizedScope(input: {
	requestedScope: RequestedScope | null;
	response: SupervisorExecutionResponse;
}): RequestedScope | null {
	const corpus = input.response.observability?.resolvedScopeCorpus?.trim();
	const collection = input.response.observability?.resolvedScopeCollection?.trim();
	if (corpus && collection) {
		return { collection, corpus };
	}

	return input.requestedScope;
}

export function buildFinalizedWrite(input: {
	assistantMessageId: string;
	conversation: ChatConversation;
	conversationTitle: string;
	completedAt: string;
	durationMs: number;
	outboxEventId: string;
	principal: ResolvedAppPrincipal;
	requestId: string;
	requestedCapability: string | null;
	requestedScope: RequestedScope | null;
	response: SupervisorExecutionResponse;
	versionQuery: VersionQuery | null;
	safetyIdentifier: string | null;
	surface: string;
	startedAt: string;
	traceId: string;
}): {
	responseBody: ChatCommandResponse;
	write: FinalizeRequestWrite;
} {
	const normalizedTraceId = input.response.traceId || input.traceId;
	const normalizedSupervisorResponse = {
		...input.response,
		traceId: normalizedTraceId,
	} satisfies SupervisorExecutionResponse;
	const diagnostics = extractRequestDiagnosticsSummary(input.response.result);
	const sourceDocIds = extractSourceDocIds(input.response.result);
	const structuredParts = normalizePlaceCardPart({
		result: input.response.result,
		selectedTarget: input.response.selectedTarget,
		status: input.response.status,
	});
	const resolvedScope = resolveFinalizedScope({
		requestedScope: input.requestedScope,
		response: normalizedSupervisorResponse,
	});

	let assistantKind: ChatMessage["kind"];
	let assistantText: string;
	let errorCode: string | null = null;
	let retryable: boolean | null = null;
	let outboxEventType: string;
	let result: ChatCommandResult;
	let status: RequestExecutionStatus;

	if (input.response.status === "needs_clarification") {
		assistantKind = "clarification";
		assistantText = input.response.followUpQuestion || input.response.answerText;
		outboxEventType = "request.needs_clarification";
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
		outboxEventType = "request.no_answer";
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
		input.response.status === "rejected"
	) {
		assistantKind = "error";
		assistantText =
			input.response.error?.message ||
			input.response.answerText ||
			(input.response.status === "approval_required"
				? "The request requires approval before it can continue."
				: input.response.status === "rejected"
					? "The request was rejected by supervisor policy."
					: "The request could not be completed.");
		errorCode =
			input.response.error?.code ??
			(input.response.status === "approval_required"
				? "approval_required"
				: input.response.status === "rejected"
					? "request_rejected"
					: "internal_error");
		retryable = input.response.error?.retryable ?? input.response.status === "error";
		outboxEventType = `request.${input.response.status}`;
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
		outboxEventType = "request.completed";
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
		role: "assistant",
		kind: assistantKind,
		text: assistantText,
		createdAt: input.completedAt,
		requestId: input.requestId,
		retryable,
		structuredParts,
	};

	const write: FinalizeRequestWrite = {
		assistantMessage,
		conversationTitle: input.conversationTitle,
		ownerUserId: input.conversation.ownerUserId,
		requestExecution: {
			requestId: input.requestId,
			conversationId: input.conversation.id,
			userMessageId: "",
			assistantMessageId: input.assistantMessageId,
			surface: input.surface,
			actorUserId: input.conversation.ownerUserId,
			actorPrincipalId: input.conversation.ownerUserId,
			actorRoles: [],
			actorDepartments: [],
			principalType: input.principal.principal.type,
			principalLabel: null,
			entitlementSnapshotId: null,
			entitlementGroups: [],
			visibilityScope: null,
			applicabilityScope: null,
			idempotencyKey: null,
			requestFingerprintSha256: null,
			traceId: normalizedTraceId,
			safetyIdentifier: input.safetyIdentifier,
			requestedCapability: input.requestedCapability,
			requestedScope: input.requestedScope,
			versionQuery: input.versionQuery,
			resolvedScope,
			selectedTarget: input.response.selectedTarget,
			status,
			errorCode,
			questionPreview: "",
			answerPreview: previewText(assistantText),
			diagnostics,
			sourceDocIds,
			startedAt: input.startedAt,
			completedAt: input.completedAt,
			durationMs: input.durationMs,
			createdAt: input.startedAt,
			updatedAt: input.completedAt,
		},
		requestObservabilityFact: buildFinalizedRequestObservabilityFact({
			completedAt: input.completedAt,
			conversationId: input.conversation.id,
			diagnostics,
			durationMs: input.durationMs,
			errorCode,
			principal: input.principal,
			requestId: input.requestId,
			requestedCapability: input.requestedCapability,
			requestedScope: input.requestedScope,
			resolvedScope,
			response: normalizedSupervisorResponse,
			safetyIdentifier: input.safetyIdentifier,
			sourceDocIds,
			startedAt: input.startedAt,
			status,
			surface: input.surface,
			traceId: normalizedTraceId,
			versionQuery: input.versionQuery,
		}),
		outboxEvent: {
			eventId: input.outboxEventId,
			requestId: input.requestId,
			eventType: outboxEventType,
			payload: {
				requestId: input.requestId,
				traceId: normalizedTraceId,
				conversationId: input.conversation.id,
				status,
				selectedTarget: input.response.selectedTarget,
				answerPreview: previewText(assistantText),
				errorCode,
				...(diagnostics ? { diagnostics } : {}),
				sourceDocIds,
			},
			occurredAt: input.completedAt,
			availableAt: input.completedAt,
			processedAt: null,
			attemptCount: 0,
			lastError: null,
		},
		sessionSlots: deriveCurriculumSessionSlots({
			diagnostics,
			existingSlots: input.conversation.sessionSlots,
			finalizedAt: input.completedAt,
			status,
		}),
	};

	return {
		responseBody: {
			answer: {
				conversation: toConversationResponse(input.conversation),
				result,
			},
			requestId: input.requestId,
			supervisor: normalizedSupervisorResponse,
			traceId: normalizedTraceId,
		},
		write,
	};
}
