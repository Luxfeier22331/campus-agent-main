import type { AssistantState } from "@assistant-ui/react";
import { createContext } from "react";
import type { ThreadComponents } from "./thread-contract";

export const EMPTY_THREAD_COMPONENTS: ThreadComponents = {};
export const DEFAULT_THREAD_SETTINGS = {
	assistantAvatarFallback: "问",
	composerPlaceholder: "输入校园问题",
	welcomeMessage: "今天想了解什么校园信息？",
};

export const ThreadComponentsContext = createContext<ThreadComponents>(EMPTY_THREAD_COMPONENTS);
export const ThreadSettingsContext = createContext(DEFAULT_THREAD_SETTINGS);

// Startup exposes a loading placeholder thread; treat it as a new chat so
// the composer mounts centered. Loads after startup keep the docked layout.
export const isNewChatView = (s: AssistantState) =>
	s.thread.messages.length === 0 && (!s.thread.isLoading || s.threads.isLoading);
