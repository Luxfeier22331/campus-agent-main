import type { ChatMessageKind, ChatStructuredPart } from "./api-types";

export interface ShellChatUser {
	email: string | null;
	name: string | null;
}

export interface ShellSessionPrincipal {
	canChat: boolean;
	displayName: string;
	email: string | null;
	principalId: string;
	principalType: string;
}

export interface ShellConversationListItem {
	createdAt: string;
	id: string;
	title: string;
	updatedAt: string;
}

export interface ShellMessage {
	createdAt: string;
	id: string;
	kind: ChatMessageKind | "user";
	requestId: string | null;
	retryable: boolean;
	role: "assistant" | "user";
	structuredParts?: ChatStructuredPart[];
	text: string;
}

export interface ShellConversationDetail extends ShellConversationListItem {
	messages: ShellMessage[];
}

export interface ShellRequestOutcome {
	conversation: ShellConversationDetail;
	requestId: string;
	resultKind: "answer" | "clarification" | "error" | "no_answer";
	traceId: string;
}

export interface ShellChatStreamEvent {
	error?: {
		code: string;
		message: string;
		retryable?: boolean;
	};
	event:
		| "request.accepted"
		| "execution.queued"
		| "execution.running"
		| "request.completed"
		| "request.failed"
		| "request.cancelled";
	occurredAt: string;
	requestId: string;
	status: string;
	traceId: string;
	outcome?: ShellRequestOutcome;
}
