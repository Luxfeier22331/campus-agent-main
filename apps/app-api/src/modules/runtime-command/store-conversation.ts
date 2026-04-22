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
		requestId: row.requestId ?? null,
		retryable: row.retryable ?? null,
		structuredParts: normalizeChatStructuredParts(row.structuredPartsJson),
	};
}

export function toChatConversation(
	row: typeof conversations.$inferSelect,
	messageRows: Array<typeof messages.$inferSelect>,
	sessionSlotRows: Array<typeof sessionSlots.$inferSelect>,
): ChatConversation {
	return {
		id: row.id,
		ownerUserId: row.ownerUserId,
		title: row.title,
		createdAt: toIsoString(row.createdAt),
		updatedAt: toIsoString(row.updatedAt),
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
}): StoredIdempotentRequest | null {
	const assistantMessage = input.assistantMessageRow
		? toChatMessage(input.assistantMessageRow)
		: null;
	if (!assistantMessage && input.executionRow.status !== "accepted") {
		return null;
	}

	const result =
		assistantMessage?.kind === "error"
			? {
					kind: "error" as const,
					message: assistantMessage.text,
					errorCode: input.executionRow.errorCode ?? "internal_error",
					retryable:
						assistantMessage.retryable ?? (input.executionRow.status === "error" ? true : false),
					requestId: input.executionRow.requestId,
					traceId: input.executionRow.traceId,
				}
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
		requestFingerprintSha256: input.executionRow.requestFingerprintSha256 ?? "",
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
