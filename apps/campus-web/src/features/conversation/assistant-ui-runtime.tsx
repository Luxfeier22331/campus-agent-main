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

const TYPEWRITER_INITIAL_CHARS = 3;
const TYPEWRITER_CHUNK_CHARS = 2;
const TYPEWRITER_INTERVAL_MS = 24;

interface ActiveRun {
	conversationId?: string;
	requestId: string;
	runId: string;
	sequence?: number;
	traceId: string;
}

interface TypewriterState {
	fullText: string;
	intervalId: number | null;
	messageId: string;
	occurredAt: string;
	pendingTerminalMessages: RuntimeMessages | null;
	visibleLength: number;
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
	const locallyInitializedRunConversationIdRef = useRef<string | null>(null);
	const pendingCancelBeforeRunRef = useRef(false);
	const typewriterRef = useRef<TypewriterState | null>(null);

	const fetchConversationMessages = useCallback(async (conversationId: string) => {
		const conversation = await getConversationDetail(conversationId);
		return toAssistantThreadMessages(conversation);
	}, []);

	const revealAssistantText = useCallback(
		(input: { messageId: string; occurredAt: string; text: string }) => {
			setMessages((current) => {
				const nextMessage: ThreadMessageLike = {
					content: input.text ? [{ text: input.text, type: "text" }] : [],
					createdAt: new Date(input.occurredAt),
					id: input.messageId,
					role: "assistant",
				};
				const existingIndex = current.findIndex((message) => message.id === input.messageId);
				if (existingIndex < 0) {
					return [...current, nextMessage];
				}
				return current.map((message, index) =>
					index === existingIndex
						? {
								...message,
								content: nextMessage.content,
							}
						: message,
				);
			});
		},
		[],
	);

	const clearTypewriter = useCallback(() => {
		const current = typewriterRef.current;
		if (current?.intervalId !== null && current?.intervalId !== undefined) {
			window.clearInterval(current.intervalId);
		}
		typewriterRef.current = null;
	}, []);

	const finishTypewriter = useCallback(() => {
		const current = typewriterRef.current;
		if (!current) {
			return;
		}
		if (current.intervalId !== null) {
			window.clearInterval(current.intervalId);
			current.intervalId = null;
		}
		typewriterRef.current = null;
		if (current.pendingTerminalMessages) {
			setMessages(current.pendingTerminalMessages);
			return;
		}
		revealAssistantText({
			messageId: current.messageId,
			occurredAt: current.occurredAt,
			text: current.fullText,
		});
	}, [revealAssistantText]);

	const startTypewriterInterval = useCallback(
		(state: TypewriterState) => {
			if (state.intervalId !== null) {
				window.clearInterval(state.intervalId);
				state.intervalId = null;
			}
			if (state.visibleLength >= state.fullText.length) {
				finishTypewriter();
				return;
			}
			state.intervalId = window.setInterval(() => {
				const current = typewriterRef.current;
				if (!current || current.messageId !== state.messageId) {
					window.clearInterval(state.intervalId ?? undefined);
					return;
				}
				current.visibleLength = Math.min(
					current.fullText.length,
					current.visibleLength + TYPEWRITER_CHUNK_CHARS,
				);
				revealAssistantText({
					messageId: current.messageId,
					occurredAt: current.occurredAt,
					text: current.fullText.slice(0, current.visibleLength),
				});
				if (current.visibleLength >= current.fullText.length) {
					finishTypewriter();
				}
			}, TYPEWRITER_INTERVAL_MS);
		},
		[finishTypewriter, revealAssistantText],
	);

	useEffect(() => clearTypewriter, [clearTypewriter]);

	useEffect(() => {
		if (remoteId && locallyInitializedRunConversationIdRef.current === remoteId) {
			return;
		}

		abortControllerRef.current?.abort();
		clearTypewriter();
		pendingCancelBeforeRunRef.current = false;
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
	}, [clearTypewriter, fetchConversationMessages, onLoginRequired, remoteId]);

