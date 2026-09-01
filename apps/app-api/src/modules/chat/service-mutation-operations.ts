import {
	DRAFT_CONVERSATION_TITLE,
	toConversationResponse,
	toConversationSummaryResponse,
} from "./model";
import type { ChatConversationServiceContext } from "./service-context";
import type { ChatConversationService } from "./service-contract";
import {
	assertChatPrincipal,
	createChatRouteError,
	normalizeConversationTitle,
} from "./service-validation";

type ChatConversationMutationOperations = Pick<
	ChatConversationService,
	| "archive"
	| "createDraft"
	| "deleteAll"
	| "deleteById"
	| "deleteTrailingMessages"
	| "pin"
	| "rename"
	| "unarchive"
	| "unpin"
>;

export function createChatConversationMutationOperations(
	context: ChatConversationServiceContext,
): ChatConversationMutationOperations {
	return {
		async archive(input) {
			const ownerUserId = assertChatPrincipal(input.principal);
			const updatedAt = context.now().toISOString();
			const conversation = await context.store.markConversationArchivedByOwner({
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

		async createDraft(input) {
			const ownerUserId = assertChatPrincipal(input.principal);
			const createdAt = context.now().toISOString();
			const conversation = await context.store.createConversationDraft({
				conversationId: context.generateId("conv"),
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
			const deletedCount = await context.store.deleteConversationsByOwner(ownerUserId);
			if (deletedCount > 0) {
				await context.dispatchMemoryCommands?.();
			}

			return { deletedCount };
		},

		async deleteById(input) {
			const ownerUserId = assertChatPrincipal(input.principal);
			const updatedAt = context.now().toISOString();
			const deleted = await context.store.markConversationDeletedByOwner({
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
			await context.dispatchMemoryCommands?.();

			return { deleted: true as const };
		},

		async deleteTrailingMessages(input) {
			const ownerUserId = assertChatPrincipal(input.principal);
			const deleted = await context.store.deleteTrailingMessagesFromMessageByOwner({
				conversationId: input.conversationId,
				messageId: input.messageId,
				ownerUserId,
				updatedAt: context.now().toISOString(),
			});
			if (!deleted) {
				throw createChatRouteError({
					code: "message_not_found",
					message: "Message not found.",
					status: 404,
				});
			}
			await context.dispatchMemoryCommands?.();

			return { deleted: true as const };
		},

		async pin(input) {
			const ownerUserId = assertChatPrincipal(input.principal);
			const updatedAt = context.now().toISOString();
			const conversation = await context.store.markConversationPinnedByOwner({
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

		async rename(input) {
			const ownerUserId = assertChatPrincipal(input.principal);
			const conversation = await context.store.renameConversationByOwner({
				conversationId: input.conversationId,
				ownerUserId,
				title: normalizeConversationTitle(input.title),
				updatedAt: context.now().toISOString(),
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
			const updatedAt = context.now().toISOString();
			const conversation = await context.store.markConversationArchivedByOwner({
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

		async unpin(input) {
			const ownerUserId = assertChatPrincipal(input.principal);
			const updatedAt = context.now().toISOString();
			const conversation = await context.store.markConversationPinnedByOwner({
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
	};
}
