export type AssistantMessageKind = "answer" | "clarification" | "no_answer" | "error";
export type ChatMessageRole = "user" | "assistant";
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

export interface ChatSourceCard {
	title: string;
	sectionTitle: string;
	snippet: string;
	href: string;
	collectionLabel: string;
	versionLabel: string;
	pageLabel: string;
}

export interface ChatSourceCardsStructuredPart {
	type: "source_cards";
	sourceCards: ChatSourceCard[];
}

export type ChatMessageStructuredPart = ChatPlaceCardStructuredPart | ChatSourceCardsStructuredPart;

export interface ChatSessionSlot {
	confirmed: boolean;
	name: string;
	updatedAt: string;
	value: string;
}

export interface ChatMessage {
	id: string;
	conversationId: string;
	role: ChatMessageRole;
	kind: AssistantMessageKind | null;
	text: string;
	createdAt: string;
	requestId: string | null;
	retryable: boolean | null;
	structuredParts: ChatMessageStructuredPart[];
}

export interface ChatConversation {
	id: string;
	ownerUserId: string;
	title: string;
	createdAt: string;
	updatedAt: string;
	sessionSlots: ChatSessionSlot[];
	messages: ChatMessage[];
}

export interface ChatConversationSummary {
	id: string;
	title: string;
	createdAt: string;
	updatedAt: string;
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

function normalizeSourceCard(value: unknown): ChatSourceCard | null {
	if (!isRecord(value)) {
		return null;
	}

	const title = normalizeOptionalString(value.title);
	const href = normalizeOptionalString(value.href);
	const snippet = normalizeOptionalString(value.snippet);
	if (!(title && href && snippet && isBrowserSafeDocsHref(href))) {
		return null;
	}

	return {
		title,
		sectionTitle: normalizeOptionalString(value.sectionTitle) ?? "",
		snippet,
		href,
		collectionLabel: normalizeOptionalString(value.collectionLabel) ?? "",
		versionLabel: normalizeOptionalString(value.versionLabel) ?? "",
		pageLabel: normalizeOptionalString(value.pageLabel) ?? "",
	};
}

function normalizeSourceCards(value: unknown): ChatSourceCard[] {
	if (!Array.isArray(value)) {
		return [];
	}

	return value
		.map((item) => normalizeSourceCard(item))
		.filter((item): item is ChatSourceCard => item !== null)
		.slice(0, 5);
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

	if (value.type === "source_cards") {
		const sourceCards = normalizeSourceCards(value.sourceCards);
		if (sourceCards.length === 0) {
			return null;
		}

		return {
			type: "source_cards",
			sourceCards,
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
