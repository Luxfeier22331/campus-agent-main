import type { AppendMessage, ThreadMessageLike } from "@assistant-ui/react";
import { type CampusRunViewState, campusRequestViewToMetadata } from "./run-view-state";

export type RuntimeMessages = ThreadMessageLike[];

export function settleAssistantMessage(message: ThreadMessageLike): ThreadMessageLike {
	if (!message.metadata?.isOptimistic) {
		return message;
	}
	const { isOptimistic: _isOptimistic, ...metadata } = message.metadata;
	return {
		...message,
		...(Object.keys(metadata).length > 0 ? { metadata } : {}),
	};
}

export function upsertAssistantTextMessage(
	messages: RuntimeMessages,
	input: {
		messageId: string;
		occurredAt: string;
		provisionalMessageId?: string;
		optimistic?: boolean;
		runView?: CampusRunViewState;
		text: string;
	},
): RuntimeMessages {
	const content = input.text ? [{ text: input.text, type: "text" as const }] : [];
	const existingIndex = messages.findIndex((message) => message.id === input.messageId);
	const provisionalIndex = input.provisionalMessageId
		? messages.findIndex((message) => message.id === input.provisionalMessageId)
		: -1;
	const runMetadata = input.runView
		? { custom: { campusRequest: campusRequestViewToMetadata(input.runView) } }
		: undefined;
	const optimisticMetadata = input.optimistic ? { isOptimistic: true } : undefined;
	if (existingIndex < 0) {
		if (provisionalIndex >= 0 && input.provisionalMessageId !== input.messageId) {
			return messages.map((message, index) => {
				if (index !== provisionalIndex) {
					return message;
				}
				const settled = settleAssistantMessage(message);
				return {
					...settled,
					...(runMetadata ? { metadata: { ...settled.metadata, ...runMetadata } } : {}),
					content,
					createdAt: new Date(input.occurredAt),
					id: input.messageId,
				};
			});
		}
		return [
			...messages,
			{
				content,
				createdAt: new Date(input.occurredAt),
				id: input.messageId,
				...(runMetadata || optimisticMetadata
					? { metadata: { ...runMetadata, ...optimisticMetadata } }
					: {}),
				role: "assistant",
			},
		];
	}
	return messages.map((message, index) =>
		index === existingIndex
			? {
					...message,
					...(runMetadata || optimisticMetadata
						? { metadata: { ...runMetadata, ...optimisticMetadata } }
						: {}),
					content,
				}
			: message,
	);
}

export function provisionalAssistantMessage(input: {
	messageId: string;
	occurredAt: string;
	runView: CampusRunViewState;
}): ThreadMessageLike {
	return {
		content: [],
		createdAt: new Date(input.occurredAt),
		id: input.messageId,
		metadata: {
			custom: { campusRequest: campusRequestViewToMetadata(input.runView) },
			isOptimistic: true,
		},
		role: "assistant",
	};
}

export function updateAssistantRunMetadata(
	messages: RuntimeMessages,
	input: { messageId?: string | null; runView: CampusRunViewState },
): RuntimeMessages {
	const targetId = input.messageId ?? input.runView.requestId;
	if (!targetId) {
		return messages;
	}
	return messages.map((message) => {
		if (message.id !== targetId || message.role !== "assistant") {
			return message;
		}
		return {
			...message,
			metadata: {
				...message.metadata,
				custom: {
					...message.metadata?.custom,
					campusRequest: campusRequestViewToMetadata(input.runView),
				},
			},
		};
	});
}

export function attachAssistantRunMetadata(
	messages: RuntimeMessages,
	runView: CampusRunViewState,
): RuntimeMessages {
	if (!runView.requestId) {
		return messages;
	}
	const matchingIndex = messages.reduce((found, message, index) => {
		if (message.role !== "assistant") {
			return found;
		}
		const metadata = message.metadata?.custom?.campusRequest;
		if (
			metadata &&
			typeof metadata === "object" &&
			!Array.isArray(metadata) &&
			(metadata as Record<string, unknown>).requestId === runView.requestId
		) {
			return index;
		}
		return found;
	}, -1);
	const targetIndex =
		matchingIndex >= 0
			? matchingIndex
			: messages.reduce(
					(found, message, index) => (message.role === "assistant" ? index : found),
					-1,
				);
	if (targetIndex < 0) {
		return messages;
	}
	return messages.map((message, index) =>
		index === targetIndex
			? {
					...message,
					metadata: {
						...message.metadata,
						custom: {
							...message.metadata?.custom,
							campusRequest: campusRequestViewToMetadata(runView),
						},
					},
				}
			: message,
	);
}

export function removeMessagesById(
	messages: RuntimeMessages,
	messageIds: ReadonlySet<string>,
): RuntimeMessages {
	return messageIds.size === 0
		? messages
		: messages.filter((message) => !(message.id && messageIds.has(message.id)));
}

export function localUserMessage(content: AppendMessage["content"], id: string): ThreadMessageLike {
	return {
		content: typeof content === "string" ? [{ text: content, type: "text" }] : content,
		createdAt: new Date(),
		id,
		metadata: { isOptimistic: true },
		role: "user",
	};
}

export function readMessageText(message: ThreadMessageLike | undefined): string {
	if (!message) {
		return "";
	}
	if (typeof message.content === "string") {
		return message.content;
	}
	return message.content.map((part) => (part.type === "text" ? part.text : "")).join("");
}

export function readTextContent(message: AppendMessage): string {
	if (typeof message.content === "string") {
		return message.content;
	}
	return message.content.map((part) => (part.type === "text" ? part.text : "")).join("");
}
