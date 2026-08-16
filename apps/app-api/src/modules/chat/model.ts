export type AssistantMessageKind = "answer" | "clarification" | "no_answer" | "error";
export type ChatMessageRole = "user" | "assistant";
export type ChatMessageFeedbackVote = "helpful" | "unhelpful";
export type ChatMessageFeedbackReasonCode =
	| "wrong_intent"
	| "not_enough_detail"
	| "outdated_or_missing_source"
	| "incorrect_answer"
	| "unclear_or_hard_to_use"
	| "other";
export const DRAFT_CONVERSATION_TITLE = "New conversation";

export interface ChatSourceAction {
	label: "查看文档";
	href: string;
	external: false;
	disabledReason: null;
}

export interface ChatSourceItem {
	title: string;
	snippet: string | null;
	primaryAction: ChatSourceAction;
	sectionTitle: string;
	collectionLabel: string;
	versionLabel: string;
}

export interface ChatSourceItemsStructuredPart {
	type: "source_items";
	sourceItems: ChatSourceItem[];
}

export type ChatMessageStructuredPart = ChatSourceItemsStructuredPart;

export interface ChatSessionSlot {
	confirmed: boolean;
	name: string;
	updatedAt: string;
	value: string;
}

export interface ChatMessage {
	id: string;
	conversationId: string;
	branchId?: string;
	isActiveBranchHead?: boolean;
	role: ChatMessageRole;
	kind: AssistantMessageKind | null;
	text: string;
	createdAt: string;
	feedback?: ChatMessageFeedback | null;
	parentMessageId?: string | null;
	requestId: string | null;
	retryable: boolean | null;
	runId?: string | null;
	structuredParts: ChatMessageStructuredPart[];
	turnSequence?: number;
}

export interface ChatMessageFeedback {
	createdAt: string;
	feedbackId: string;
	messageId: string;
	reasonCodes: ChatMessageFeedbackReasonCode[];
	updatedAt: string;
	vote: ChatMessageFeedbackVote;
}

export interface ChatConversation {
	id: string;
	ownerUserId: string;
	title: string;
	createdAt: string;
	updatedAt: string;
	activeBranchId?: string;
	activeMessageId?: string | null;
	activeRunId?: string | null;
	activeTurnSequence?: number;
	sessionSlots: ChatSessionSlot[];
	messages: ChatMessage[];
}

export interface ChatConversationSummary {
	id: string;
	title: string;
	createdAt: string;
	updatedAt: string;
	archivedAt: string | null;
	pinnedAt: string | null;
}

export interface ChatConversationSearchResult extends ChatConversationSummary {
	matchSnippet: string | null;
}

export interface ChatConversationResponse {
	id: string;
	title: string;
	createdAt: string;
	updatedAt: string;
	messages: ChatMessage[];
}

export interface ChatConversationSummaryResponse {
	id: string;
	title: string;
	createdAt: string;
	updatedAt: string;
	archivedAt: string | null;
	pinnedAt: string | null;
}

export interface ChatConversationSearchResultResponse extends ChatConversationSummaryResponse {
	matchSnippet: string | null;
}

export interface VendorChatHistoryItemResponse {
	id: string;
	title: string;
	createdAt: string;
	updatedAt: string;
	visibility: "private" | "public";
}

export interface VendorChatHistoryPageResponse {
	chats: VendorChatHistoryItemResponse[];
	hasMore: boolean;
}

export function toConversationResponse(conversation: ChatConversation): ChatConversationResponse {
	return {
		id: conversation.id,
		title: conversation.title,
		createdAt: conversation.createdAt,
		updatedAt: conversation.updatedAt,
		messages: conversation.messages,
	};
}

export function toConversationSummaryResponse(
	conversation: ChatConversationSummary,
): ChatConversationSummaryResponse {
	return {
		id: conversation.id,
		title: conversation.title,
		createdAt: conversation.createdAt,
		updatedAt: conversation.updatedAt,
		archivedAt: conversation.archivedAt,
		pinnedAt: conversation.pinnedAt,
	};
}

export function toConversationSearchResultResponse(
	conversation: ChatConversationSearchResult,
): ChatConversationSearchResultResponse {
	return {
		...toConversationSummaryResponse(conversation),
		matchSnippet: conversation.matchSnippet,
	};
}

export function toVendorChatHistoryItemResponse(
	conversation: ChatConversationSummary,
): VendorChatHistoryItemResponse {
	return {
		...toConversationSummaryResponse(conversation),
		visibility: "private",
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeOptionalString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isBrowserSafeDocsHref(value: string): boolean {
	return (
		value.startsWith("/docs/") &&
		!value.startsWith("//") &&
		!value.includes("://") &&
		!value.includes("..")
	);
}

function normalizeSourceAction(value: unknown): ChatSourceAction | null {
	if (!isRecord(value)) {
		return null;
	}
	const href = normalizeOptionalString(value.href);
	if (!(href && isBrowserSafeDocsHref(href))) {
		return null;
	}
	return {
		label: "查看文档",
		href,
		external: false,
		disabledReason: null,
	};
}

function normalizeSourceItem(value: unknown): ChatSourceItem | null {
	if (!isRecord(value)) {
		return null;
	}

	const title = normalizeOptionalString(value.title);
	const versionLabel = normalizeOptionalString(value.versionLabel);
	if (!(title && versionLabel)) {
		return null;
	}

	const primaryAction = normalizeSourceAction(value.primaryAction);
	if (!primaryAction) {
		return null;
	}

	return {
		title,
		snippet: normalizeOptionalString(value.snippet),
		primaryAction,
		sectionTitle: normalizeOptionalString(value.sectionTitle) ?? "",
		collectionLabel: normalizeOptionalString(value.collectionLabel) ?? "",
		versionLabel,
	};
}

function normalizeSourceItems(value: unknown): ChatSourceItem[] {
	if (!Array.isArray(value)) {
		return [];
	}

	return value
		.map((item) => normalizeSourceItem(item))
		.filter((item): item is ChatSourceItem => item !== null)
		.slice(0, 5);
}

function normalizeStructuredPart(value: unknown): ChatMessageStructuredPart | null {
	if (!isRecord(value)) {
		return null;
	}

	if (value.type === "source_items") {
		const sourceItems = normalizeSourceItems(value.sourceItems);
		if (sourceItems.length === 0) {
			return null;
		}

		return {
			type: "source_items",
			sourceItems,
		};
	}

	return null;
}

export function normalizeChatStructuredParts(value: unknown): ChatMessageStructuredPart[] {
	if (!Array.isArray(value)) {
		return [];
	}

	return value
		.map((part) => normalizeStructuredPart(part))
		.filter((part): part is ChatMessageStructuredPart => part !== null);
}
