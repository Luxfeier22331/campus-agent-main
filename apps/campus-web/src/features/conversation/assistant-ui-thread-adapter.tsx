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

import { ApiRequestError, UnauthorizedError } from "@/platform/api/client";

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

// Matches @assistant-ui/core's Symbol.for("assistant-ui.silent-runtime-action"); thread list
// action failures are surfaced through the sidebar alert UI, so the runtime's generic
// console.error for unhandled action rejections would only duplicate the reported failure.
const SILENT_RUNTIME_ACTION = Symbol.for("assistant-ui.silent-runtime-action");

async function runSilentThreadListAction<T>(action: () => Promise<T>): Promise<T> {
	try {
		return await action();
	} catch (error) {
		if (error instanceof ApiRequestError) {
			Object.assign(error, { [SILENT_RUNTIME_ACTION]: true });
		}
		throw error;
	}
}

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
	onUnauthorized?: (() => void) | undefined;
}): RemoteThreadListAdapter {
	return {
		async archive(remoteId) {
			await runSilentThreadListAction(() => archiveConversation(remoteId));
		},
		async delete(remoteId) {
			await runSilentThreadListAction(() => deleteConversation(remoteId));
		},
		async fetch(threadId) {
			try {
				return toAssistantThreadMetadata(await getConversationDetail(threadId));
			} catch (error) {
				if (error instanceof UnauthorizedError) {
					input.onUnauthorized?.();
				}
				throw error;
			}
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
			await runSilentThreadListAction(() =>
				renameConversation({ conversationId: remoteId, title: newTitle }),
			);
		},
		async unarchive(remoteId) {
			await runSilentThreadListAction(() => unarchiveConversation(remoteId));
		},
		unstable_Provider: (props) => (
			<CampusAssistantThreadHistoryProvider {...props} onUnauthorized={input.onUnauthorized} />
		),
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
	onUnauthorized?: (() => void) | undefined,
): ThreadHistoryAdapter {
	return {
		async append(_item: ExportedMessageRepositoryItem) {
			return;
		},
		async load() {
			if (!remoteId) {
				return ExportedMessageRepository.fromArray([]);
			}
			try {
				const conversation = await getConversationDetail(remoteId);
				return ExportedMessageRepository.fromArray(toAssistantThreadMessages(conversation));
			} catch (error) {
				if (error instanceof UnauthorizedError) {
					onUnauthorized?.();
				}
				throw error;
			}
		},
	};
}

function CampusAssistantThreadHistoryProvider({
	children,
	onUnauthorized,
}: PropsWithChildren<{ onUnauthorized?: (() => void) | undefined }>) {
	const remoteId = useAuiState((state) => state.threadListItem.remoteId);
	const history = useMemo(
		() => createCampusAssistantThreadHistoryAdapter(remoteId, onUnauthorized),
		[onUnauthorized, remoteId],
	);

	return <RuntimeAdapterProvider adapters={{ history }}>{children}</RuntimeAdapterProvider>;
}
