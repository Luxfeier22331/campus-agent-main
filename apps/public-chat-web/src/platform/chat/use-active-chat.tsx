import type { UseChatHelpers } from "@ai-sdk/react";
import { useAppRouter, useConversationRouteId } from "@platform/router";
import {
	createContext,
	type Dispatch,
	type ReactNode,
	type SetStateAction,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useSWRConfig } from "swr";
import { toast } from "@/components/chat/toast";
import type { VisibilityType } from "@/components/chat/visibility-selector";
import type { ChatMessage } from "@/lib/types";
import { generateUUID } from "@/lib/utils";
import { UnauthorizedError } from "./api";
import { getShellConversationDetail } from "./conversations";
import { getSerializedChatHistoryKey } from "./history-cache";
import { mapShellConversationMessages } from "./message-parts";
import { useChatbotShellRuntime } from "./runtime";
import { submitShellChatRequest } from "./transport";

export type ChatStatus = UseChatHelpers<ChatMessage>["status"];

type SendMessageInput = Parameters<UseChatHelpers<ChatMessage>["sendMessage"]>[0];

interface ActiveChatContextValue {
	addToolApprovalResponse: UseChatHelpers<ChatMessage>["addToolApprovalResponse"];
	chatId: string;
	conversationTitle: string | null;
	currentModelId: string;
	input: string;
	isLoading: boolean;
	isReadonly: boolean;
	messages: UseChatHelpers<ChatMessage>["messages"];
	prepareConversationRoute: (conversationId: string) => void;
	regenerate: UseChatHelpers<ChatMessage>["regenerate"];
	sendMessage: UseChatHelpers<ChatMessage>["sendMessage"];
	setCurrentModelId: (id: string) => void;
	setInput: Dispatch<SetStateAction<string>>;
	setMessages: UseChatHelpers<ChatMessage>["setMessages"];
	showCreditCardAlert: boolean;
	startNewChat: () => void;
	setShowCreditCardAlert: Dispatch<SetStateAction<boolean>>;
	status: ChatStatus;
	stop: UseChatHelpers<ChatMessage>["stop"];
	threadError: string | null;
	visibilityType: VisibilityType;
	votes: undefined;
}

const ActiveChatContext = createContext<ActiveChatContextValue | null>(null);

function extractPromptText(message: SendMessageInput): string {
	if (!message) {
		return "";
	}

	if ("parts" in message) {
		return (message.parts ?? [])
			.filter(
				(part): part is Extract<ChatMessage["parts"][number], { type: "text" }> =>
					part.type === "text",
			)
			.map((part) => part.text)
			.join("\n")
			.trim();
	}

	if ("text" in message && typeof message.text === "string") {
		return message.text.trim();
	}

	return "";
}

