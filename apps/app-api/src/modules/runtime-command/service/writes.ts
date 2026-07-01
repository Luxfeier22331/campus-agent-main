import { buildExecutionAuthorizationContext, type ResolvedAppPrincipal } from "../../auth";
import {
	type ChatConversation,
	type ChatMessage,
	DRAFT_CONVERSATION_TITLE,
	toConversationResponse,
} from "../../chat";
import type {
	RequestedScope,
	ToolExecutionConversationContext,
	ToolExecutionPreviousEvidenceRef,
	ToolExecutionPreviousToolResultRef,
	ToolExecutionResponse,
} from "../../integration";
import { extractRequestDiagnosticsSummary } from "../../request-diagnostics";
import {
	buildAcceptedRequestObservabilityFact,
	buildFinalizedRequestObservabilityFact,
} from "../../request-observability";
import type { VersionQuery } from "../../version-query";
import {
	buildExecutionSessionProjection,
	deriveCurriculumSessionSlots,
} from "../curriculum-session";
import type { AcceptRequestWrite, FinalizeRequestWrite, RequestExecutionStatus } from "../store";
import {
	extractSourceDocIds,
	normalizeChatResponseStructuredParts,
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
	const recentTurnLimit = 6;
	const priorMessages = input.conversation.messages.slice(-recentTurnLimit);
	const parentMessage = priorMessages.at(-1) ?? null;
	const previousAssistant = [...input.conversation.messages]
		.reverse()
		.find((message) => message.role === "assistant");
	const previousEvidenceRefs = previousAssistant
		? extractPreviousEvidenceRefs(previousAssistant)
		: [];
	const recentTurns: ToolExecutionConversationContext["recentTurns"] = priorMessages.map(
		(message) => ({
			createdAt: message.createdAt,
			messageId: message.id,
			role: message.role,
			...(message.role === "assistant"
				? { summary: previewText(message.text, 240) }
				: { content: previewText(message.text, 240) }),
		}),
	);
	const tokenEstimate = estimateContextTokens([
		input.currentUserMessageContent,
		...recentTurns.map((turn) => turn.content ?? turn.summary ?? ""),
		previousAssistant?.text ?? "",
		...previousEvidenceRefs.map((ref) => ref.snippet ?? ""),
		...input.previousToolResults.map((ref) => ref.summary ?? ""),
	]);

	return {
		budget: {
			recentTurnLimit,
			tokenEstimate,
		},
		contextSummary: input.conversation.contextSummary ?? null,
		conversationId: input.conversation.id,
		currentUserMessage: {
			role: "user",
			content: input.currentUserMessageContent,
			createdAt: input.currentUserMessageCreatedAt,
		},
		memoryRecall: {
			gateField: "context.memory.enabled",
			owner: "execution-control",
			runtime: "hindsight",
		},
		parentMessageId: parentMessage?.id ?? null,
		previousAnswerSummary: previousAssistant ? previewText(previousAssistant.text, 240) : null,
		previousToolResults: input.previousToolResults,
		previousEvidenceRefs,
		recentTurns,
		schemaVersion: "conversation_context.v1",
		sessionState: input.session,
		sourceAttribution: previousEvidenceRefs
			.map((_, index) => ({
				item: `previous_evidence_refs[${index}]`,
				modelVisible: true,
				source: "runtime step/result projection",
			}))
			.concat(
				input.previousToolResults.map((_, index) => ({
					item: `previous_tool_results[${index}]`,
					modelVisible: true,
					source: "runtime request projection",
				})),
			),
		truncation: null,
		userMessageId: input.currentUserMessageId,
		visibility: {
			modelVisible: [
				"current_user_message",
				"recent_turns",
				"previous_answer_summary",
				"previous_evidence_refs",
				"previous_tool_results",
				"session_state",
			],
			runtimeOnly: [
				"schema_version",
				"conversation_id",
				"user_message_id",
				"parent_message_id",
				"memory_recall",
				"source_attribution",
				"budget",
				"truncation",
			],
		},
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

function estimateContextTokens(values: string[]): number {
	const charCount = values.reduce((total, value) => total + value.trim().length, 0);
	return Math.ceil(charCount / 4);
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
	requestedScope: RequestedScope | null;
	runId: string | null;
	versionQuery: VersionQuery | null;
	safetyIdentifier: string | null;
	surface: string;
	traceId: string;
	turnSequence: number;
	userMessageId: string;
	outboxEventId: string;
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
		requestExecution: {
			requestId: input.requestId,
			conversationId: input.conversation.id,
			userMessageId: input.userMessageId,
			assistantMessageId: null,
			turnSequence: input.turnSequence,
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
			runId: input.runId,
			safetyIdentifier: input.safetyIdentifier,
			requestedTool: input.requestedTool,
			requestedScope: input.requestedScope,
			versionQuery: input.versionQuery,
			resolvedScope: null,
			selectedTool: null,
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
			requestedTool: input.requestedTool,
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
				requestedTool: input.requestedTool,
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
	response: ToolExecutionResponse;
}): RequestedScope | null {
	const corpus = input.response.observability?.resolvedScopeCorpus?.trim();
	const collection = input.response.observability?.resolvedScopeCollection?.trim();
	if (corpus && collection) {
		return { collection, corpus };
	}

	return input.requestedScope;
}

export function buildFinalizedWrite(input: {
	allowedPublicNoticeHosts?: readonly string[];
	assistantMessageId: string;
	branchId: string;
	conversation: ChatConversation;
	conversationTitle: string;
	completedAt: string;
	durationMs: number;
	outboxEventId: string;
	principal: ResolvedAppPrincipal;
	requestId: string;
	requestedTool: string | null;
	requestedScope: RequestedScope | null;
	response: ToolExecutionResponse;
	runId: string | null;
	versionQuery: VersionQuery | null;
	safetyIdentifier: string | null;
	surface: string;
	startedAt: string;
	traceId: string;
	turnSequence: number;
	userMessageId: string;
}): {
	responseBody: ChatCommandResponse;
	write: FinalizeRequestWrite;
} {
	const normalizedTraceId = input.response.traceId || input.traceId;
	const normalizedExecutionResponse = {
		...input.response,
		traceId: normalizedTraceId,
	} satisfies ToolExecutionResponse;
	const diagnostics = extractRequestDiagnosticsSummary(input.response.result);
	const sourceDocIds = extractSourceDocIds(input.response.result);
	const structuredParts = normalizeChatResponseStructuredParts({
		allowedPublicNoticeHosts: input.allowedPublicNoticeHosts,
		result: input.response.result,
		selectedTool: input.response.selectedTool,
		status: input.response.status,
	});
	const resolvedScope = resolveFinalizedScope({
		requestedScope: input.requestedScope,
		response: normalizedExecutionResponse,
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
		branchId: input.branchId,
		isActiveBranchHead: true,
		role: "assistant",
		kind: assistantKind,
		text: assistantText,
		createdAt: input.completedAt,
		parentMessageId: input.userMessageId,
		requestId: input.requestId,
		retryable,
		runId: input.runId,
		structuredParts,
		turnSequence: input.turnSequence,
	};

	const write: FinalizeRequestWrite = {
		assistantMessage,
		contextSummary: previewText(assistantText, 240),
		conversationTitle: input.conversationTitle,
		ownerUserId: input.conversation.ownerUserId,
		requestExecution: {
			requestId: input.requestId,
			conversationId: input.conversation.id,
			userMessageId: input.userMessageId,
			assistantMessageId: input.assistantMessageId,
			turnSequence: input.turnSequence,
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
			runId: input.runId,
			safetyIdentifier: input.safetyIdentifier,
			requestedTool: input.requestedTool,
			requestedScope: input.requestedScope,
			versionQuery: input.versionQuery,
			resolvedScope,
			selectedTool: input.response.selectedTool,
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
			requestedTool: input.requestedTool,
			requestedScope: input.requestedScope,
			resolvedScope,
			response: normalizedExecutionResponse,
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
				selectedTool: input.response.selectedTool,
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
			execution: normalizedExecutionResponse,
			requestId: input.requestId,
			traceId: normalizedTraceId,
		},
		write,
	};
}
