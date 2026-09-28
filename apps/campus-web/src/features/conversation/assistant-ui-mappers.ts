import type { ThreadMessageLike } from "@assistant-ui/react";
import { localizeChatErrorMessage } from "./error-messages";
import type { ChatMessage, ChatMessageKind, ConversationDetail } from "./model";

export interface AssistantCampusMessageMetadata {
	errorCode: string | null;
	kind: ChatMessageKind | null;
	requestId: string | null;
	retryable: boolean | null;
}

const CHAT_MESSAGE_KINDS: readonly ChatMessageKind[] = ["answer", "error"];

export function readCampusMessageMetadata(custom: unknown): AssistantCampusMessageMetadata {
	if (!(isRecord(custom) && isRecord(custom.campusMessage))) {
		return { errorCode: null, kind: null, requestId: null, retryable: null };
	}

	const metadata = custom.campusMessage;
	const kind = CHAT_MESSAGE_KINDS.includes(metadata.kind as ChatMessageKind)
		? (metadata.kind as ChatMessageKind)
		: null;
	return {
		errorCode: typeof metadata.errorCode === "string" ? metadata.errorCode : null,
		kind,
		requestId: typeof metadata.requestId === "string" ? metadata.requestId : null,
		retryable: typeof metadata.retryable === "boolean" ? metadata.retryable : null,
	};
}

export function toAssistantThreadMessages(
	conversation: ConversationDetail,
	terminalError?: {
		code?: null | string;
		requestId?: null | string;
	},
): ThreadMessageLike[] {
	return conversation.messages.map((message) => {
		const error =
			message.role === "assistant" &&
			message.kind === "error" &&
			terminalError?.code &&
			terminalError.requestId != null &&
			message.requestId === terminalError.requestId
				? { code: terminalError.code }
				: undefined;
		const metadata = buildMessageMetadata(message, error);
		const messageText =
			message.role === "assistant" && message.kind === "error"
				? localizeChatErrorMessage({ code: error?.code ?? null, message: message.text })
				: message.text;
		return {
			createdAt: new Date(message.createdAt),
			content: [
				...(messageText ? [{ text: messageText, type: "text" as const }] : []),
				...(message.role === "assistant"
					? (message.structuredParts ?? []).map((part) => ({
							data: part,
							name: part.type,
							type: "data" as const,
						}))
					: []),
			],
			id: message.id,
			...(metadata ? { metadata } : {}),
			role: message.role,
		};
	});
}

function buildMessageMetadata(
	message: ChatMessage,
	error?: { code: string },
): ThreadMessageLike["metadata"] | undefined {
	const custom: Record<string, unknown> = {};
	if (
		message.role === "assistant" &&
		(message.kind !== null || message.requestId !== null || message.retryable !== null)
	) {
		custom.campusMessage = {
			kind: message.kind,
			requestId: message.requestId,
			retryable: message.retryable,
			...(error ? { errorCode: error.code } : {}),
		};
	}

	const submittedFeedback =
		message.role === "assistant" && message.feedback
			? {
					type: message.feedback.vote === "helpful" ? ("positive" as const) : ("negative" as const),
				}
			: undefined;
	if (Object.keys(custom).length === 0 && !submittedFeedback) {
		return undefined;
	}

	return {
		custom,
		...(submittedFeedback ? { submittedFeedback } : {}),
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
