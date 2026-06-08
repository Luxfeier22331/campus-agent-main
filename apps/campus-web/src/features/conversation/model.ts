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

export interface ConversationSummary {
	createdAt: string;
	id: string;
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
		status: string;
		traceId: string;
	};
	event: ChatRequestStreamEventName;
}
