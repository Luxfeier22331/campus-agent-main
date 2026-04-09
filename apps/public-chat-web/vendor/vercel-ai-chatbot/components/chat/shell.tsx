"use client";

import { useActiveChat } from "@platform/chat/use-active-chat";
import { ChatHeader } from "./chat-header";
import { Messages } from "./messages";
import { MultimodalInput } from "@/components/chat/multimodal-input";

export function ChatShell() {
  const {
    chatId,
    conversationTitle,
    messages,
    sendMessage,
    status,
    stop,
    input,
    setInput,
    visibilityType,
    isReadonly,
    isLoading,
    currentModelId,
    threadError,
    startNewChat,
  } = useActiveChat();

  return (
    <div className="flex h-dvh w-full flex-row overflow-hidden">
      <div className="flex min-w-0 flex-1 flex-col bg-sidebar transition-[width] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]">
        <ChatHeader
          chatId={chatId}
          conversationTitle={conversationTitle}
          isReadonly={isReadonly}
          onNewChat={startNewChat}
          selectedVisibilityType={visibilityType}
        />

        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-background md:rounded-tl-[12px] md:border-t md:border-l md:border-border/40">
          <Messages
            chatId={chatId}
            isArtifactVisible={false}
            isLoading={isLoading}
            isReadonly={isReadonly}
            messages={messages}
            selectedModelId={currentModelId}
            status={status}
          />

          {threadError ? (
            <div className="mx-auto w-full max-w-4xl px-2 pt-2 md:px-4">
              <div className="rounded-2xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-[13px] text-destructive">
                {threadError}
              </div>
            </div>
          ) : null}

          <div className="sticky bottom-0 z-1 mx-auto flex w-full max-w-4xl gap-2 border-t-0 bg-background px-2 pb-3 md:px-4 md:pb-4">
            {!isReadonly ? (
              <MultimodalInput
                input={input}
                isLoading={isLoading}
                messages={messages}
                selectedVisibilityType={visibilityType}
                sendMessage={sendMessage}
                setInput={setInput}
                status={status}
                stop={stop}
              />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
