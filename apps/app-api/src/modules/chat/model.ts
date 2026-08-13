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

export type ChatSourceTargetKind =
	| "canonical_reader"
	| "notice_reader"
	| "public_notice_url"
	| "public_web_url"
	| "restricted_notice";

export type ChatSourceKind = "curriculum" | "document" | "notice" | "public_web" | "regulation";

export interface ChatSourceAction {
	label: "原通知" | "打开网页" | "打开原通知" | "查看文档" | "查看整理版" | "需登录查看";
	href: string | null;
	external: boolean;
	disabledReason: string | null;
}

export interface ChatSourceItem {
	accessScope?: string;
	collection?: string;
	targetKind: ChatSourceTargetKind;
	contentHash?: string;
	documentId?: string;
	evidenceId?: string;
	evidenceRole?: string;
	sourceKind: ChatSourceKind;
	sourceId?: string;
	snapshotId?: string;
	title: string;
	snippet: string | null;
	primaryAction: ChatSourceAction;
	secondaryActions: ChatSourceAction[];
	sectionTitle: string;
	collectionLabel: string;
	publisherLabel: string;
	publishedAt: string;
	versionLabel: string;
	pageLabel: string;
	trustLabel: string;
	versionId?: string;
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

function normalizeSourceKind(value: unknown): ChatSourceKind | null {
	const normalized = normalizeOptionalString(value);
	if (
		normalized === "curriculum" ||
		normalized === "document" ||
		normalized === "notice" ||
		normalized === "public_web" ||
		normalized === "regulation"
	) {
		return normalized;
	}
	return null;
}

function normalizeSourceTargetKind(value: unknown): ChatSourceTargetKind | null {
	const normalized = normalizeOptionalString(value);
	if (
		normalized === "canonical_reader" ||
		normalized === "notice_reader" ||
		normalized === "public_notice_url" ||
		normalized === "public_web_url" ||
		normalized === "restricted_notice"
	) {
		return normalized;
	}
	return null;
}

function isBrowserSafePublicNoticeHref(value: string): boolean {
	try {
		const url = new URL(value);
		return url.protocol === "https:";
	} catch {
		return false;
	}
}

function isBrowserSafePublicWebHref(value: string): boolean {
	try {
		const url = new URL(value);
		const hostname = url.hostname.toLowerCase();
		return (
			url.protocol === "https:" &&
			(hostname === "muc.edu.cn" || hostname.endsWith(".muc.edu.cn")) &&
			hostname !== "my.muc.edu.cn"
		);
	} catch {
		return false;
	}
}

function normalizeSourceAction(
	value: unknown,
	targetKind: ChatSourceTargetKind,
): ChatSourceAction | null {
	if (!isRecord(value)) {
		return null;
	}

	const label = normalizeOptionalString(value.label);
	const href = normalizeOptionalString(value.href);
	const disabledReason = normalizeOptionalString(value.disabledReason);
	if (
		label !== "原通知" &&
		label !== "打开网页" &&
		label !== "打开原通知" &&
		label !== "查看文档" &&
		label !== "查看整理版" &&
		label !== "需登录查看"
	) {
		return null;
	}

	if (targetKind === "restricted_notice") {
		return {
			label,
			href: null,
			external: false,
			disabledReason,
		};
	}

	if (!href) {
		const isReaderTarget = targetKind === "canonical_reader" || targetKind === "notice_reader";
		if (!(isReaderTarget && disabledReason) || value.external) {
			return null;
		}
		return {
			label,
			href: null,
			external: false,
			disabledReason,
		};
	}
	const external = Boolean(value.external);
	const isAllowedHref =
		targetKind === "public_notice_url"
			? isBrowserSafePublicNoticeHref(href)
			: targetKind === "public_web_url"
				? isBrowserSafePublicWebHref(href)
				: isBrowserSafeDocsHref(href);
	if (!isAllowedHref) {
		return null;
	}

	return {
		label,
		href,
		external,
		disabledReason: null,
	};
}

function normalizeSecondarySourceActions(value: unknown): ChatSourceAction[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value
		.map((item) => {
			if (!isRecord(item)) {
				return null;
			}
			const href = normalizeOptionalString(item.href);
			const label = normalizeOptionalString(item.label);
			if (!(href && (label === "原通知" || label === "查看文档"))) {
				return null;
			}
			const targetKind = label === "原通知" ? "public_notice_url" : "canonical_reader";
			return normalizeSourceAction(
				{
					...item,
					external: targetKind === "public_notice_url",
				},
				targetKind,
			);
		})
		.filter((item): item is ChatSourceAction => item !== null)
		.slice(0, 2);
}

function optionalSourceProofFields(value: Record<string, unknown>): Partial<ChatSourceItem> {
	const accessScope = normalizeOptionalString(value.accessScope);
	const collection = normalizeOptionalString(value.collection);
	const contentHash = normalizeOptionalString(value.contentHash);
	const documentId = normalizeOptionalString(value.documentId);
	const evidenceId = normalizeOptionalString(value.evidenceId);
	const evidenceRole = normalizeOptionalString(value.evidenceRole);
	const sourceId = normalizeOptionalString(value.sourceId);
	const snapshotId = normalizeOptionalString(value.snapshotId);
	const versionId = normalizeOptionalString(value.versionId);
	return {
		...(accessScope ? { accessScope } : {}),
		...(collection ? { collection } : {}),
		...(contentHash ? { contentHash } : {}),
		...(documentId ? { documentId } : {}),
		...(evidenceId ? { evidenceId } : {}),
		...(evidenceRole ? { evidenceRole } : {}),
		...(sourceId ? { sourceId } : {}),
		...(snapshotId ? { snapshotId } : {}),
		...(versionId ? { versionId } : {}),
	};
}

function normalizeSourceItem(value: unknown): ChatSourceItem | null {
	if (!isRecord(value)) {
		return null;
	}

	const targetKind = normalizeSourceTargetKind(value.targetKind);
	const sourceKind = normalizeSourceKind(value.sourceKind);
	const title = normalizeOptionalString(value.title);
	if (!(targetKind && sourceKind && title)) {
		return null;
	}

	const primaryAction = normalizeSourceAction(value.primaryAction, targetKind);
	if (!primaryAction) {
		return null;
	}

	return {
		...optionalSourceProofFields(value),
		targetKind,
		sourceKind,
		title,
		snippet: normalizeOptionalString(value.snippet),
		primaryAction,
		secondaryActions: normalizeSecondarySourceActions(value.secondaryActions),
		sectionTitle: normalizeOptionalString(value.sectionTitle) ?? "",
		collectionLabel: normalizeOptionalString(value.collectionLabel) ?? "",
		publisherLabel: normalizeOptionalString(value.publisherLabel) ?? "",
		publishedAt: normalizeOptionalString(value.publishedAt) ?? "",
		versionLabel: normalizeOptionalString(value.versionLabel) ?? "",
		pageLabel: normalizeOptionalString(value.pageLabel) ?? "",
		trustLabel: normalizeOptionalString(value.trustLabel) ?? "",
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
