import { AppApiRouteError } from "../../../http";
import { buildExecutionAuthorizationContext, type ResolvedAppPrincipal } from "../../auth";
import {
	type ChatConversation,
	type ChatMessage,
	DRAFT_CONVERSATION_TITLE,
	toConversationResponse,
} from "../../chat";
import type {
	ToolExecutionConversationContext,
	ToolExecutionPreviousEvidenceRef,
	ToolExecutionPreviousToolResultRef,
	ToolExecutionResponse,
} from "../../integration";
import {
	buildAcceptedRequestObservabilityFact,
	buildFinalizedRequestObservabilityFact,
} from "../../request-observability";
import { buildExecutionSessionProjection } from "../curriculum-session";
import type { AcceptRequestWrite, FinalizeRequestWrite, TurnDispatchStatus } from "../store";
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
	memory?: { enabled: boolean } | null;
	previousToolResults?: ToolExecutionPreviousToolResultRef[];
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
			previousToolResults: input.previousToolResults ?? [],
			session,
		}),
		...(input.memory ? { memory: { enabled: input.memory.enabled } } : {}),
		session,
	};
}

function buildConversationContextProjection(input: {
	conversation: ChatConversation;
	currentUserMessageContent: string;
	currentUserMessageCreatedAt: string;
	currentUserMessageId: string;
	previousToolResults: ToolExecutionPreviousToolResultRef[];
	session: ReturnType<typeof buildExecutionSessionProjection>;
}): ToolExecutionConversationContext {
	const priorMessages = input.conversation.messages;
	const parentMessage = priorMessages.at(-1) ?? null;
	const previousAssistant = [...input.conversation.messages]
		.reverse()
		.find((message) => message.role === "assistant");
	const previousEvidenceRefs = previousAssistant
		? extractPreviousEvidenceRefs(previousAssistant)
		: [];
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
		previousToolResults: input.previousToolResults,
		previousEvidenceRefs,
		recentTurns,
		schemaVersion: "conversation_context.v1",
		sessionState: input.session,
		userMessageId: input.currentUserMessageId,
	};
}

function extractPreviousEvidenceRefs(message: ChatMessage): ToolExecutionPreviousEvidenceRef[] {
	const refs: ToolExecutionPreviousEvidenceRef[] = [];
	for (const part of message.structuredParts) {
		if (part.type !== "source_items") {
			continue;
		}
		for (const [index, sourceItem] of part.sourceItems.entries()) {
			const record = sourceItem as unknown as Record<string, unknown>;
			const sourceId = readString(record, "sourceId", "source_id");
			const versionId = readString(record, "versionId", "version_id");
			const snapshotId = readString(record, "snapshotId", "snapshot_id");
			const accessScope = readString(record, "accessScope", "access_scope");
			const contentHash = readString(record, "contentHash", "content_hash");
			if (!(sourceId && (versionId || snapshotId) && accessScope && contentHash)) {
				continue;
			}
			refs.push({
				accessScope,
				collection: readString(record, "collection"),
				contentHash,
				documentId: readString(record, "documentId", "document_id"),
				evidenceId:
					readString(record, "evidenceId", "evidence_id") ?? `${message.id}:source_items:${index}`,
				evidenceRole: readString(record, "evidenceRole", "evidence_role"),
				sectionTitle: sourceItem.sectionTitle || undefined,
				snapshotId: snapshotId ?? undefined,
				sourceId,
				sourceKind: sourceItem.sourceKind,
				snippet: sourceItem.snippet ?? undefined,
				title: sourceItem.title || undefined,
				versionId: versionId ?? undefined,
			});
		}
	}
	return refs;
}

function readString(record: Record<string, unknown>, ...keys: string[]): string | undefined {
	for (const key of keys) {
		const value = record[key];
		if (typeof value === "string" && value.trim()) {
			return value.trim();
		}
	}
	return;
}

export function buildAcceptedWrite(input: {
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
	idempotencyKey: string | null;
	now: string;
	principal: ResolvedAppPrincipal;
	prompt: string;
	requestFingerprintSha256: string | null;
	requestId: string;
	requestedTool: string | null;
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
		...(input.conversationSeed ? { conversationSeed: input.conversationSeed } : {}),
		conversationTitle: input.conversationTitle,
		ownerUserId: input.conversation.ownerUserId,
		userMessage,
		turnDispatch: {
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
			requestedTool: input.requestedTool,
			resolvedTargets: [],
			selectedTool: null,
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
			requestedTool: input.requestedTool,
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
	requestedTool: string | null;
	response: ToolExecutionResponse;
	runId: string | null;
	safetyIdentifier: string | null;
	surface: string;
	startedAt: string;
	streamBrowserTtftMs?: number | null;
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
		selectedTool: input.response.selectedTool,
		status: input.response.status,
	});
	const resolvedTargets = [...normalizedExecutionResponse.resolvedTargets];
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
		assistantText =
			input.response.error?.message ||
			input.response.answerText ||
			(input.response.status === "approval_required"
				? "The request requires approval before it can continue."
				: input.response.status === "rejected"
					? "The request was rejected by execution policy."
					: input.response.status === "cancelled"
						? "The request was cancelled."
						: "The request could not be completed.");
		errorCode =
			input.response.error?.code ??
			(input.response.status === "approval_required"
				? "approval_required"
				: input.response.status === "rejected"
					? "request_rejected"
					: input.response.status === "cancelled"
						? "execution_cancelled"
						: "internal_error");
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
			resolvedTargets,
			selectedTool: input.response.selectedTool,
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
			requestedTool: input.requestedTool,
			resolvedTargets,
			response: normalizedExecutionResponse,
			runId,
			safetyIdentifier: input.safetyIdentifier,
			startedAt: input.startedAt,
			status,
			streamBrowserTtftMs: input.streamBrowserTtftMs,
			surface: input.surface,
			traceId: normalizedTraceId,
		}),
		sessionSlots:
			status === "completed"
				? (input.response.sessionUpdate?.upsertSlots ?? []).map((slot) => ({
						confirmed: slot.confirmed,
						name: slot.name,
						updatedAt: input.completedAt,
						value: slot.value,
					}))
				: [],
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
