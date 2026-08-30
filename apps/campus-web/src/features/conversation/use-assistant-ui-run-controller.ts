import { type AppendMessage, useAui, useAuiState } from "@assistant-ui/react";
import { useCallback } from "react";
import {
	type RuntimeMessages,
	readMessageText,
	readTextContent,
} from "./assistant-ui-message-projection";
import { isPersistedConversationMessageId } from "./assistant-ui-recovery-policy";
import { useConversationRunCoordinator } from "./use-conversation-run-coordinator";

function convertMessage(message: RuntimeMessages[number]) {
	return message;
}

export function useAssistantUiRunController({
	loginRequired,
	onLoginRequired,
}: {
	loginRequired: boolean;
	onLoginRequired: () => void;
}) {
	const aui = useAui();
	const threadId = useAuiState((state) => state.threadListItem.id);
	const remoteId = useAuiState((state) => state.threadListItem.remoteId);
	const {
		isLoading,
		isRunning,
		messages,
		onCancel,
		onResume,
		requiresConversationInitialization,
		runPrompt,
		runState,
		setMessages,
	} = useConversationRunCoordinator({
		loginRequired,
		onLoginRequired,
		remoteId,
		threadId,
	});

	const onNew = useCallback(
		async (message: AppendMessage) => {
			if (loginRequired) {
				onLoginRequired();
				return;
			}
			const needsInitialization = requiresConversationInitialization(remoteId);
			const threadItem = needsInitialization ? aui.threads.item({ id: threadId }) : undefined;
			await runPrompt({
				conversationId: needsInitialization ? undefined : remoteId,
				...(threadItem
					? {
							initializationTarget: {
								deleteThread: () => threadItem.delete(),
								initialize: () => threadItem.initialize(),
								threadId,
							},
						}
					: {}),
				messageContent: message.content,
				prompt: readTextContent(message),
			});
		},
		[
			aui.threads,
			loginRequired,
			onLoginRequired,
			remoteId,
			requiresConversationInitialization,
			runPrompt,
			threadId,
		],
	);

	const onEdit = useCallback(
		async (message: AppendMessage) => {
			const truncateFromMessageId = message.sourceId;
			if (!isPersistedConversationMessageId(truncateFromMessageId)) {
				return;
			}
			await runPrompt({
				conversationId: remoteId,
				messageContent: message.content,
				prompt: readTextContent(message),
				...(truncateFromMessageId ? { truncateFromMessageId } : {}),
			});
		},
		[remoteId, runPrompt],
	);

	const onReload = useCallback(
		async (parentId: string | null) => {
			if (!isPersistedConversationMessageId(parentId)) {
				return;
			}
			const parentMessage = messages.find((message) => message.id === parentId);
			const prompt = readMessageText(parentMessage).trim();
			if (!prompt) {
				return;
			}
			await runPrompt({
				conversationId: remoteId,
				messageContent: [{ text: prompt, type: "text" }],
				prompt,
				truncateFromMessageId: parentId,
			});
		},
		[messages, remoteId, runPrompt],
	);

	return {
		convertMessage,
		extras: {
			connection: runState.connection,
		},
		isLoading,
		isRunning,
		messages,
		onCancel,
		onEdit,
		onNew,
		onReload,
		onResume,
		setMessages,
	};
}
