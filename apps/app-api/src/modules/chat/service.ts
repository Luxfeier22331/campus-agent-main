import { randomUUID } from "node:crypto";

import { AppApiRouteError } from "../../http";
import type { ResolvedAppPrincipal } from "../auth";
import {
	type ChatConversationResponse,
	type ChatConversationSearchResultResponse,
	type ChatConversationSummaryResponse,
	type ChatMessageFeedback,
	type ChatMessageFeedbackReasonCode,
	type ChatMessageFeedbackVote,
	DRAFT_CONVERSATION_TITLE,
	toConversationResponse,
	toConversationSearchResultResponse,
	toConversationSummaryResponse,
	toVendorChatHistoryItemResponse,
	type VendorChatHistoryPageResponse,
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

function defaultGenerateId(prefix: string): string {
	return `${prefix}_${randomUUID().replace(/-/g, "")}`;
}

function createChatRouteError(input: {
	code: string;
	message: string;
	status: number;
}): AppApiRouteError {
	return new AppApiRouteError({
		code: input.code,
		message: input.message,
		retryable: false,
		status: input.status,
	});
}

function assertChatPrincipal(principal: ResolvedAppPrincipal): string {
	if (!principal.permissions.chat) {
		throw createChatRouteError({
			code: "forbidden",
			message: "Chat access is not available for this principal.",
			status: 403,
		});
	}

	return principal.principal.principalId;
}

const MESSAGE_FEEDBACK_REASON_CODES = new Set<ChatMessageFeedbackReasonCode>([
	"wrong_intent",
	"not_enough_detail",
	"outdated_or_missing_source",
	"incorrect_answer",
	"unclear_or_hard_to_use",
	"other",
]);

function normalizeConversationLimit(input: {
	defaultLimit: number;
	limit?: number;
	maxLimit: number;
}): number {
	if (input.limit === undefined) {
		return input.defaultLimit;
	}
	if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > input.maxLimit) {
		throw createChatRouteError({
			code: "invalid_conversation_limit",
			message: `limit must be an integer from 1 to ${input.maxLimit}.`,
			status: 400,
		});
	}
	return input.limit;
}

function normalizeConversationView(
	view: ChatConversationListView | undefined,
): ChatConversationListView {
	return view ?? "active";
}

function normalizeConversationTitle(title: string): string {
	const trimmed = title.trim();
	if (trimmed.length === 0 || trimmed.length > 80) {
		throw createChatRouteError({
			code: "invalid_conversation_title",
			message: "Conversation title must be 1 to 80 characters.",
			status: 400,
		});
	}
	return trimmed;
}

function normalizeSearchQuery(query: string): string {
	const trimmed = query.trim();
	if (trimmed.length === 0 || trimmed.length > 80) {
		throw createChatRouteError({
			code: "invalid_conversation_search_query",
			message: "Search query must be 1 to 80 characters.",
			status: 400,
		});
	}
	return trimmed;
}

function normalizeMessageFeedbackReasonCodes(input: {
	reasonCodes?: string[];
	vote: ChatMessageFeedbackVote;
}): ChatMessageFeedbackReasonCode[] {
	const rawReasonCodes = input.reasonCodes ?? [];
	if (!Array.isArray(rawReasonCodes)) {
		throw createChatRouteError({
			code: "invalid_message_feedback",
			message: "reasonCodes must be an array.",
			status: 400,
		});
	}

	const reasonCodes = rawReasonCodes.map((reasonCode) => reasonCode.trim());
	if (input.vote === "helpful" && reasonCodes.length > 0) {
		throw createChatRouteError({
			code: "invalid_message_feedback",
			message: "reasonCodes are only accepted for unhelpful feedback.",
			status: 400,
		});
	}
	if (reasonCodes.length > 3) {
		throw createChatRouteError({
			code: "invalid_message_feedback",
			message: "reasonCodes cannot contain more than 3 values.",
			status: 400,
		});
	}

	const seen = new Set<string>();
	for (const reasonCode of reasonCodes) {
		if (
			!MESSAGE_FEEDBACK_REASON_CODES.has(reasonCode as ChatMessageFeedbackReasonCode) ||
			seen.has(reasonCode)
		) {
			throw createChatRouteError({
				code: "invalid_message_feedback",
				message: "reasonCodes must be unique supported feedback reason codes.",
				status: 400,
			});
		}
		seen.add(reasonCode);
	}

	return reasonCodes as ChatMessageFeedbackReasonCode[];
}

