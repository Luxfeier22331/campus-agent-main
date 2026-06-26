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

export interface ChatPlacePointGeometry {
	latitude: number;
	longitude: number;
}

export interface ChatPlaceCard {
	placeId: string;
	entityType: string;
	displayName: string;
	campusScope: string | null;
	campusArea: string | null;
	locationDescription: string | null;
	landmarkHint: string | null;
	accessNote: string | null;
	openingNote: string | null;
	serviceTags: string[];
	pointGeometry: ChatPlacePointGeometry | null;
	coordinateReferenceSystem: string | null;
	sourceRefs: string[];
}

export interface ChatPlaceCardStructuredPart {
	type: "place_card";
	placeCard: ChatPlaceCard;
}

export type ChatSourceTargetKind =
	| "canonical_reader"
	| "notice_reader"
	| "public_notice_url"
	| "restricted_notice";

export type ChatSourceKind = "campus_service" | "curriculum" | "document" | "notice" | "regulation";

export interface ChatSourceAction {
	label: "原通知" | "打开原通知" | "查看文档" | "查看整理版" | "需登录查看";
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

export interface ChatCampusServiceTraceCard {
	title: string;
	refs: string[];
}

export interface ChatCampusServiceTraceCardsStructuredPart {
	type: "campus_service_trace_cards";
	traceCards: ChatCampusServiceTraceCard[];
}

export type ChatMessageStructuredPart =
	| ChatPlaceCardStructuredPart
	| ChatSourceItemsStructuredPart
	| ChatCampusServiceTraceCardsStructuredPart;

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
	contextSummary?: string | null;
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

function normalizeStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}

	return value
		.map((item) => normalizeOptionalString(item))
		.filter((item): item is string => item !== null);
}

function normalizePointGeometry(value: unknown): ChatPlacePointGeometry | null {
	if (!isRecord(value)) {
		return null;
	}

	const longitude = typeof value.longitude === "number" ? value.longitude : null;
	const latitude = typeof value.latitude === "number" ? value.latitude : null;
	if (longitude === null || latitude === null) {
		return null;
	}

	return { latitude, longitude };
}

function normalizePlaceCard(value: unknown): ChatPlaceCard | null {
	if (!isRecord(value)) {
		return null;
	}

	const placeId = normalizeOptionalString(value.placeId);
	const entityType = normalizeOptionalString(value.entityType);
	const displayName = normalizeOptionalString(value.displayName);
	if (!(placeId && entityType && displayName)) {
		return null;
	}

	return {
		placeId,
		entityType,
		displayName,
		campusScope: normalizeOptionalString(value.campusScope),
		campusArea: normalizeOptionalString(value.campusArea),
		locationDescription: normalizeOptionalString(value.locationDescription),
		landmarkHint: normalizeOptionalString(value.landmarkHint),
		accessNote: normalizeOptionalString(value.accessNote),
		openingNote: normalizeOptionalString(value.openingNote),
		serviceTags: normalizeStringArray(value.serviceTags),
		pointGeometry: normalizePointGeometry(value.pointGeometry),
		coordinateReferenceSystem: normalizeOptionalString(value.coordinateReferenceSystem),
		sourceRefs: normalizeStringArray(value.sourceRefs),
	};
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
		normalized === "campus_service" ||
		normalized === "curriculum" ||
		normalized === "document" ||
		normalized === "notice" ||
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
		normalized === "restricted_notice"
	) {
		return normalized;
	}
	return null;
}

function isBrowserSafePublicNoticeHref(value: string): boolean {
	try {
		const url = new URL(value);
		const hostname = url.hostname.toLowerCase();
		const isMucPublicHost =
			(hostname === "muc.edu.cn" || hostname.endsWith(".muc.edu.cn")) &&
			hostname !== "my.muc.edu.cn";
		return url.protocol === "https:" && (isMucPublicHost || hostname === "mp.weixin.qq.com");
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
		return null;
	}
	const external = Boolean(value.external);
	const isAllowedHref =
		targetKind === "public_notice_url"
			? isBrowserSafePublicNoticeHref(href)
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
	return {
		...(normalizeOptionalString(value.accessScope)
			? { accessScope: normalizeOptionalString(value.accessScope) ?? undefined }
			: {}),
		...(normalizeOptionalString(value.collection)
			? { collection: normalizeOptionalString(value.collection) ?? undefined }
			: {}),
		...(normalizeOptionalString(value.contentHash)
			? { contentHash: normalizeOptionalString(value.contentHash) ?? undefined }
			: {}),
		...(normalizeOptionalString(value.documentId)
			? { documentId: normalizeOptionalString(value.documentId) ?? undefined }
			: {}),
		...(normalizeOptionalString(value.evidenceId)
			? { evidenceId: normalizeOptionalString(value.evidenceId) ?? undefined }
			: {}),
		...(normalizeOptionalString(value.evidenceRole)
			? { evidenceRole: normalizeOptionalString(value.evidenceRole) ?? undefined }
			: {}),
		...(normalizeOptionalString(value.sourceId)
			? { sourceId: normalizeOptionalString(value.sourceId) ?? undefined }
			: {}),
		...(normalizeOptionalString(value.snapshotId)
			? { snapshotId: normalizeOptionalString(value.snapshotId) ?? undefined }
			: {}),
		...(normalizeOptionalString(value.versionId)
			? { versionId: normalizeOptionalString(value.versionId) ?? undefined }
			: {}),
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

const UNSAFE_TRACE_TOKEN_PATTERN =
	/(?:release[_-]?id|ingestion_projection|table_parser_state|debug[_-]?only|s3:\/\/|postgres)/iu;

function isSafeTraceLabel(value: string): boolean {
	if (!value.trim()) {
		return false;
	}
	if (value.length > 160) {
		return false;
	}
	return !UNSAFE_TRACE_TOKEN_PATTERN.test(value);
}

function normalizeCampusServiceTraceCard(value: unknown): ChatCampusServiceTraceCard | null {
	if (!isRecord(value)) {
		return null;
	}

	const title = normalizeOptionalString(value.title);
	if (!(title && isSafeTraceLabel(title))) {
		return null;
	}

	const refs = normalizeStringArray(value.refs).filter(isSafeTraceLabel).slice(0, 8);
	if (refs.length === 0) {
		return null;
	}

	return {
		title,
		refs,
	};
}

function normalizeCampusServiceTraceCards(value: unknown): ChatCampusServiceTraceCard[] {
	if (!Array.isArray(value)) {
		return [];
	}

	return value
		.map((item) => normalizeCampusServiceTraceCard(item))
		.filter((item): item is ChatCampusServiceTraceCard => item !== null)
		.slice(0, 3);
}

function normalizeStructuredPart(value: unknown): ChatMessageStructuredPart | null {
	if (!isRecord(value)) {
		return null;
	}

	if (value.type === "place_card") {
		const placeCard = normalizePlaceCard(value.placeCard);
		if (!placeCard) {
			return null;
		}

		return {
			type: "place_card",
			placeCard,
		};
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

	if (value.type === "campus_service_trace_cards") {
		const traceCards = normalizeCampusServiceTraceCards(value.traceCards);
		if (traceCards.length === 0) {
			return null;
		}

		return {
			type: "campus_service_trace_cards",
			traceCards,
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
