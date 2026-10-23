import type { RuntimeDbGetter } from "../../db/runtime";
import type { ChatConversationStoreContext } from "./store-context";
import { createPgChatConversationFeedbackStore } from "./store-feedback-operations";
import { createPgChatConversationMutationStore } from "./store-mutation-operations";
import { createPgChatConversationReadStore } from "./store-read-operations";

export type {
	ChatConversationDraftWrite,
	ChatConversationListView,
	ChatConversationStore,
} from "./store-contract";

export function createPgChatConversationStore(input: {
	getDb: RuntimeDbGetter;
}): import("./store-contract").ChatConversationStore {
	const context: ChatConversationStoreContext = {
		getDb: input.getDb,
	};
	return {
		...createPgChatConversationReadStore(context),
		...createPgChatConversationMutationStore(context),
		...createPgChatConversationFeedbackStore(context),
	};
}
