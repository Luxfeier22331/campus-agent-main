export interface SessionPrincipal {
	principal: {
		type: "campus_member" | "student" | "staff" | "faculty" | "operator";
		principalId: string;
		displayName: string;
		email: string | null;
	};
	session: {
		sessionId: string;
		expiresAt: string;
	} | null;
	permissions: {
		chat: boolean;
		operator: boolean;
	};
}

export type ChatMessageKind = "answer" | "clarification" | "no_answer" | "error";

export interface PointGeometry {
	coordinates: [number, number];
	type: "Point";
}

export interface PlaceCardPayload {
	accessNote?: string;
	campusScope?: string;
	campusArea?: string;
	coordinateReferenceSystem?: string;
	displayName: string;
	entityType: "building" | "service_point" | "office" | "gate" | "stop";
	landmarkHint?: string;
	locationDescription: string;
	openingNote?: string;
	placeId: string;
	pointGeometry?: PointGeometry;
	serviceTags?: string[];
	sourceRefs?: string[];
}

export interface SourceCardPayload {
	title: string;
	sectionTitle: string;
	snippet: string;
	href: string;
	collectionLabel: string;
	versionLabel: string;
	pageLabel: string;
}

export type SourceTargetKind =
	| "canonical_reader"
	| "notice_reader"
	| "public_notice_url"
	| "restricted_notice";

export type SourceKind = "campus_service" | "curriculum" | "document" | "notice" | "regulation";

export interface SourceActionPayload {
	label: "原通知" | "打开原通知" | "查看文档" | "查看整理版" | "需登录查看";
	href: string | null;
	external: boolean;
	disabledReason: string | null;
}

export interface SourceItemPayload {
	targetKind: SourceTargetKind;
	sourceKind: SourceKind;
	title: string;
	snippet: string | null;
	primaryAction: SourceActionPayload;
	secondaryActions: SourceActionPayload[];
	sectionTitle: string;
	collectionLabel: string;
	publisherLabel: string;
	publishedAt: string;
	versionLabel: string;
	pageLabel: string;
	trustLabel: string;
}

export interface ChatPlaceCardStructuredPart {
	placeCard: PlaceCardPayload;
	type: "place_card";
}

export interface ChatSourceCardsStructuredPart {
	sourceCards: SourceCardPayload[];
	type: "source_cards";
}

export interface ChatSourceItemsStructuredPart {
	sourceItems: SourceItemPayload[];
	type: "source_items";
}

export interface CampusServiceTraceCardPayload {
	title: string;
	refs: string[];
}

export interface ChatCampusServiceTraceCardsStructuredPart {
	traceCards: CampusServiceTraceCardPayload[];
	type: "campus_service_trace_cards";
}

export type ChatStructuredPart =
	| ChatPlaceCardStructuredPart
	| ChatSourceCardsStructuredPart
	| ChatSourceItemsStructuredPart
	| ChatCampusServiceTraceCardsStructuredPart;

export interface ChatMessage {
	id: string;
	conversationId: string;
	role: "user" | "assistant";
	kind: ChatMessageKind | null;
	text: string;
	structuredParts?: ChatStructuredPart[];
	createdAt: string;
	requestId: string | null;
	retryable: boolean | null;
}

export interface ConversationSummary {
	id: string;
	title: string;
	createdAt: string;
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
