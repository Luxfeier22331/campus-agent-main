import type { ChatMessageFeedback, ChatMessageKind, ChatStructuredPart } from "./api-types";

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
	feedback?: ChatMessageFeedback | null;
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
	runId?: string | null;
	runPhase?: ChatRunPhase;
	status: string;
	traceId: string;
	outcome?: ShellRequestOutcome;
}

export interface ChatRunEventProjection {
	eventId: string;
	eventType: string;
	occurredAt: string;
	payload: Record<string, unknown>;
	runId: string;
	sequence: number;
	visibility: "browser";
}

export type ChatRunPhase =
	| "created"
	| "queued"
	| "admitted"
	| "running"
	| "streaming"
	| "completed"
	| "failed"
	| "canceled"
	| "expired";
