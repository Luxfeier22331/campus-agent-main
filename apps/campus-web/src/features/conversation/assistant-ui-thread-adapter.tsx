import {
	ExportedMessageRepository,
	type ExportedMessageRepositoryItem,
	type RemoteThreadListAdapter,
	RuntimeAdapterProvider,
	type ThreadHistoryAdapter,
	useAuiState,
} from "@assistant-ui/react";
import { createAssistantStream } from "assistant-stream";
import { type PropsWithChildren, useMemo } from "react";

import {
	archiveConversation,
	createConversationDraft,
	deleteConversation,
	getConversationDetail,
	listConversations,
	renameConversation,
	unarchiveConversation,
} from "./api";
import { toAssistantThreadMessages } from "./assistant-ui-mappers";
import type { ConversationSummary } from "./model";

const THREAD_LIST_LIMIT = 50;
type AssistantRemoteThreadMetadata = Awaited<ReturnType<RemoteThreadListAdapter["fetch"]>>;

export function toAssistantThreadMetadata(
	conversation: ConversationSummary,
): AssistantRemoteThreadMetadata {
	return {
		externalId: conversation.id,
		lastMessageAt: new Date(conversation.updatedAt),
		remoteId: conversation.id,
		status: conversation.archivedAt ? "archived" : "regular",
		title: conversation.title,
	};
}

export function createCampusAssistantThreadListAdapter(): RemoteThreadListAdapter {
	return {
		async archive(remoteId) {
			await archiveConversation(remoteId);
		},
		async delete(remoteId) {
			await deleteConversation(remoteId);
		},
		async fetch(threadId) {
			return toAssistantThreadMetadata(await getConversationDetail(threadId));
		},
		async generateTitle() {
			return createAssistantStream(() => {
				return;
			});
		},
		async initialize() {
			const conversation = await createConversationDraft();
			return {
				externalId: conversation.id,
				remoteId: conversation.id,
			};
		},
		async list() {
			const [active, archived] = await Promise.all([
				listConversations({ limit: THREAD_LIST_LIMIT, view: "active" }),
				listConversations({ limit: THREAD_LIST_LIMIT, view: "archived" }),
			]);
			return {
				threads: [...active, ...archived].map(toAssistantThreadMetadata),
			};
		},
		async rename(remoteId, newTitle) {
			await renameConversation({ conversationId: remoteId, title: newTitle });
		},
		async unarchive(remoteId) {
			await unarchiveConversation(remoteId);
		},
		unstable_Provider: CampusAssistantThreadHistoryProvider,
	};
}

export function createCampusAssistantThreadHistoryAdapter(
	remoteId: string | undefined,
): ThreadHistoryAdapter {
	return {
		async append(_item: ExportedMessageRepositoryItem) {
			return;
		},
		async load() {
			if (!remoteId) {
				return ExportedMessageRepository.fromArray([]);
			}
			const conversation = await getConversationDetail(remoteId);
			return ExportedMessageRepository.fromArray(toAssistantThreadMessages(conversation));
		},
	};
}

function CampusAssistantThreadHistoryProvider({ children }: PropsWithChildren) {
	const remoteId = useAuiState((state) => state.threadListItem.remoteId);
	const history = useMemo(() => createCampusAssistantThreadHistoryAdapter(remoteId), [remoteId]);

	return <RuntimeAdapterProvider adapters={{ history }}>{children}</RuntimeAdapterProvider>;
}
