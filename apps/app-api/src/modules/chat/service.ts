import { createChatConversationServiceContext } from "./service-context";
import type {
	ChatConversationService,
	ChatConversationServiceDependencies,
} from "./service-contract";
import { createChatConversationFeedbackOperations } from "./service-feedback-operations";
import { createChatConversationMutationOperations } from "./service-mutation-operations";
import { createChatConversationQueryOperations } from "./service-query-operations";

export type {
	ChatConversationService,
	ChatConversationServiceDependencies,
} from "./service-contract";

export function buildChatConversationService(
	dependencies: ChatConversationServiceDependencies,
): ChatConversationService {
	const context = createChatConversationServiceContext(dependencies);
	return {
		...createChatConversationQueryOperations(context),
		...createChatConversationMutationOperations(context),
		...createChatConversationFeedbackOperations(context),
	};
}
