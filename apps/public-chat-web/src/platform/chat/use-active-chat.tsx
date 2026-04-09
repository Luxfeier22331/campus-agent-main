import {
  createContext,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { toast } from "@/components/chat/toast";
import type { VisibilityType } from "@/components/chat/visibility-selector";
import { generateUUID } from "@/lib/utils";
import type { ChatMessage } from "@/lib/types";
import { useAppRouter, useConversationRouteId } from "@platform/router";
import { UnauthorizedError } from "./api";
import { getShellConversationDetail } from "./conversations";
import { submitShellChatRequest } from "./transport";
import { useChatbotShellRuntime } from "./runtime";
import type { ShellConversationDetail, ShellMessage } from "./types";

export type ChatStatus = "error" | "ready" | "streaming" | "submitted";

type ActiveChatContextValue = {
  addToolApprovalResponse: (..._args: unknown[]) => void;
  chatId: string;
  conversationTitle: string | null;
  currentModelId: string;
  input: string;
  isLoading: boolean;
  isReadonly: boolean;
  messages: ChatMessage[];
  regenerate: () => Promise<void>;
  sendMessage: (message: { parts: Array<{ text: string; type: "text" }>; role: "user" }) => Promise<void>;
  setCurrentModelId: (id: string) => void;
  setInput: Dispatch<SetStateAction<string>>;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  showCreditCardAlert: boolean;
  startNewChat: () => void;
  setShowCreditCardAlert: Dispatch<SetStateAction<boolean>>;
  status: ChatStatus;
  stop: () => void;
  threadError: string | null;
  visibilityType: VisibilityType;
  votes: undefined;
};

const ActiveChatContext = createContext<ActiveChatContextValue | null>(null);

function mapShellMessage(message: ShellMessage): ChatMessage {
  return {
    id: message.id,
    kind: message.kind,
    metadata: {
      createdAt: message.createdAt,
    },
    parts: [{ text: message.text, type: "text" }],
    requestId: message.requestId,
    retryable: message.retryable,
    role: message.role,
  };
}

function mapShellConversationMessages(conversation: ShellConversationDetail | null) {
  return conversation ? conversation.messages.map(mapShellMessage) : [];
}

export function ActiveChatProvider(props: { children: ReactNode }) {
  const router = useAppRouter();
  const conversationId = useConversationRouteId();
  const tempChatIdRef = useRef(generateUUID());
  const previousConversationIdRef = useRef<string | undefined>(conversationId);
  const { setSessionUnauthenticated, upsertConversationSummary } = useChatbotShellRuntime();
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
        setThreadError(
          error instanceof Error ? error.message : "Unable to load this conversation.",
        );
      }
    }

    void loadConversation();

    return () => {
      cancelled = true;
    };
  }, [conversationId, router, setSessionUnauthenticated]);

  const sendPrompt = async (prompt: string) => {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      return;
    }

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
      const outcome = await submitShellChatRequest(
        conversationId ? { conversationId, prompt: trimmedPrompt } : { prompt: trimmedPrompt },
      );
      setConversationTitle(outcome.conversation.title);
      setMessages(mapShellConversationMessages(outcome.conversation));
      setStatus("ready");
      setInput("");
      upsertConversationSummary(outcome.conversation);

      if (!conversationId || conversationId !== outcome.conversation.id) {
        await router.push(`/chat/${outcome.conversation.id}`);
      }
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        setSessionUnauthenticated();
        await router.replace("/login");
        return;
      }

      setMessages(previousMessages);
      setStatus("error");
      const message =
        error instanceof Error ? error.message : "Unable to send this message right now.";
      setThreadError(message);
      toast({
        description: message,
        type: "error",
      });
    }
  };

  const value = useMemo<ActiveChatContextValue>(
    () => ({
      addToolApprovalResponse() {},
      chatId: conversationId ?? tempChatIdRef.current,
      conversationTitle,
      currentModelId,
      input,
      isLoading,
      isReadonly: false,
      messages,
      async regenerate() {
        const lastUserMessage = [...messages].reverse().find((message) => message.role === "user");
        const lastUserText = lastUserMessage?.parts.find(
          (part): part is Extract<ChatMessage["parts"][number], { type: "text" }> =>
            part.type === "text",
        )?.text;
        if (lastUserText) {
          await sendPrompt(lastUserText);
        }
      },
      async sendMessage(message) {
        const prompt = message.parts
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n")
          .trim();
        await sendPrompt(prompt);
      },
      setCurrentModelId,
      setInput,
      setMessages,
      showCreditCardAlert,
      startNewChat() {
        tempChatIdRef.current = generateUUID();
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
      stop() {
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
      showCreditCardAlert,
      status,
      threadError,
      router,
      setSessionUnauthenticated,
      upsertConversationSummary,
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
