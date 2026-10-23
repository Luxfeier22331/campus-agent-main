export type ChatMessageKind = "answer" | "error";

export interface CampusDocumentSourceItemPayload {
	citationIndexes: number[];
	collectionLabel: string;
	kind: "campus_document";
	primaryAction: {
		disabledReason: null;
		external: false;
		href: string;
		label: "查看文档";
	};
	sectionTitle: string;
	snippet: string | null;
	title: string;
	versionSlug: string;
}

export interface CampusNoticeSourceItemPayload {
	citationIndexes: number[];
	kind: "campus_notice";
	noticeId: string;
	primaryAction: {
		disabledReason: null;
		external: false;
		href: string;
		label: "查看通知";
	};
	sectionTitle: string;
	snippet: string | null;
	title: string;
}

export interface WebPageSourceItemPayload {
	citationIndexes: number[];
	hostname: string | null;
	kind: "web_page";
	primaryAction: { external: true; label: "打开网页" } & (
		| { href: string; disabledReason: null }
		| { href: null; disabledReason: "source_unavailable" }
	);
	snippet: string | null;
	title: string;
}

export type SourceItemPayload =
	| CampusDocumentSourceItemPayload
	| CampusNoticeSourceItemPayload
	| WebPageSourceItemPayload;

export interface ChatStructuredPart {
	sourceItems: SourceItemPayload[];
	type: "source_items";
}

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

export interface ConversationSearchResult extends ConversationSummary {
	matchSnippet: string | null;
}

export interface ConversationDetail extends ConversationSummary {
	activeRequestId: string | null;
	messages: ChatMessage[];
}

export type ChatCommandResult =
	| {
			kind: "answer";
			requestId: string;
			text: string;
	  }
	| {
			errorCode: string;
			kind: "error";
			message: string;
			requestId: string;
			retryable: boolean;
	  };

export interface ChatAnswerPayload {
	conversation: ConversationDetail;
	result: ChatCommandResult;
}

export type ChatRequestStreamEventName =
	| "answer.delta"
	| "retrieval.status"
	| "execution.phase"
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
			retryable: boolean;
		};
		delta?: string;
		messageId?: string;
		source?: "campus";
		occurredAt: string;
		requestId: string;
		phase?: "finalizing" | "generating" | "preparing";
		sequence?: number;
		answerIndex?: number;
		status: string;
	};
	event: ChatRequestStreamEventName;
}
