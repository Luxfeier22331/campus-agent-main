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
import type { TurnDispatchPrincipalSnapshot } from "../../turn-dispatch-types";
import { buildExecutionSessionProjection } from "../curriculum-session";
import type {
	AcceptRequestWrite,
	FinalizeRequestWrite,
	FrozenDurableRunWrite,
	TurnDispatchMemorySnapshot,
	TurnDispatchStatus,
} from "../store";
import { publicExecutionFailure } from "./errors";
import { normalizeChatResponseStructuredParts, sanitizePublicAssistantText } from "./normalize";
import type { ChatCommandRequestKind, ChatCommandResponse, ChatCommandResult } from "./types";

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

export function buildAcceptedWrite(input: {
	assistantMessageId: string;
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
	freezeDurableRun: (memorySnapshot: TurnDispatchMemorySnapshot | null) => FrozenDurableRunWrite;
	idempotencyKey: string | null;
	now: string;
	principal: ResolvedAppPrincipal;
	prompt: string;
	requestFingerprintSha256: string | null;
	requestId: string;
	requestKind: ChatCommandRequestKind;
	safetyIdentifier: string | null;
	surface: string;
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
		requestId: input.requestId,
		retryable: null,
		structuredParts: [],
		turnSequence: input.turnSequence,
	};
	const principalSnapshot: TurnDispatchPrincipalSnapshot = {
		actor: input.principal.actor,
		authorization: input.principal.authorization ?? null,
		principal: {
			displayName: input.principal.principal.displayName,
			principalId: input.principal.principal.principalId,
			type: input.principal.principal.type,
		},
	};

	return {
		conversationBaseline: {
			activeBranchId: input.conversation.activeBranchId ?? "branch_active",
			activeMessageId: input.conversation.activeMessageId ?? null,
			activeRequestId: input.conversation.activeRequestId ?? null,
			activeTurnSequence: input.conversation.activeTurnSequence ?? 0,
			updatedAt: input.conversation.updatedAt,
		},
		...(input.conversationSeed ? { conversationSeed: input.conversationSeed } : {}),
		conversationTitle: input.conversationTitle,
		freezeDurableRun: input.freezeDurableRun,
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
			principalSnapshot,
			idempotencyKey: input.idempotencyKey,
			requestFingerprintSha256: input.requestFingerprintSha256,
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
		}),
		requestKind: input.requestKind,
	};
}

export function buildFinalizedWrite(input: {
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
	safetyIdentifier: string | null;
	stageTiming?: Record<string, unknown> | null;
	surface: string;
	startedAt: string;
	streamAppApiTtftMs?: number | null;
	turnSequence: number;
	userMessageId: string;
}): {
	responseBody: ChatCommandResponse;
	write: FinalizeRequestWrite;
} {
	const normalizedExecutionResponse = input.response;
	const structuredParts = normalizeChatResponseStructuredParts({
		result: input.response.result,
		status: input.response.status,
	});
	let assistantKind: ChatMessage["kind"];
	let assistantText: string;
	let errorCode: string | null = null;
	let retryable: boolean | null = null;
	let result: ChatCommandResult;
	let status: TurnDispatchStatus;

	if (
		input.response.status === "error" ||
		input.response.status === "approval_required" ||
		input.response.status === "rejected" ||
		input.response.status === "cancelled"
	) {
		assistantKind = "error";
		const publicFailure = publicExecutionFailure({
			...(input.response.error?.code ? { errorCode: input.response.error.code } : {}),
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
		};
		status = input.response.status;
	} else {
		assistantKind = "answer";
		assistantText = input.response.answerText;
		result = {
			kind: "answer",
			requestId: input.requestId,
			text: assistantText,
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
		structuredParts,
		turnSequence: input.turnSequence,
	};

	const write: FinalizeRequestWrite = {
		assistantMessage,
		conversationTitle: input.conversationTitle,
		ownerUserId: input.conversation.ownerUserId,
		turnDispatch: {
			requestId: input.requestId,
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
			...(input.projectionCloseoutMs === undefined
				? {}
				: { projectionCloseoutMs: input.projectionCloseoutMs }),
			requestId: input.requestId,
			response: normalizedExecutionResponse,
			safetyIdentifier: input.safetyIdentifier,
			startedAt: input.startedAt,
			...(input.stageTiming === undefined ? {} : { stageTiming: input.stageTiming }),
			status,
			...(input.streamAppApiTtftMs === undefined
				? {}
				: { streamAppApiTtftMs: input.streamAppApiTtftMs }),
			surface: input.surface,
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
		},
		write,
	};
}
