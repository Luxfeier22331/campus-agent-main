export interface SessionPrincipal {
	permissions: {
		chat: boolean;
		operator: boolean;
	};
	principal: {
		displayName: string;
		email: string | null;
		principalId: string;
		type: "campus_member" | "faculty" | "operator" | "staff" | "student";
	};
	session: {
		expiresAt: string;
		sessionId: string;
	} | null;
}

export type ChatMessageKind = "answer" | "clarification" | "error" | "no_answer";

export interface SourceItemPayload {
	collectionLabel: string;
	pageLabel: string;
	primaryAction: {
		disabledReason: string | null;
		external: boolean;
		href: string | null;
		label: string;
	};
	publisherLabel: string;
	sectionTitle: string;
	snippet: string | null;
	title: string;
	trustLabel: string;
	versionLabel: string;
}

export interface PlaceCardPayload {
	accessNote?: string;
	campusArea?: string;
	displayName: string;
	locationDescription: string;
	placeId: string;
	serviceTags?: string[];
}

export type ChatStructuredPart =
	| {
			sourceItems: SourceItemPayload[];
			type: "source_items";
	  }
	| {
			placeCard: PlaceCardPayload;
			type: "place_card";
	  };

export interface ChatMessage {
	conversationId: string;
	createdAt: string;
	feedback?: null | {
		feedbackId: string;
		reasonCodes?: MessageFeedbackReasonCode[];
		vote: "helpful" | "unhelpful";
	};
	id: string;
	kind: ChatMessageKind | null;
	requestId: string | null;
	retryable: boolean | null;
	role: "assistant" | "user";
	structuredParts?: ChatStructuredPart[];
	text: string;
}

export type MessageFeedbackReasonCode =
	| "incorrect_answer"
	| "not_enough_detail"
	| "other"
	| "outdated_or_missing_source"
	| "unclear_or_hard_to_use"
	| "wrong_intent";

export type MessageFeedbackVote = "helpful" | "unhelpful";

export interface MessageFeedbackResult {
	feedback: {
		createdAt?: string;
		feedbackId: string;
		messageId: string;
		reasonCodes: MessageFeedbackReasonCode[];
		updatedAt?: string;
		vote: MessageFeedbackVote;
	};
}

export interface ConversationSummary {
	archivedAt: string | null;
	createdAt: string;
	id: string;
	pinnedAt: string | null;
	title: string;
	updatedAt: string;
}

export interface ConversationDetail extends ConversationSummary {
	messages: ChatMessage[];
}

export type ChatCommandResult =
	| {
			kind: "answer" | "clarification" | "no_answer";
			requestId: string;
			text: string;
			traceId: string;
	  }
	| {
			errorCode: string;
			kind: "error";
			message: string;
			requestId: string;
			retryable: boolean;
			traceId: string;
	  };

export interface ChatAnswerPayload {
	conversation: ConversationDetail;
	result: ChatCommandResult;
}

export type ChatRequestStreamEventName =
	| "execution.queued"
	| "execution.running"
	| "request.accepted"
	| "request.cancelled"
	| "request.completed"
	| "request.failed";

export interface ChatRequestStreamEvent {
	data: {
		answer?: ChatAnswerPayload;
		error?: {
			code: string;
			message: string;
			retryable?: boolean;
		};
		occurredAt: string;
		requestId: string;
		runId?: string;
		sequence?: number;
		status: string;
		traceId: string;
	};
	event: ChatRequestStreamEventName;
}