export function ActiveChatProvider(props: { children: ReactNode }) {
	const router = useAppRouter();
	const conversationId = useConversationRouteId();
	const tempChatIdRef = useRef(generateUUID());
	const draftConversationIdRef = useRef<string | null>(null);
	const previousConversationIdRef = useRef<string | undefined>(conversationId);
	const { mutate } = useSWRConfig();
	const { setSessionUnauthenticated } = useChatbotShellRuntime();
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [status, setStatus] = useState<ChatStatus>("ready");
	const [input, setInput] = useState("");
	const [isLoading, setIsLoading] = useState(false);
	const [threadError, setThreadError] = useState<string | null>(null);
	const [showCreditCardAlert, setShowCreditCardAlert] = useState(false);
	const [conversationTitle, setConversationTitle] = useState<string | null>(null);
	const [currentModelId, setCurrentModelId] = useState("campus-default");

	useEffect(() => {
		if (previousConversationIdRef.current !== conversationId && !conversationId) {
			tempChatIdRef.current = generateUUID();
		}
		previousConversationIdRef.current = conversationId;
	}, [conversationId]);

	useEffect(() => {
		let cancelled = false;

		async function loadConversation() {
			if (!conversationId) {
				setConversationTitle(null);
				setIsLoading(false);
				setMessages([]);
				setThreadError(null);
				return;
			}

			if (conversationId === draftConversationIdRef.current) {
				setIsLoading(false);
				setThreadError(null);
				return;
			}

			setIsLoading(true);
			setThreadError(null);

			try {
				const detail = await getShellConversationDetail(conversationId);
				if (cancelled) {
					return;
				}

				setConversationTitle(detail.title);
				setMessages(mapShellConversationMessages(detail));
				setIsLoading(false);
			} catch (error) {
				if (cancelled) {
					return;
				}

				if (error instanceof UnauthorizedError) {
					setSessionUnauthenticated();
					void router.replace("/login");
					return;
				}

				setConversationTitle(null);
				setMessages([]);
				setIsLoading(false);
				setThreadError(error instanceof Error ? error.message : "当前对话加载失败。");
			}
		}

		void loadConversation();

		return () => {
			cancelled = true;
		};
	}, [conversationId, router, setSessionUnauthenticated]);

	const sendPrompt = useCallback(
		async (prompt: string) => {
			const trimmedPrompt = prompt.trim();
			if (!trimmedPrompt) {
				return;
			}

			const activeConversationId = conversationId ?? tempChatIdRef.current;

			const optimisticMessage: ChatMessage = {
				id: generateUUID(),
				kind: "user",
				metadata: {
					createdAt: new Date().toISOString(),
				},
				parts: [{ text: trimmedPrompt, type: "text" }],
				role: "user",
			};
			const previousMessages = messages;

			setStatus("submitted");
			setThreadError(null);
			setMessages((current) => [...current, optimisticMessage]);

			try {
				const outcome = await submitShellChatRequest({
					conversationId: activeConversationId,
					prompt: trimmedPrompt,
				});
				if (outcome.conversation.id !== activeConversationId) {
					throw new Error("对话状态已变化，请刷新后重试。");
				}

				draftConversationIdRef.current = null;
				setConversationTitle(outcome.conversation.title);
				setMessages(mapShellConversationMessages(outcome.conversation));
				setStatus("ready");
				setInput("");
				mutate(getSerializedChatHistoryKey());
			} catch (error) {
				if (error instanceof UnauthorizedError) {
					setSessionUnauthenticated();
					await router.replace("/login");
					return;
				}

				setMessages(previousMessages);
				setStatus("error");
				const message = error instanceof Error ? error.message : "当前无法发送消息，请稍后再试。";
				setThreadError(message);
				toast({
					description: message,
					type: "error",
				});
			}
		},
		[conversationId, messages, mutate, router, setSessionUnauthenticated],
	);

	const value = useMemo<ActiveChatContextValue>(
		() => ({
			async addToolApprovalResponse() {
				/* noop */
			},
			chatId: conversationId ?? tempChatIdRef.current,
			conversationTitle,
			currentModelId,
			input,
			isLoading,
			isReadonly: false,
			messages,
			prepareConversationRoute(nextConversationId) {
				if (conversationId) {
					return;
				}

				draftConversationIdRef.current = nextConversationId;
			},
			async regenerate(options) {
				const targetMessageId = options?.messageId;
				const lastUserMessage = targetMessageId
					? messages.find((message) => message.id === targetMessageId)
					: [...messages].reverse().find((message) => message.role === "user");
				const lastUserText = lastUserMessage?.parts.find(
					(part): part is Extract<ChatMessage["parts"][number], { type: "text" }> =>
						part.type === "text",
				)?.text;
				if (lastUserText) {
					await sendPrompt(lastUserText);
				}
			},
			async sendMessage(message) {
				const prompt = extractPromptText(message);
				await sendPrompt(prompt);
			},
			setCurrentModelId,
			setInput,
			setMessages,
			showCreditCardAlert,
			startNewChat() {
				tempChatIdRef.current = generateUUID();
				draftConversationIdRef.current = null;
				setConversationTitle(null);
				setIsLoading(false);
				setInput("");
				setMessages([]);
				setStatus("ready");
				setThreadError(null);
				void router.push("/chat");
			},
			setShowCreditCardAlert,
			status,
			async stop() {
				setStatus("ready");
			},
			threadError,
			visibilityType: "private",
			votes: undefined,
		}),
		[
			conversationId,
			conversationTitle,
			currentModelId,
			input,
			isLoading,
			messages,
			sendPrompt,
			showCreditCardAlert,
			status,
			threadError,
			router,
		],
	);

	return <ActiveChatContext.Provider value={value}>{props.children}</ActiveChatContext.Provider>;
}

export function useActiveChat() {
	const context = useContext(ActiveChatContext);
	if (!context) {
		throw new Error("useActiveChat must be used within ActiveChatProvider");
	}

	return context;
}
