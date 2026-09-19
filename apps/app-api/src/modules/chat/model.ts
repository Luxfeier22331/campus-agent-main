export type AssistantMessageKind = "answer" | "error";
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

export interface ChatCampusSourceAction {
	label: "查看文档";
	href: string;
	external: false;
	disabledReason: null;
}

export interface ChatNoticeSourceAction {
	label: "查看通知";
	href: string;
	external: false;
	disabledReason: null;
}

export type ChatWebSourceAction = {
	label: "打开网页";
	external: true;
} & ({ href: string; disabledReason: null } | { href: null; disabledReason: "source_unavailable" });

export type ChatSourceAction =
	| ChatCampusSourceAction
	| ChatNoticeSourceAction
	| ChatWebSourceAction;

export interface ChatCampusSourceItem {
	citationIndexes: number[];
	kind: "campus_document";
	title: string;
	snippet: string | null;
	primaryAction: ChatCampusSourceAction;
	sectionTitle: string;
	collectionLabel: string;
	versionSlug: string;
}

export interface ChatNoticeSourceItem {
	citationIndexes: number[];
	kind: "campus_notice";
	noticeId: string;
	title: string;
	snippet: string | null;
	primaryAction: ChatNoticeSourceAction;
	sectionTitle: string;
}

export interface ChatWebSourceItem {
	citationIndexes: number[];
	kind: "web_page";
	hostname: string | null;
	title: string;
	snippet: string | null;
	primaryAction: ChatWebSourceAction;
}

export type ChatSourceItem = ChatCampusSourceItem | ChatNoticeSourceItem | ChatWebSourceItem;

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
	activeRequestId?: string | null;
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
	activeRequestId: string | null;
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
		activeRequestId: conversation.activeRequestId ?? null,
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

function normalizeExternalWebHref(value: unknown): string | null {
	const href = normalizeOptionalString(value);
	if (!href) {
		return null;
	}
	try {
		const parsed = new URL(href);
		if (
			(parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
			!parsed.hostname ||
			parsed.username ||
			parsed.password
		) {
			return null;
		}
		return parsed.href;
	} catch {
		return null;
	}
}

function normalizeSourceAction(value: unknown): ChatSourceAction | null {
	if (!isRecord(value)) {
		return null;
	}
	if (value.external === false && value.label === "查看文档") {
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
	if (value.external === false && value.label === "查看通知") {
		const href = normalizeOptionalString(value.href);
		if (!(href && /^\/notices\/[A-Za-z0-9._~-]+$/u.test(href))) {
			return null;
		}
		return {
			label: "查看通知",
			href,
			external: false,
			disabledReason: null,
		};
	}
	if (value.external === true && value.label === "打开网页") {
		if (value.href === null && value.disabledReason === "source_unavailable") {
			return {
				label: "打开网页",
				external: true,
				href: null,
				disabledReason: "source_unavailable",
			};
		}
		const href = normalizeExternalWebHref(value.href);
		if (!href) {
			return null;
		}
		return {
			label: "打开网页",
			href,
			external: true,
			disabledReason: null,
		};
	}
	return null;
}

function noticeCitationHrefMatchesNoticeId(value: string, noticeId: string): boolean {
	const match = /^\/notices\/([A-Za-z0-9._~-]+)$/u.exec(value);
	return match?.[1] === noticeId;
}

function normalizeSourceItem(value: unknown): ChatSourceItem | null {
	if (!isRecord(value)) {
		return null;
	}

	const title = normalizeOptionalString(value.title);
	const citationIndexes = normalizeCitationIndexes(value.citationIndexes);
	if (!(title && citationIndexes)) {
		return null;
	}

	const primaryAction = normalizeSourceAction(value.primaryAction);
	if (!primaryAction) {
		return null;
	}

	if (value.kind === "campus_document") {
		const versionSlug = normalizeOptionalString(value.versionSlug);
		if (!versionSlug || primaryAction.external !== false || primaryAction.label !== "查看文档") {
			return null;
		}
		return {
			citationIndexes,
			kind: "campus_document",
			title,
			snippet: normalizeOptionalString(value.snippet),
			primaryAction,
			sectionTitle: normalizeOptionalString(value.sectionTitle) ?? "",
			collectionLabel: normalizeOptionalString(value.collectionLabel) ?? "",
			versionSlug,
		};
	}

	if (
		value.kind === "campus_notice" &&
		primaryAction.external === false &&
		primaryAction.label === "查看通知"
	) {
		const noticeId = normalizeOptionalString(value.noticeId);
		const sectionTitle = normalizeOptionalString(value.sectionTitle);
		if (noticeId === null) {
			return null;
		}
		if (sectionTitle === null) {
			return null;
		}
		if (!noticeCitationHrefMatchesNoticeId(primaryAction.href, noticeId)) {
			return null;
		}
		return {
			citationIndexes,
			kind: "campus_notice",
			noticeId,
			title,
			snippet: normalizeOptionalString(value.snippet),
			primaryAction,
			sectionTitle,
		};
	}

	if (value.kind === "web_page" && primaryAction.external === true) {
		const hostname = normalizeOptionalString(value.hostname);
		if (
			primaryAction.href !== null &&
			(!hostname || new URL(primaryAction.href).hostname !== hostname)
		) {
			return null;
		}
		return {
			citationIndexes,
			kind: "web_page",
			hostname,
			title,
			snippet: normalizeOptionalString(value.snippet),
			primaryAction,
		};
	}

	return null;
}

function normalizeCitationIndexes(value: unknown): number[] | null {
	if (!Array.isArray(value) || value.length === 0 || value.length > 10) {
		return null;
	}
	const indexes = value.filter(
		(item): item is number =>
			typeof item === "number" && Number.isInteger(item) && item >= 1 && item <= 10,
	);
	if (indexes.length !== value.length || new Set(indexes).size !== indexes.length) {
		return null;
	}
	return indexes;
}

function normalizeSourceItems(value: unknown): ChatSourceItem[] {
	if (!Array.isArray(value)) {
		return [];
	}

	return value
		.map((item) => normalizeSourceItem(item))
		.filter((item): item is ChatSourceItem => item !== null)
		.slice(0, 10);
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
