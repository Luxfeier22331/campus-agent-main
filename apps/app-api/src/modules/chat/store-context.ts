import type { RuntimeDbGetter } from "../../db/runtime";

export interface ChatConversationStoreContext {
	getDb: RuntimeDbGetter;
}
