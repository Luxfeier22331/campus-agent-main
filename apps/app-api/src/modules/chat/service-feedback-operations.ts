import type { ChatConversationServiceContext } from "./service-context";
import type { ChatConversationService } from "./service-contract";
import {
	assertChatPrincipal,
	createChatRouteError,
	normalizeMessageFeedbackReasonCodes,
} from "./service-validation";

type ChatConversationFeedbackOperations = Pick<
	ChatConversationService,
	"deleteMessageFeedback" | "setMessageFeedback"
>;

export function createChatConversationFeedbackOperations(
	context: ChatConversationServiceContext,
): ChatConversationFeedbackOperations {
	return {
		async deleteMessageFeedback(input) {
			const ownerUserId = assertChatPrincipal(input.principal);
			const deleted = await context.store.deleteMessageFeedbackByOwner({
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

		async setMessageFeedback(input) {
			const ownerUserId = assertChatPrincipal(input.principal);
			const reasonCodes = normalizeMessageFeedbackReasonCodes({
				...(input.reasonCodes ? { reasonCodes: input.reasonCodes } : {}),
				vote: input.vote,
			});
			const updatedAt = context.now().toISOString();
			const feedback = await context.store.upsertMessageFeedbackByOwner({
				conversationId: input.conversationId,
				feedbackId: context.generateId("fb"),
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
