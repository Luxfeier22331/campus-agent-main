import {
	type AppendMessage,
	type ThreadMessageLike,
	useAui,
	useAuiState,
	useExternalStoreRuntime,
} from "@assistant-ui/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { UnauthorizedError } from "@/platform/api/client";
import {
	cancelRun,
	getConversationDetail,
	resumeRunEventsStream,
	submitChatRequestStream,
} from "./api";
import { toAssistantThreadMessages } from "./assistant-ui-mappers";
import type { ChatRequestStreamEvent } from "./model";

type RuntimeMessages = ThreadMessageLike[];

interface ActiveRun {
	conversationId?: string;
	requestId: string;
	runId: string;
	sequence?: number;
	traceId: string;
}

export function createCampusAssistantRuntimeHook(input: { onLoginRequired: () => void }) {
	return function useCampusAssistantExternalStoreRuntime() {
		return useCampusAssistantRuntimeState({
			onLoginRequired: input.onLoginRequired,
		});
	};
}

function useCampusAssistantRuntimeState({ onLoginRequired }: { onLoginRequired: () => void }) {
	const aui = useAui();
	const remoteId = useAuiState((state) => state.threadListItem.remoteId);
	const [isLoading, setIsLoading] = useState(false);
	const [isRunning, setIsRunning] = useState(false);
	const [messages, setMessages] = useState<RuntimeMessages>([]);
	const [activeRun, setActiveRun] = useState<ActiveRun | null>(null);
	const abortControllerRef = useRef<AbortController | null>(null);

	const fetchConversationMessages = useCallback(async (conversationId: string) => {
		const conversation = await getConversationDetail(conversationId);
		return toAssistantThreadMessages(conversation);
	}, []);

	useEffect(() => {
		abortControllerRef.current?.abort();
		setActiveRun(null);
		setIsRunning(false);
		if (!remoteId) {
			setMessages([]);
			return;
		}

		let cancelled = false;
		setIsLoading(true);
		fetchConversationMessages(remoteId)
			.then((nextMessages) => {
				if (!cancelled) {
					setMessages(nextMessages);
				}
			})
			.catch((error: unknown) => {
				if (error instanceof UnauthorizedError) {
					onLoginRequired();
					return;
				}
				throw error;
			})
			.finally(() => {
				if (!cancelled) {
					setIsLoading(false);
				}
			});

		return () => {
			cancelled = true;
		};
	}, [fetchConversationMessages, onLoginRequired, remoteId]);

	const applyTerminalEvent = useCallback(
		async (event: ChatRequestStreamEvent) => {
			const conversationId =
				event.data.answer?.conversation.id ?? activeRun?.conversationId ?? remoteId;
			if (event.data.answer) {
				setMessages(toAssistantThreadMessages(event.data.answer.conversation));
			} else if (conversationId) {
				setMessages(await fetchConversationMessages(conversationId));
			}
			setIsRunning(false);
			setActiveRun(null);
		},
		[activeRun?.conversationId, fetchConversationMessages, remoteId],
	);

	const consumeLifecycleStream = useCallback(
		async (events: AsyncIterable<ChatRequestStreamEvent>, conversationId?: string) => {
			for await (const event of events) {
				if (event.event === "request.accepted" && event.data.runId) {
					setActiveRun({
						conversationId,
						requestId: event.data.requestId,
						runId: event.data.runId,
						sequence: event.data.sequence,
						traceId: event.data.traceId,
					});
					continue;
				}
				if (event.data.runId) {
					const runId = event.data.runId;
					setActiveRun((current) => ({
						conversationId: current?.conversationId ?? conversationId,
						requestId: event.data.requestId,
						runId,
						sequence: event.data.sequence ?? current?.sequence,
						traceId: event.data.traceId,
					}));
				}
				if (
					event.event === "request.completed" ||
					event.event === "request.failed" ||
					event.event === "request.cancelled"
				) {
					await applyTerminalEvent(event);
				}
			}
		},
		[applyTerminalEvent],
	);

	const onNew = useCallback(
		async (message: AppendMessage) => {
			const prompt = readTextContent(message).trim();
			if (!prompt) {
				throw new Error("Message text is required.");
			}
			const conversationId =
				remoteId ?? (await aui.threadListItem().initialize()).remoteId ?? undefined;
			abortControllerRef.current?.abort();
			const controller = new AbortController();
			abortControllerRef.current = controller;
			setMessages((current) => [
				...current,
				{
					content: message.content,
					createdAt: new Date(),
					role: "user",
				},
			]);
			setIsRunning(true);

			try {
				await consumeLifecycleStream(
					submitChatRequestStream({
						conversationId,
						prompt,
						signal: controller.signal,
					}),
					conversationId,
				);
			} catch (error) {
				setIsRunning(false);
				setActiveRun(null);
				if (error instanceof UnauthorizedError) {
					onLoginRequired();
					return;
				}
				if (isAbortError(error)) {
					return;
				}
				throw error;
			}
		},
		[aui.threadListItem, consumeLifecycleStream, onLoginRequired, remoteId],
	);

	const onCancel = useCallback(async () => {
		abortControllerRef.current?.abort();
		if (activeRun?.runId) {
			await cancelRun(activeRun.runId);
		}
		setIsRunning(false);
		setActiveRun(null);
	}, [activeRun?.runId]);

	const onResume = useCallback(async () => {
		if (!activeRun?.runId) {
			return;
		}
		abortControllerRef.current?.abort();
		const controller = new AbortController();
		abortControllerRef.current = controller;
		setIsRunning(true);
		try {
			await consumeLifecycleStream(
				resumeRunEventsStream({
					afterSequence: activeRun.sequence,
					runId: activeRun.runId,
					signal: controller.signal,
				}),
				activeRun.conversationId,
			);
		} catch (error) {
			setIsRunning(false);
			if (error instanceof UnauthorizedError) {
				onLoginRequired();
				return;
			}
			if (isAbortError(error)) {
				return;
			}
			throw error;
		}
	}, [activeRun, consumeLifecycleStream, onLoginRequired]);

	const runtime = useExternalStoreRuntime({
		convertMessage: (message) => message,
		isLoading,
		isRunning,
		messages,
		onCancel,
		onNew,
		onResume,
	});

	return runtime;
}

function readTextContent(message: AppendMessage): string {
	if (typeof message.content === "string") {
		return message.content;
	}
	return message.content.map((part) => (part.type === "text" ? part.text : "")).join("");
}

function isAbortError(error: unknown): boolean {
	return error instanceof DOMException && error.name === "AbortError";
}
