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

import type { ShellSessionPrincipal } from "./types";
import { UnauthorizedError } from "./api";
import { loadShellSession } from "./session";

export type ChatbotShellSessionState =
  | { kind: "loading" }
  | { kind: "unauthenticated" }
  | { kind: "error"; message: string }
  | { kind: "authenticated"; principal: ShellSessionPrincipal };

export interface ChatbotShellRuntimeValue {
  refreshSession: () => Promise<void>;
  session: ChatbotShellSessionState;
  setSessionUnauthenticated: () => void;
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

  useEffect(() => {
    void refreshSession();
  }, []);

  const contextValue = useMemo<ChatbotShellRuntimeValue>(
    () => ({
      refreshSession,
      session,
      setSessionUnauthenticated() {
        startTransition(() => {
          setSession({ kind: "unauthenticated" });
        });
      },
    }),
    [session],
  );

  return (
    <ChatbotShellRuntimeContext.Provider value={contextValue}>
      {props.children}
    </ChatbotShellRuntimeContext.Provider>
  );
}
