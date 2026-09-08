import type { AppendMessage } from "@assistant-ui/react";
import type { ConversationInitializationTarget } from "./conversation-initialization";
import type { ChatRequestStreamEvent } from "./model";
import type { ChatRunStatus } from "./run-client";

export interface RuntimeRunState {
	connection: "connected" | "disconnected" | "recovering";
	operationId: number;
	requestId: string | null;
	sequence: number;
}

export interface PendingAssistantDelta {
	occurredAt: string;
	text: string;
}

export interface RuntimeRunAction {
	acceptedAt?: string;
	connection?: RuntimeRunState["connection"];
	event?: ChatRequestStreamEvent;
	operationId: number;
	requestId?: string | null;
	run?: ChatRunStatus;
	sequence?: number;
	type: "connection" | "event" | "hydrate" | "rebind" | "reset" | "start";
}

export const EMPTY_RUNTIME_RUN: RuntimeRunState = {
	connection: "connected",
	operationId: 0,
	requestId: null,
	sequence: 0,
};

export interface ConversationRunPromptInput {
	conversationId: string | undefined;
	initializationTarget?: ConversationInitializationTarget;
	messageContent: AppendMessage["content"];
	prompt: string;
	truncateFromMessageId?: string;
}
