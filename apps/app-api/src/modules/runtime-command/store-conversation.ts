import type { conversations, messages, requestExecution, sessionSlots } from "../../db/schema";
import {
	type ChatConversation,
	type ChatMessage,
	normalizeChatStructuredParts,
	toConversationResponse,
} from "../chat";
import type { RequestExecutionStatus, StoredIdempotentRequest } from "./store-types";

export function toIsoString(value: Date): string {
	return value.toISOString();
}

export function toChatMessage(row: typeof messages.$inferSelect): ChatMessage {
	return {
		id: row.id,
		conversationId: row.conversationId,
		role: row.role as ChatMessage["role"],
		kind: (row.kind as ChatMessage["kind"]) ?? null,
		text: row.text,
		createdAt: toIsoString(row.createdAt),
		parentMessageId: row.parentMessageId ?? null,
		requestId: row.requestId ?? null,
		retryable: row.retryable ?? null,
		branchId: row.branchId ?? "branch_active",
		turnSequence: row.turnSequence ?? 0,
		runId: row.runId ?? null,
		isActiveBranchHead: row.isActiveBranchHead ?? false,
		structuredParts: normalizeChatStructuredParts(row.structuredPartsJson),
	};
}

export function toChatConversation(
	row: typeof conversations.$inferSelect,
	messageRows: (typeof messages.$inferSelect)[],
	sessionSlotRows: (typeof sessionSlots.$inferSelect)[],
): ChatConversation {
	return {
		id: row.id,
		ownerUserId: row.ownerUserId,
		title: row.title,
		createdAt: toIsoString(row.createdAt),
		updatedAt: toIsoString(row.updatedAt),
		activeBranchId: row.activeBranchId ?? "branch_active",
		activeMessageId: row.activeMessageId ?? null,
		activeRunId: row.activeRunId ?? null,
		activeTurnSequence: row.activeTurnSequence ?? 0,
		sessionSlots: sessionSlotRows.map((slot) => ({
			confirmed: slot.confirmed,
			name: slot.name,
			updatedAt: toIsoString(slot.updatedAt),
			value: slot.value,
		})),
		messages: messageRows.map(toChatMessage),
	};
}

export function buildStoredIdempotentRequest(input: {
	assistantMessageRow: typeof messages.$inferSelect | null;
	conversation: ChatConversation;
	executionRow: typeof requestExecution.$inferSelect;
}): StoredIdempotentRequest {
	const assistantMessage = input.assistantMessageRow
		? toChatMessage(input.assistantMessageRow)
		: null;
	if (!assistantMessage && input.executionRow.status !== "accepted") {
		throw new Error("idempotent replay is missing assistant message for finalized request");
	}
	const requestFingerprintSha256 = input.executionRow.requestFingerprintSha256;
	if (!requestFingerprintSha256) {
		throw new Error("idempotent replay is missing request fingerprint");
	}

	const result =
		assistantMessage?.kind === "error"
			? buildStoredErrorReplayResult({
					assistantMessage,
					errorCode: input.executionRow.errorCode,
					requestId: input.executionRow.requestId,
					traceId: input.executionRow.traceId,
				})
			: assistantMessage?.kind === "clarification"
				? {
						kind: "clarification" as const,
						text: assistantMessage.text,
						requestId: input.executionRow.requestId,
						traceId: input.executionRow.traceId,
					}
				: assistantMessage?.kind === "no_answer"
					? {
							kind: "no_answer" as const,
							text: assistantMessage.text,
							requestId: input.executionRow.requestId,
							traceId: input.executionRow.traceId,
						}
					: {
							kind: "answer" as const,
							text: assistantMessage?.text ?? input.executionRow.answerPreview ?? "",
							requestId: input.executionRow.requestId,
							traceId: input.executionRow.traceId,
						};

	return {
		requestFingerprintSha256,
		response: {
			answer: {
				conversation: toConversationResponse(input.conversation),
				result,
			},
			requestId: input.executionRow.requestId,
			traceId: input.executionRow.traceId,
		},
		status: input.executionRow.status as RequestExecutionStatus,
	};
}

function buildStoredErrorReplayResult(input: {
	assistantMessage: ChatMessage;
	errorCode: string | null;
	requestId: string;
	traceId: string;
}) {
	if (input.assistantMessage.retryable === null) {
		throw new Error("idempotent replay error message is missing retryable");
	}
	return {
		kind: "error" as const,
		message: input.assistantMessage.text,
		errorCode: input.errorCode ?? "internal_error",
		retryable: input.assistantMessage.retryable,
		requestId: input.requestId,
		traceId: input.traceId,
	};
}
