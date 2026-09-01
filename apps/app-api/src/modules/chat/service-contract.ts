import type { ResolvedAppPrincipal } from "../auth";
import type {
	ChatConversationResponse,
	ChatConversationSearchResultResponse,
	ChatConversationSummaryResponse,
	ChatMessageFeedback,
	ChatMessageFeedbackVote,
	VendorChatHistoryPageResponse,
} from "./model";
import type { ChatConversationListView, ChatConversationStore } from "./store";

export interface ChatConversationService {
	archive(input: {
		conversationId: string;
		principal: ResolvedAppPrincipal;
	}): Promise<{ conversation: ChatConversationSummaryResponse }>;
	deleteMessageFeedback(input: {
		conversationId: string;
		messageId: string;
		principal: ResolvedAppPrincipal;
	}): Promise<{ deleted: true }>;
	list(input: {
		limit?: number;
		principal: ResolvedAppPrincipal;
		view?: ChatConversationListView;
	}): Promise<{ conversations: ChatConversationSummaryResponse[] }>;
	listHistoryPage(input: {
		principal: ResolvedAppPrincipal;
		limit: number;
		endingBeforeConversationId: string | null;
	}): Promise<VendorChatHistoryPageResponse>;
	createDraft(input: {
		principal: ResolvedAppPrincipal;
	}): Promise<{ conversation: ChatConversationResponse }>;
	deleteAll(input: { principal: ResolvedAppPrincipal }): Promise<{ deletedCount: number }>;
	deleteById(input: {
		conversationId: string;
		principal: ResolvedAppPrincipal;
	}): Promise<{ deleted: true }>;
	deleteTrailingMessages(input: {
		conversationId: string;
		messageId: string;
		principal: ResolvedAppPrincipal;
	}): Promise<{ deleted: true }>;
	getById(input: {
		conversationId: string;
		principal: ResolvedAppPrincipal;
	}): Promise<{ conversation: ChatConversationResponse }>;
	pin(input: {
		conversationId: string;
		principal: ResolvedAppPrincipal;
	}): Promise<{ conversation: ChatConversationSummaryResponse }>;
	rename(input: {
		conversationId: string;
		principal: ResolvedAppPrincipal;
		title: string;
	}): Promise<{ conversation: ChatConversationSummaryResponse }>;
	search(input: {
		limit?: number;
		principal: ResolvedAppPrincipal;
		query: string;
		view?: ChatConversationListView;
	}): Promise<{ query: string; conversations: ChatConversationSearchResultResponse[] }>;
	setMessageFeedback(input: {
		conversationId: string;
		messageId: string;
		principal: ResolvedAppPrincipal;
		reasonCodes?: string[];
		vote: ChatMessageFeedbackVote;
	}): Promise<{ feedback: ChatMessageFeedback }>;
	unarchive(input: {
		conversationId: string;
		principal: ResolvedAppPrincipal;
	}): Promise<{ conversation: ChatConversationSummaryResponse }>;
	unpin(input: {
		conversationId: string;
		principal: ResolvedAppPrincipal;
	}): Promise<{ conversation: ChatConversationSummaryResponse }>;
}

export interface ChatConversationServiceDependencies {
	detailStore?: Pick<ChatConversationStore, "getConversationDetailByOwner">;
	dispatchMemoryCommands?: () => Promise<unknown>;
	generateId?: (prefix: string) => string;
	now?: () => Date;
	store: ChatConversationStore;
}
