import {
  createContext,
  startTransition,
  useContext,
  useEffect,
  useEffectEvent,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type { ShellConversationListItem, ShellSessionPrincipal } from "./types";
import { listShellConversations } from "./conversations";
import { loadShellSession } from "./session";
import { UnauthorizedError } from "../../public-chat/api";

export type ChatbotShellSessionState =
  | { kind: "loading" }
  | { kind: "unauthenticated" }
  | { kind: "error"; message: string }
  | { kind: "authenticated"; principal: ShellSessionPrincipal };

export interface ChatbotShellRuntimeValue {
  conversations: ShellConversationListItem[];
  historyError: string | null;
  historyLoading: boolean;
  refreshConversations: () => Promise<void>;
  refreshSession: () => Promise<void>;
  session: ChatbotShellSessionState;
  setSessionUnauthenticated: () => void;
  upsertConversationSummary: (conversation: ShellConversationListItem) => void;
}

export const ChatbotShellRuntimeContext = createContext<ChatbotShellRuntimeValue | null>(null);

export function useChatbotShellRuntime() {
  const context = useContext(ChatbotShellRuntimeContext);
  if (!context) {
    throw new Error("Chatbot shell runtime context is not available.");
  }

  return context;
}

export function ChatbotShellRuntimeProvider(props: { children: ReactNode }) {
  const [session, setSession] = useState<ChatbotShellSessionState>({ kind: "loading" });
  const [conversations, setConversations] = useState<ShellConversationListItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const refreshSession = useEffectEvent(async () => {
    startTransition(() => {
      setSession({ kind: "loading" });
    });

    try {
      const principal = await loadShellSession();
      startTransition(() => {
        setSession({
          kind: "authenticated",
          principal,
        });
      });
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        startTransition(() => {
          setSession({ kind: "unauthenticated" });
        });
        return;
      }

      startTransition(() => {
        setSession({
          kind: "error",
          message: error instanceof Error ? error.message : "Unable to load your session.",
        });
      });
    }
  });

  const refreshConversations = useEffectEvent(async () => {
    if (session.kind !== "authenticated" || !session.principal.canChat) {
      return;
    }

    startTransition(() => {
      setHistoryLoading(true);
      setHistoryError(null);
    });

    try {
      const items = await listShellConversations();
      startTransition(() => {
        setConversations(items);
        setHistoryLoading(false);
      });
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        startTransition(() => {
          setSession({ kind: "unauthenticated" });
          setHistoryLoading(false);
        });
        return;
      }

      startTransition(() => {
        setHistoryError(error instanceof Error ? error.message : "Unable to load conversation history.");
        setHistoryLoading(false);
      });
    }
  });

  useEffect(() => {
    void refreshSession();
  }, []);

  useEffect(() => {
    if (session.kind === "authenticated" && session.principal.canChat) {
      void refreshConversations();
      return;
    }

    if (session.kind !== "loading") {
      startTransition(() => {
        setConversations([]);
        setHistoryLoading(false);
        setHistoryError(null);
      });
    }
  }, [session]);

  const contextValue = useMemo<ChatbotShellRuntimeValue>(
    () => ({
      conversations,
      historyError,
      historyLoading,
      refreshConversations,
      refreshSession,
      session,
      setSessionUnauthenticated() {
        startTransition(() => {
          setSession({ kind: "unauthenticated" });
          setConversations([]);
          setHistoryError(null);
          setHistoryLoading(false);
        });
      },
      upsertConversationSummary(conversation) {
        startTransition(() => {
          setConversations((current) =>
            upsertShellConversationSummaryList(current, conversation),
          );
        });
      },
    }),
    [conversations, historyError, historyLoading, session],
  );

  return (
    <ChatbotShellRuntimeContext.Provider value={contextValue}>
      {props.children}
    </ChatbotShellRuntimeContext.Provider>
  );
}

export function upsertShellConversationSummaryList(
  conversations: ShellConversationListItem[],
  nextConversation: ShellConversationListItem,
): ShellConversationListItem[] {
  return [
    nextConversation,
    ...conversations.filter((conversation) => conversation.id !== nextConversation.id),
  ];
}