	const applyTerminalEvent = useCallback(
		async (event: ChatRequestStreamEvent) => {
			const conversationId =
				event.data.answer?.conversation.id ?? activeRun?.conversationId ?? remoteId;
			if (event.data.answer) {
				const terminalMessages = toAssistantThreadMessages(event.data.answer.conversation);
				const activeTypewriter = typewriterRef.current;
				if (
					activeTypewriter &&
					terminalMessages.some((message) => message.id === activeTypewriter.messageId)
				) {
					activeTypewriter.pendingTerminalMessages = terminalMessages;
				} else {
					clearTypewriter();
					setMessages(terminalMessages);
				}
			} else if (conversationId) {
				clearTypewriter();
				setMessages(await fetchConversationMessages(conversationId));
			}
			setIsRunning(false);
			if (conversationId && locallyInitializedRunConversationIdRef.current === conversationId) {
				locallyInitializedRunConversationIdRef.current = null;
			}
			setActiveRun(null);
		},
		[activeRun?.conversationId, clearTypewriter, fetchConversationMessages, remoteId],
	);

	const applyAnswerDelta = useCallback(
		(event: ChatRequestStreamEvent) => {
			const messageId = event.data.messageId?.trim();
			const text = event.data.accumulatedText;
			if (!messageId || typeof text !== "string") {
				return;
			}
			const current = typewriterRef.current;
			const visibleLength =
				current?.messageId === messageId
					? Math.min(current.visibleLength, text.length)
					: Math.min(TYPEWRITER_INITIAL_CHARS, text.length);
			if (current && current.messageId !== messageId) {
				clearTypewriter();
			}
			const nextState: TypewriterState = {
				fullText: text,
				intervalId: current?.messageId === messageId ? current.intervalId : null,
				messageId,
				occurredAt: event.data.occurredAt,
				pendingTerminalMessages:
					current?.messageId === messageId ? current.pendingTerminalMessages : null,
				visibleLength,
			};
			typewriterRef.current = nextState;
			revealAssistantText({
				messageId,
				occurredAt: event.data.occurredAt,
				text: text.slice(0, visibleLength),
			});
			startTypewriterInterval(nextState);
		},
		[clearTypewriter, revealAssistantText, startTypewriterInterval],
	);

	const consumeLifecycleStream = useCallback(
		async (events: AsyncIterable<ChatRequestStreamEvent>, conversationId?: string) => {
			for await (const event of events) {
				if (event.event === "request.accepted" && event.data.runId) {
					const acceptedRun = {
						conversationId,
						requestId: event.data.requestId,
						runId: event.data.runId,
						sequence: event.data.sequence,
						traceId: event.data.traceId,
					};
					setActiveRun(acceptedRun);
					if (pendingCancelBeforeRunRef.current) {
						pendingCancelBeforeRunRef.current = false;
						await cancelRun(acceptedRun.runId);
						abortControllerRef.current?.abort();
						clearTypewriter();
						locallyInitializedRunConversationIdRef.current = null;
						setIsRunning(false);
						setActiveRun(null);
						return;
					}
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
				if (event.event === "answer.delta") {
					applyAnswerDelta(event);
					continue;
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
		[applyAnswerDelta, applyTerminalEvent, clearTypewriter],
	);

	const onNew = useCallback(
		async (message: AppendMessage) => {
			const prompt = readTextContent(message).trim();
			if (!prompt) {
				throw new Error("Message text is required.");
			}
			const existingRemoteId = remoteId;
			const conversationId =
				existingRemoteId ?? (await aui.threadListItem().initialize()).remoteId ?? undefined;
			if (!existingRemoteId && conversationId) {
				locallyInitializedRunConversationIdRef.current = conversationId;
			}
			abortControllerRef.current?.abort();
			const controller = new AbortController();
			abortControllerRef.current = controller;
			pendingCancelBeforeRunRef.current = false;
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
		clearTypewriter();
		locallyInitializedRunConversationIdRef.current = null;
		if (activeRun?.runId) {
			abortControllerRef.current?.abort();
			pendingCancelBeforeRunRef.current = false;
			await cancelRun(activeRun.runId);
			setIsRunning(false);
			setActiveRun(null);
			return;
		}
		if (isRunning && abortControllerRef.current) {
			pendingCancelBeforeRunRef.current = true;
			return;
		}
		pendingCancelBeforeRunRef.current = false;
		setIsRunning(false);
		setActiveRun(null);
	}, [activeRun?.runId, clearTypewriter, isRunning]);

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
