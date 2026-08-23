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

import { UnauthorizedError } from "@/platform/api/client";

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
		custom: { pinnedAt: conversation.pinnedAt },
	};
}

export function createCampusAssistantThreadListAdapter(input: {
	enableRemoteHistory: boolean;
}): RemoteThreadListAdapter {
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
		async generateTitle(remoteId) {
			return createAssistantStream(async (controller) => {
				const conversation = await getConversationDetail(remoteId);
				controller.appendText(conversation.title);
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
			if (!input.enableRemoteHistory) {
				return { threads: [] };
			}
			const active = await listConversationsForOptionalSession({
				limit: THREAD_LIST_LIMIT,
				view: "active",
			});
			return {
				threads: active.map(toAssistantThreadMetadata),
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

async function listConversationsForOptionalSession(input: {
	limit: number;
	view: "active" | "archived";
}): Promise<ConversationSummary[]> {
	try {
		return await listConversations(input);
	} catch (error) {
		if (error instanceof UnauthorizedError) {
			return [];
		}
		throw error;
	}
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
