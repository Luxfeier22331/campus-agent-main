import type {
	ChatConversation,
	ChatConversationSearchResult,
	ChatConversationSummary,
	ChatMessageFeedback,
} from "./model";

export interface ChatConversationDraftWrite {
	conversationId: string;
	ownerUserId: string;
	title: string;
	createdAt: string;
	updatedAt: string;
}

export type ChatConversationListView = "active" | "archived";

export interface ChatConversationStore {
	deleteConversationByOwner?(ownerUserId: string, conversationId: string): Promise<boolean>;
	deleteMessageFeedbackByOwner(input: {
		conversationId: string;
		messageId: string;
		ownerUserId: string;
	}): Promise<boolean>;
	listConversationSummariesByOwner(input: {
		ownerUserId: string;
		view: ChatConversationListView;
		limit: number;
	}): Promise<ChatConversationSummary[]>;
	listConversationSummariesPageByOwner(input: {
		ownerUserId: string;
		limit: number;
		endingBeforeConversationId: string | null;
	}): Promise<{ conversations: ChatConversationSummary[]; hasMore: boolean }>;
	createConversationDraft(input: ChatConversationDraftWrite): Promise<ChatConversation>;
	deleteConversationsByOwner(ownerUserId: string): Promise<number>;
	deleteTrailingMessagesFromMessageByOwner(input: {
		ownerUserId: string;
		conversationId: string;
		messageId: string;
		updatedAt: string;
	}): Promise<boolean>;
	getConversationDetailByOwner(
		ownerUserId: string,
		conversationId: string,
	): Promise<ChatConversation | null>;
	getConversationByOwner(
		ownerUserId: string,
		conversationId: string,
	): Promise<ChatConversation | null>;
	markConversationArchivedByOwner(input: {
		ownerUserId: string;
		conversationId: string;
		archivedAt: string | null;
		updatedAt: string;
	}): Promise<ChatConversationSummary | null>;
	markConversationDeletedByOwner(input: {
		ownerUserId: string;
		conversationId: string;
		deletedAt: string;
		updatedAt: string;
	}): Promise<boolean>;
	markConversationPinnedByOwner(input: {
		ownerUserId: string;
		conversationId: string;
		pinnedAt: string | null;
		updatedAt: string;
	}): Promise<ChatConversationSummary | null>;
	renameConversationByOwner(input: {
		ownerUserId: string;
		conversationId: string;
		title: string;
		updatedAt: string;
	}): Promise<ChatConversationSummary | null>;
	searchConversationSummariesByOwner(input: {
		ownerUserId: string;
		query: string;
		view: ChatConversationListView;
		limit: number;
	}): Promise<ChatConversationSearchResult[]>;
	upsertMessageFeedbackByOwner(input: {
		conversationId: string;
		feedbackId: string;
		messageId: string;
		ownerUserId: string;
		reasonCodes: ChatMessageFeedback["reasonCodes"];
		updatedAt: string;
		vote: ChatMessageFeedback["vote"];
	}): Promise<ChatMessageFeedback | null>;
}
