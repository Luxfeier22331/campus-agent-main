import { randomUUID } from "node:crypto";
import type { ChatConversationServiceDependencies } from "./service-contract";
import type { ChatConversationStore } from "./store";

export interface ChatConversationServiceContext {
	detailStore?: Pick<ChatConversationStore, "getConversationDetailByOwner">;
	generateId(prefix: string): string;
	now(): Date;
	store: ChatConversationStore;
}

export function createChatConversationServiceContext(
	dependencies: ChatConversationServiceDependencies,
): ChatConversationServiceContext {
	return {
		...(dependencies.detailStore ? { detailStore: dependencies.detailStore } : {}),
		generateId:
			dependencies.generateId ?? ((prefix) => `${prefix}_${randomUUID().replace(/-/g, "")}`),
		now: dependencies.now ?? (() => new Date()),
		store: dependencies.store,
	};
}