export function buildChatConversationService(
	dependencies: ChatConversationServiceDependencies,
): ChatConversationService {
	const generateId = dependencies.generateId ?? defaultGenerateId;
	const now = dependencies.now ?? (() => new Date());

	return {
		async deleteMessageFeedback(input) {
			const ownerUserId = assertChatPrincipal(input.principal);
			const deleted = await dependencies.store.deleteMessageFeedbackByOwner({
				conversationId: input.conversationId,
				messageId: input.messageId,
				ownerUserId,
			});
			if (!deleted) {
				throw createChatRouteError({
					code: "message_feedback_not_found",
					message: "Message feedback not found.",
					status: 404,
				});
			}

			return { deleted: true as const };
		},

		async list(input) {
			const ownerUserId = assertChatPrincipal(input.principal);
			const conversations = await dependencies.store.listConversationSummariesByOwner({
				limit: normalizeConversationLimit({
					defaultLimit: 50,
					...(input.limit === undefined ? {} : { limit: input.limit }),
					maxLimit: 100,
				}),
				ownerUserId,
				view: normalizeConversationView(input.view),
			});

			return {
				conversations: conversations.map(toConversationSummaryResponse),
			};
		},

		async listHistoryPage(input) {
			const ownerUserId = assertChatPrincipal(input.principal);
			const page = await dependencies.store.listConversationSummariesPageByOwner({
				endingBeforeConversationId: input.endingBeforeConversationId,
				limit: input.limit,
				ownerUserId,
			});

			return {
				chats: page.conversations.map(toVendorChatHistoryItemResponse),
				hasMore: page.hasMore,
			};
		},

		async createDraft(input) {
			const ownerUserId = assertChatPrincipal(input.principal);
			const createdAt = now().toISOString();
			const conversation = await dependencies.store.createConversationDraft({
				conversationId: generateId("conv"),
				createdAt,
				ownerUserId,
				title: DRAFT_CONVERSATION_TITLE,
				updatedAt: createdAt,
			});

			return {
				conversation: toConversationResponse(conversation),
			};
		},

		async deleteAll(input) {
			const ownerUserId = assertChatPrincipal(input.principal);
			const deletedCount = await dependencies.store.deleteConversationsByOwner(ownerUserId);
			if (deletedCount > 0) {
				await dependencies.dispatchMemoryCommands?.();
			}

			return { deletedCount };
		},

		async deleteById(input) {
			const ownerUserId = assertChatPrincipal(input.principal);
			const updatedAt = now().toISOString();
			const deleted = await dependencies.store.markConversationDeletedByOwner({
				conversationId: input.conversationId,
				deletedAt: updatedAt,
				ownerUserId,
				updatedAt,
			});
			if (!deleted) {
				throw createChatRouteError({
					code: "conversation_not_found",
					message: "Conversation not found.",
					status: 404,
				});
			}
			await dependencies.dispatchMemoryCommands?.();

			return { deleted: true as const };
		},

		async deleteTrailingMessages(input) {
			const ownerUserId = assertChatPrincipal(input.principal);
			const deleted = await dependencies.store.deleteTrailingMessagesFromMessageByOwner({
				conversationId: input.conversationId,
				messageId: input.messageId,
				ownerUserId,
				updatedAt: now().toISOString(),
			});
			if (!deleted) {
				throw createChatRouteError({
					code: "message_not_found",
					message: "Message not found.",
					status: 404,
				});
			}
			await dependencies.dispatchMemoryCommands?.();

			return { deleted: true as const };
		},

		async getById(input) {
			const ownerUserId = assertChatPrincipal(input.principal);
			const detailStore = dependencies.detailStore ?? dependencies.store;
			const conversation = await detailStore.getConversationDetailByOwner(
				ownerUserId,
				input.conversationId,
			);
			if (!conversation) {
				throw createChatRouteError({
					code: "conversation_not_found",
					message: "Conversation not found.",
					status: 404,
				});
			}

			return {
				conversation: toConversationResponse(conversation),
			};
		},

		async archive(input) {
			const ownerUserId = assertChatPrincipal(input.principal);
			const updatedAt = now().toISOString();
			const conversation = await dependencies.store.markConversationArchivedByOwner({
				archivedAt: updatedAt,
				conversationId: input.conversationId,
				ownerUserId,
				updatedAt,
			});
			if (!conversation) {
				throw createChatRouteError({
					code: "conversation_not_found",
					message: "Conversation not found.",
					status: 404,
				});
			}
			return { conversation: toConversationSummaryResponse(conversation) };
		},

		async unarchive(input) {
			const ownerUserId = assertChatPrincipal(input.principal);
			const updatedAt = now().toISOString();
			const conversation = await dependencies.store.markConversationArchivedByOwner({
				archivedAt: null,
				conversationId: input.conversationId,
				ownerUserId,
				updatedAt,
			});
			if (!conversation) {
				throw createChatRouteError({
					code: "conversation_not_found",
					message: "Conversation not found.",
					status: 404,
				});
			}
			return { conversation: toConversationSummaryResponse(conversation) };
		},

		async pin(input) {
			const ownerUserId = assertChatPrincipal(input.principal);
			const updatedAt = now().toISOString();
			const conversation = await dependencies.store.markConversationPinnedByOwner({
				conversationId: input.conversationId,
				ownerUserId,
				pinnedAt: updatedAt,
				updatedAt,
			});
			if (!conversation) {
				throw createChatRouteError({
					code: "conversation_not_found",
					message: "Conversation not found.",
					status: 404,
				});
			}
			return { conversation: toConversationSummaryResponse(conversation) };
		},

		async unpin(input) {
			const ownerUserId = assertChatPrincipal(input.principal);
			const updatedAt = now().toISOString();
			const conversation = await dependencies.store.markConversationPinnedByOwner({
				conversationId: input.conversationId,
				ownerUserId,
				pinnedAt: null,
				updatedAt,
			});
			if (!conversation) {
				throw createChatRouteError({
					code: "conversation_not_found",
					message: "Conversation not found.",
					status: 404,
				});
			}
			return { conversation: toConversationSummaryResponse(conversation) };
		},

		async rename(input) {
			const ownerUserId = assertChatPrincipal(input.principal);
			const conversation = await dependencies.store.renameConversationByOwner({
				conversationId: input.conversationId,
				ownerUserId,
				title: normalizeConversationTitle(input.title),
				updatedAt: now().toISOString(),
			});
			if (!conversation) {
				throw createChatRouteError({
					code: "conversation_not_found",
					message: "Conversation not found.",
					status: 404,
				});
			}
			return { conversation: toConversationSummaryResponse(conversation) };
		},

		async search(input) {
			const ownerUserId = assertChatPrincipal(input.principal);
			const query = normalizeSearchQuery(input.query);
			const conversations = await dependencies.store.searchConversationSummariesByOwner({
				limit: normalizeConversationLimit({
					defaultLimit: 20,
					...(input.limit === undefined ? {} : { limit: input.limit }),
					maxLimit: 50,
				}),
				ownerUserId,
				query,
				view: normalizeConversationView(input.view),
			});

			return {
				query,
				conversations: conversations.map(toConversationSearchResultResponse),
			};
		},

		async setMessageFeedback(input) {
			const ownerUserId = assertChatPrincipal(input.principal);
			const reasonCodes = normalizeMessageFeedbackReasonCodes({
				...(input.reasonCodes ? { reasonCodes: input.reasonCodes } : {}),
				vote: input.vote,
			});
			const updatedAt = now().toISOString();
			const feedback = await dependencies.store.upsertMessageFeedbackByOwner({
				conversationId: input.conversationId,
				feedbackId: generateId("fb"),
				messageId: input.messageId,
				ownerUserId,
				reasonCodes,
				updatedAt,
				vote: input.vote,
			});
			if (!feedback) {
				throw createChatRouteError({
					code: "message_feedback_target_not_found",
					message: "Message feedback target not found.",
					status: 404,
				});
			}

			return { feedback };
		},
	};
}
