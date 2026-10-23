import {
	toConversationResponse,
	toConversationSearchResultResponse,
	toConversationSummaryResponse,
	toVendorChatHistoryItemResponse,
} from "./model";
import type { ChatConversationServiceContext } from "./service-context";
import type { ChatConversationService } from "./service-contract";
import {
	assertChatPrincipal,
	createChatRouteError,
	normalizeConversationLimit,
	normalizeConversationView,
	normalizeSearchQuery,
} from "./service-validation";

type ChatConversationQueryOperations = Pick<
	ChatConversationService,
	"getById" | "list" | "listHistoryPage" | "search"
>;

export function createChatConversationQueryOperations(
	context: ChatConversationServiceContext,
): ChatConversationQueryOperations {
	return {
		async getById(input) {
			const ownerUserId = assertChatPrincipal(input.principal);
			const detailStore = context.detailStore ?? context.store;
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

		async list(input) {
			const ownerUserId = assertChatPrincipal(input.principal);
			const conversations = await context.store.listConversationSummariesByOwner({
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
			const page = await context.store.listConversationSummariesPageByOwner({
				endingBeforeConversationId: input.endingBeforeConversationId,
				limit: input.limit,
				ownerUserId,
			});

			return {
				chats: page.conversations.map(toVendorChatHistoryItemResponse),
				hasMore: page.hasMore,
			};
		},

		async search(input) {
			const ownerUserId = assertChatPrincipal(input.principal);
			const query = normalizeSearchQuery(input.query);
			const conversations = await context.store.searchConversationSummariesByOwner({
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
	};
}
